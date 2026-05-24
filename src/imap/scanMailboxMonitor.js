// ============================================================
// SCAN MAILBOX MONITOR — IMAP izle, analiz et, rapor gönder
// ============================================================
const { ImapMonitor } = require('./monitor');
const { listEmails, fetchAndParseEmail } = require('./scanner');
const { sendReportEmail, REPORT_HEADER_NAME, verifyReportId } = require('../smtp/sender');
const { buildReportHtml, isRisky } = require('../smtp/reportBuilder');
const { recordScan } = require('../storage/scanHistory');
const { incrementScanCounts, licenseUsageScope } = require('../services/appState');

// scanMailbox monitor — kayitli lisans key'i ile scope hesapla
function _bumpScanCounters() {
    try {
        const key = (require('../storage/settingsStore').loadSettings()?.activeLicenseKey || '').trim();
        incrementScanCounts({ usageScope: key ? licenseUsageScope(key) : 'unlicensed' });
    } catch (e) { console.warn('[ScanMailbox] incrementScanCounts failed:', e.message); }
}
const { maybeMoveMessageToQuarantine } = require('./quarantineService');
const { maybeDecorateSubject } = require('./subjectDecoratorService');
const { getImapSenderSkipInfo } = require('./scanExclusions');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'scan-mailbox-state.json');
const CATCHUP_LIMIT = 15;
const CATCHUP_WINDOW_MS = 60 * 60 * 1000;

class ScanMailboxMonitor {
    constructor({ account, smtpConfig, buildAnalysisFn, lang = 'tr', reportMode = 'risky', reportToForwarder = false, allowedDomains = [] }) {
        this.account = account;
        this.smtpConfig = smtpConfig;
        this.buildAnalysisFn = buildAnalysisFn;
        this.lang = lang;
        this.reportMode = reportMode === 'all' ? 'all' : 'risky';
        this.reportToForwarder = reportToForwarder === true;
        // Lowercased domain whitelist — sadece forwarder modunda kullanılır.
        // Boş array = tüm domain'lere açık (geriye uyumlu).
        this.allowedDomains = Array.isArray(allowedDomains)
            ? allowedDomains.map(d => String(d || '').toLowerCase()).filter(Boolean)
            : [];
        this.imapMonitor = new ImapMonitor(
            account,
            this._onNewEmail.bind(this),
            this._onReconnected.bind(this)
        );
        this.startedAt = null;
    }

    // fromAddr'ın domain'i (veya alt-domain'i) whitelist'e uyuyor mu?
    _isDomainAllowed(fromAddr) {
        if (!this.allowedDomains.length) return true; // Liste boş → her şey serbest
        const at = String(fromAddr || '').toLowerCase().lastIndexOf('@');
        if (at < 0) return false;
        const fromDomain = fromAddr.toLowerCase().slice(at + 1);
        return this.allowedDomains.some(d => fromDomain === d || fromDomain.endsWith('.' + d));
    }

    async start() {
        // Tek bir hızlı deneme — başarısız olursa caller'daki supervisor backoff
        // [10s, 30s, 60s, 120s, 300s] devreye girer. Burada uzun retry loop yok
        // çünkü artık kaydetme fire-and-forget — UI'ı bloklamamalı.
        try {
            const result = await this.imapMonitor.start();
            this.startedAt = new Date();
            const _t = setTimeout(() => {
                this.processPendingRecent().catch((error) => {
                    console.error('[ScanMailbox] pending scan error:', error.message);
                });
            }, 2500);
            if (_t.unref) _t.unref();
            return result;
        } catch (error) {
            // Supervisor üst seviyede retry yapacak — burada throw et
            throw error;
        }
    }

    /**
     * Yeniden bağlantı sonrası çağrılır.
     * Bağlantı kopuk geçen sürede gelen mailler kaçırılmış olabilir;
     * son işlenen UID'den sonrasını tarayarak bunları telafi eder.
     */
    async _onReconnected() {
        console.log(`[ScanMailbox] Yeniden bağlantı: ${this.account.email} — kaçırılan mailler taranıyor...`);
        try {
            await this.processPendingRecent();
        } catch (e) {
            console.error(`[ScanMailbox] Yeniden bağlantı tarama hatası (${this.account.email}):`, e.message);
        }
    }

    async stop() {
        return this.imapMonitor.stop();
    }

    isRunning() {
        return this.imapMonitor.isRunning();
    }

    async _onNewEmail({ uid, email, account }) {
        try {
            const subjLog = String(email.subject || '').slice(0, 60);
            const fromLog = email.from?.[0]?.address || email.from?.address || '?';
            console.log(`[ScanMailbox] ▶ Mail geldi: ${this.account.email} uid=${uid} from=${fromLog} subj="${subjLog}"`);

            if (this.isProcessed(uid)) {
                console.log(`[ScanMailbox]   ⊘ Atlandı: uid=${uid} zaten işlenmiş (lastProcessedUid kontrolü)`);
                return;
            }

            // Loop koruması 1: gönderici SMTP hesabımız veya kendi izleme hesabımızsa atla.
            const skipInfo = getImapSenderSkipInfo({ account: this.account, from: email.from });
            const fromAddr = skipInfo.fromEmail;
            if (skipInfo.skip) {
                console.log(`[ScanMailbox]   ⊘ Atlandı: gönderen tarama dışı (${skipInfo.reason}): ${fromAddr}`);
                this.markProcessed(uid);
                return;
            }

            // Loop koruması 2: bizim ürettiğimiz rapor maili mi? (self-loop)
            // İki katmanlı kontrol:
            //  a) HMAC-imzalı X-MailTrustAI-Report-Id header (güçlü check —
            //     saldırgan üretemez, sadece bu kurulum tarafından imzalanır)
            //  b) Subject prefix (eski mailler/process restart sonrası yedek)
            const subject = String(email.subject || '');
            const hdrs = email.headers;
            let reportId = null;
            if (hdrs instanceof Map) {
                reportId = hdrs.get(REPORT_HEADER_NAME.toLowerCase()) || hdrs.get(REPORT_HEADER_NAME);
            } else if (hdrs && typeof hdrs === 'object') {
                reportId = hdrs[REPORT_HEADER_NAME.toLowerCase()] || hdrs[REPORT_HEADER_NAME];
            }
            const isVerifiedReport = reportId && verifyReportId(String(reportId).trim());
            const looksLikeReport  = subject.includes('[MailTrustAI Güvenlik Raporu]') ||
                                     subject.includes('[MailTrustAI Security Report]');
            if (isVerifiedReport || looksLikeReport) {
                console.log(`[ScanMailbox] Self-loop atlandı (${isVerifiedReport ? 'HMAC-doğrulanmış' : 'subject-prefix'}): "${subject.slice(0, 80)}"`);
                this.markProcessed(uid);
                return;
            }

            // Domain filtresi — yalnızca forwarder modunda anlamlı.
            // (realtime/inbox modunda mailler zaten kullanıcının kendi inbox'undan geliyor.)
            if (this.reportToForwarder && !this._isDomainAllowed(fromAddr)) {
                console.log(`[ScanMailbox] Domain filtresi: ${fromAddr || '(adres yok)'} izin verilen listeye uymuyor — rapor gönderilmedi`);
                this.markProcessed(uid);
                return;
            }

            const result = await this.buildAnalysisFn(email);
            result.scanSource = 'scan-mailbox';
            result.account = account;
            result.scanMailboxUid = uid;

            // ─── 1) Risk emojisi etiketi (🔴 high, 🟣 medium) — quarantine'den ÖNCE ──
            // İki monitör aynı INBOX'u izlediğinde (WS-Monitor + bu monitör),
            // yüksek riskli maili önce kim taşırsa diğeri etiketleyemiyordu.
            // Çözüm: bu monitör de decoration'ı quarantine'den ÖNCE yapar.
            // markRiskySubject ayarı diskten okunur; kapalıysa no-op döner.
            // Decoration UID'yi değiştirir → quarantine yeni UID'yi kullanır.
            // (Çift-etiketleme subjectDecorator içindeki taze-fetch guard'ı ile önlenir.)
            result.subjectDecoration = await maybeDecorateSubject({
                account: this.account,
                uid,
                level: result.level,
                parsedEmail: email
            });
            const _decoratedFolder = result.subjectDecoration?.decorated
                ? (result.subjectDecoration.newFolder || 'INBOX')
                : 'INBOX';
            const _effectiveUid = result.subjectDecoration?.decorated
                ? Number(result.subjectDecoration.newUid)
                : Number(uid);

            // ─── 2) Quarantine — etiketten sonra ───────────────────────────────
            result.quarantineMove = await maybeMoveMessageToQuarantine({
                account: this.account,
                uid:          _effectiveUid,
                sourceFolder: _decoratedFolder,
                messageId:    email?.messageId || null,
                result
            });

            // Rapor alıcısı — iki BAĞIMSIZ kaynak birleştirilir:
            //   1) reportToForwarder=true ise → iletilen mailin göndericisi (fromAddr)
            //   2) smtpConfig.reportTo (sabit adres) doluysa → o adres
            // İkisi de aktifse rapor HER İKİ alıcıya birden gönderilir.
            // İkisi de boşsa fallback: kutu sahibinin kendi adresi.
            const _recList = [];
            if (this.reportToForwarder && fromAddr) {
                _recList.push(String(fromAddr).trim().toLowerCase());
            }
            if (this.smtpConfig.reportTo) {
                _recList.push(String(this.smtpConfig.reportTo).trim().toLowerCase());
            }
            // Dedupe + boşları filtrele
            const _uniq = [...new Set(_recList.filter(Boolean))];
            const recipients = _uniq.length ? _uniq : [this.account.email];
            // Nodemailer hem dizi hem comma-separated string kabul eder.
            // Logging için tek string olarak da tutalım.
            const recipient = recipients.join(', ');
            const shouldSend = this.reportMode === 'all' || isRisky(result);
            console.log(
                `[ScanMailbox]   📊 Analiz: level=${result.level} score=${result.score} ` +
                `reportMode=${this.reportMode} → shouldSend=${shouldSend}`
            );

            if (!shouldSend) {
                console.log(
                    `[ScanMailbox]   ⊘ Rapor gönderilmedi: mail riskli değil ` +
                    `(level=${result.level}) ve reportMode='risky'. ` +
                    `Tüm maillere rapor için "Tüm mailler" modunu seçin (Enterprise).`
                );
                recordScan({
                    ...result,
                    autoReplySent: false,
                    autoReplySkipped: true,
                    autoReplySkipReason: 'non-risky-message'
                });
                _bumpScanCounters();
                this.markProcessed(uid);
                return;
            }

            const riskIcon = { high: '🔴', medium: '🟠', low: '🟡', safe: '🟢' }[result.level] || '⚠️';
            const reportSubject = `${riskIcon} [MailTrustAI Güvenlik Raporu] ${result.labelTR || 'Rapor'} - ${email.subject || '(Konu yok)'}`;
            const htmlBody = buildReportHtml(result, this.lang);
            const fromName = this.smtpConfig.smtpFromName || 'MailTrustAI';
            const from = `"${fromName}" <${this.smtpConfig.smtpUser}>`;

            console.log(`[ScanMailbox]   📤 SMTP gönderiliyor: ${this.smtpConfig.smtpHost}:${this.smtpConfig.smtpPort} → ${recipient}`);
            const sendResult = await sendReportEmail({
                smtpConfig: this.smtpConfig,
                to: recipient,
                from,
                subject: reportSubject,
                htmlBody
            });

            recordScan({
                ...result,
                autoReplySent: sendResult.success,
                autoReplyTo: recipient,
                ...(sendResult.success ? {} : { autoReplyError: sendResult.error })
            });
            _bumpScanCounters();
            this.markProcessed(uid);

            // Diagnostic için son durumu kaydet
            this.lastReportAttempt = {
                at: new Date().toISOString(),
                uid,
                recipient,
                subject: email.subject,
                level: result.level,
                success: sendResult.success,
                error: sendResult.error || null
            };

            if (sendResult.success) {
                this.reportsSentCount = (this.reportsSentCount || 0) + 1;
                console.log(`[ScanMailbox]   ✓ Rapor GÖNDERİLDİ → ${recipient} (msgId: ${sendResult.messageId || '?'})`);
            } else {
                this.reportsFailedCount = (this.reportsFailedCount || 0) + 1;
                console.error(`[ScanMailbox]   ✗ Rapor GÖNDERİLEMEDİ → ${recipient}: ${sendResult.error}`);
                console.error(`[ScanMailbox]     SMTP debug: host=${this.smtpConfig.smtpHost} port=${this.smtpConfig.smtpPort} user=${this.smtpConfig.smtpUser} secure=${this.smtpConfig.smtpSecure}`);
            }
        } catch (e) {
            console.error('[ScanMailbox] onNewEmail error:', e.message);
            this.lastReportAttempt = { at: new Date().toISOString(), uid, error: e.message };
        }
    }

    /**
     * Diagnostic: monitör durumunu döndürür (UI/API için).
     */
    getStatus() {
        return {
            email:          this.account.email,
            running:        this.isRunning(),
            startedAt:      this.startedAt?.toISOString() || null,
            reportMode:     this.reportMode,
            reportsSent:    this.reportsSentCount   || 0,
            reportsFailed:  this.reportsFailedCount || 0,
            lastReport:     this.lastReportAttempt  || null,
            smtpHost:       this.smtpConfig.smtpHost,
            smtpPort:       this.smtpConfig.smtpPort
        };
    }

    async processPendingRecent({ _retry = false } = {}) {
        const listed = await listEmails(this.account, 'INBOX', CATCHUP_LIMIT);
        if (!listed.success) {
            const isTransient = /authenticate|connect|timeout|socket/i.test(listed.error || '');
            if (isTransient && !_retry) {
                // Muhtemelen IMAP sunucusu max-conn sınırı — 15s sonra bir kez daha dene
                console.warn(`[ScanMailbox] pending list geçici hata (${this.account.email}): ${listed.error} — 15s sonra yeniden denenecek`);
                const t = setTimeout(() => {
                    this.processPendingRecent({ _retry: true }).catch(e =>
                        console.error(`[ScanMailbox] pending list retry hatası (${this.account.email}):`, e.message)
                    );
                }, 15_000);
                if (t.unref) t.unref();
            } else {
                console.error(`[ScanMailbox] pending list error (${this.account.email}):`, listed.error);
            }
            return;
        }

        const minDate = new Date((this.startedAt || new Date()).getTime() - CATCHUP_WINDOW_MS);
        const messages = (listed.messages || [])
            .filter((message) => !this.isProcessed(message.uid))
            .filter((message) => new Date(message.date).getTime() >= minDate.getTime())
            .reverse();

        for (const message of messages) {
            const parsed = await fetchAndParseEmail(this.account, message.uid, 'INBOX');
            if (!parsed.success) {
                console.error(`[ScanMailbox] pending fetch error ${message.uid}:`, parsed.error);
                continue;
            }

            await this._onNewEmail({
                uid: message.uid,
                email: parsed.data,
                account: this.account.email
            });
        }
    }

    // ─── UID izleme ──────────────────────────────────────
    // IMAP UID'leri kutu içinde monoton artar, dolayısıyla "lastProcessedUid"
    // tek bir sayı ile son işlenen mesajı izlemek yeterlidir.
    // Eski formatla geriye uyumluluk: state[email].processed array'i de
    // okunmaya devam edilir (geçiş döneminde tekrar tarama olmasın).
    isProcessed(uid) {
        if (!uid) return false;
        const state = loadState();
        const entry = state[this.account.email];
        if (!entry) return false;
        const numericUid = Number(uid);
        if (!Number.isNaN(numericUid) && typeof entry.lastProcessedUid === 'number' && numericUid <= entry.lastProcessedUid) {
            return true;
        }
        // Geriye uyumluluk: eski "processed" array
        if (Array.isArray(entry.processed) && entry.processed.includes(String(uid))) return true;
        return false;
    }

    markProcessed(uid) {
        if (!uid) return;
        const state = loadState();
        const key = this.account.email;
        const numericUid = Number(uid);
        const entry = state[key] || {};
        const prevMax = typeof entry.lastProcessedUid === 'number' ? entry.lastProcessedUid : 0;
        const newMax = Number.isNaN(numericUid) ? prevMax : Math.max(prevMax, numericUid);

        // Son 50 UID'yi de tut (yeniden işleme korumasının tamamen UID-monoton'a güvenmemesi için)
        const recent = Array.isArray(entry.processed) ? entry.processed : [];
        const next = [String(uid), ...recent.filter(x => x !== String(uid))].slice(0, 50);

        state[key] = {
            lastProcessedUid: newMax,
            processed: next,
            updatedAt: new Date().toISOString()
        };
        saveState(state);
    }
}

function isRetryableImapError(error) {
    return /ECONNRESET|Connection not available|socket|timeout/i.test(String(error?.message || error || ''));
}

function extractEmailAddress(value) {
    if (!value) return '';
    const first = Array.isArray(value) ? value[0] : value;
    if (!first) return '';
    if (typeof first === 'string') {
        const m = first.match(/<([^>]+)>/);
        return (m ? m[1] : first).toLowerCase().trim();
    }
    return String(first.address || '').toLowerCase().trim();
}

function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return {};
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveState(state) {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = { ScanMailboxMonitor };
