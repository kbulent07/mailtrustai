// ============================================================
// SCAN MAILBOX MONITOR — IMAP izle, analiz et, rapor gönder
// ============================================================
const { ImapMonitor } = require('./monitor');
const { listEmails, fetchAndParseEmail } = require('./scanner');
const { sendReportEmail } = require('../smtp/sender');
const { buildReportHtml, isRisky } = require('../smtp/reportBuilder');
const { recordScan } = require('../storage/scanHistory');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'scan-mailbox-state.json');
const CATCHUP_LIMIT = 15;
const CATCHUP_WINDOW_MS = 60 * 60 * 1000;

class ScanMailboxMonitor {
    constructor({ account, smtpConfig, buildAnalysisFn, lang = 'tr', reportMode = 'risky', reportToForwarder = false }) {
        this.account = account;
        this.smtpConfig = smtpConfig;
        this.buildAnalysisFn = buildAnalysisFn;
        this.lang = lang;
        this.reportMode = reportMode === 'all' ? 'all' : 'risky';
        this.reportToForwarder = reportToForwarder === true;
        this.imapMonitor = new ImapMonitor(account, this._onNewEmail.bind(this));
        this.startedAt = null;
    }

    async start() {
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const result = await this.imapMonitor.start();
                this.startedAt = new Date();
                setTimeout(() => {
                    this.processPendingRecent().catch((error) => {
                        console.error('[ScanMailbox] pending scan error:', error.message);
                    });
                }, 2500);
                return result;
            } catch (error) {
                lastError = error;
                if (!isRetryableImapError(error) || attempt === 3) break;
                await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
            }
        }
        throw lastError;
    }

    async stop() {
        return this.imapMonitor.stop();
    }

    isRunning() {
        return this.imapMonitor.isRunning();
    }

    async _onNewEmail({ uid, email, account }) {
        try {
            if (this.isProcessed(uid)) return;

            // Loop koruması 1: gönderici SMTP hesabımız veya kendi izleme hesabımızsa atla.
            const fromAddr = extractEmailAddress(email.from);
            const senderAddr = String(this.smtpConfig?.smtpUser || '').toLowerCase().trim();
            const ownAddr = String(this.account?.email || '').toLowerCase().trim();
            if (fromAddr && (fromAddr === senderAddr || fromAddr === ownAddr)) {
                console.log(`[ScanMailbox] Self-loop atlandı (from=own): ${fromAddr}`);
                this.markProcessed(uid);
                return;
            }

            // Loop koruması 2: konu başlığı bizim rapor ön ekimizi içeriyorsa atla.
            // Bu, iletilenin aynı zamanda rapor alıcısı olduğu durumlarda döngüyü keser.
            const subject = String(email.subject || '');
            if (subject.includes('[MailTrustAI Güvenlik Raporu]') ||
                subject.includes('[MailTrustAI Security Report]')) {
                console.log(`[ScanMailbox] Self-loop atlandı (rapor konusu): "${subject.slice(0, 80)}"`);
                this.markProcessed(uid);
                return;
            }

            const result = await this.buildAnalysisFn(email);
            result.scanSource = 'scan-mailbox';
            result.account = account;
            result.scanMailboxUid = uid;

            // Rapor alıcısı:
            //   reportToForwarder=true  → iletilen mail geldi, göndereni (fromAddr) kullan
            //   reportToForwarder=false → ayarlardaki reportTo adresi veya kutu sahibi
            const recipient = this.reportToForwarder
                ? (fromAddr || this.smtpConfig.reportTo || this.account.email)
                : (this.smtpConfig.reportTo || this.account.email);
            const shouldSend = this.reportMode === 'all' || isRisky(result);

            if (!shouldSend) {
                recordScan({
                    ...result,
                    autoReplySent: false,
                    autoReplySkipped: true,
                    autoReplySkipReason: 'non-risky-message'
                });
                this.markProcessed(uid);
                return;
            }

            const riskIcon = { high: '🔴', medium: '🟠', low: '🟡', safe: '🟢' }[result.level] || '⚠️';
            const reportSubject = `${riskIcon} [MailTrustAI Güvenlik Raporu] ${result.labelTR || 'Rapor'} - ${email.subject || '(Konu yok)'}`;
            const htmlBody = buildReportHtml(result, this.lang);
            const fromName = this.smtpConfig.smtpFromName || 'MailTrustAI';
            const from = `"${fromName}" <${this.smtpConfig.smtpUser}>`;

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
            this.markProcessed(uid);

            if (sendResult.success) {
                console.log(`[ScanMailbox] Report sent to ${recipient} for "${email.subject}"`);
            } else {
                console.error(`[ScanMailbox] Failed to send report to ${recipient}: ${sendResult.error}`);
            }
        } catch (e) {
            console.error('[ScanMailbox] onNewEmail error:', e.message);
        }
    }

    async processPendingRecent() {
        const listed = await listEmails(this.account, 'INBOX', CATCHUP_LIMIT);
        if (!listed.success) {
            console.error('[ScanMailbox] pending list error:', listed.error);
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
