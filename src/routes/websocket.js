// ============================================================
// WEBSOCKET HANDLER — Real-time notifications
// ============================================================
const { ImapMonitor } = require('../imap/monitor');
const { listEmails, fetchAndParseEmail } = require('../imap/scanner');
const { analyzeHeaders } = require('../analysis/headerAnalyzer');
const { analyzeContent } = require('../analysis/contentAnalyzer');
const { analyzeLinks } = require('../analysis/linkAnalyzer');
const { analyzeAttachments } = require('../analysis/attachmentAnalyzer');
const { calculateScore, resolveLevel, levelMeta } = require('../analysis/scorer');
const { validateLicenseKey, UNLICENSED_FEATURES } = require('../license/license');
const { getCachedStatus } = require('../license/remoteValidator');
const { loadLicenseFile } = require('../license/licenseFile');

let _wsLicenseClient = null;
try { _wsLicenseClient = require('@mailtrustai/license-client'); } catch (_) {}
const { loadCredentials } = require('../imap/connection');
const { recordScan } = require('../storage/scanHistory');
const { removeAutoMonitor, listAutoMonitors } = require('../storage/autoMonitorState');
const { loadSettings } = require('../storage/settingsStore');
const { analyzeWithClaude } = require('../integrations/claude');
const { analyzeWithOpenAI } = require('../integrations/openai');
const { scanAttachments: vtScan } = require('../integrations/virustotal');
const { maybeMoveMessageToQuarantine, maybeMoveScannedMailToCollection } = require('../imap/quarantineService');
const { maybeDecorateSubject, isAlreadyDecorated, PREFIX_HIGH, PREFIX_MEDIUM } = require('../imap/subjectDecoratorService');
const { getImapSenderSkipInfo } = require('../imap/scanExclusions');
const crypto = require('crypto');

// NOT: Yeni mail geldiğinde mail sahibine otomatik HTML rapor gönderimi
// 'realtime' purpose'lu scanMailbox kayıtları üzerinden yapılır (Enterprise).
// UI'da IMAP hesabı modal'ındaki "🔔 Yeni mail geldiğinde anlık güvenlik raporu
// gönder" checkbox'ı bu kaydı oluşturur ve scanMailboxMonitor.js akışı çalışır.
// Bu modüldeki auto-monitor sadece WebSocket bildirimi + DB kaydı yapar.

// ─── Application services ─────────────────────────────────
const { startAutoMonitor } = require('../application/monitor/StartAutoMonitorService');
const { stopAutoMonitor }  = require('../application/monitor/StopAutoMonitorService');

const monitors = new Map();
const clients = new Set();

// Hesap başına son işlenen IMAP UID (bellekte; reconnect catch-up için kullanılır).
// Sunucu yeniden başladığında sıfırlanır; ilk bağlantıda değil, sadece reconnect'te tetiklenir.
const _wsMonitorLastUid = new Map();

// WebSocket monitör supervisor backoff (ms): 10s, 30s, 60s, 2dk, 5dk
const WS_MONITOR_BACKOFF = [10_000, 30_000, 60_000, 120_000, 300_000];
const _wsMonitorRetryTimers = new Map();

// checkLicense(req) ile aynı 3 katmanlı öncelik: cloud cache → .lic → HMAC key
function resolveLicense(licenseKey) {
    const fallback = { valid: false, features: { ...UNLICENSED_FEATURES } };

    // Öncelik 1: license-client cloud activation cache
    if (_wsLicenseClient) {
        try {
            const snap = _wsLicenseClient.getSnapshot();
            const grace = _wsLicenseClient.graceCheck();
            if (snap && grace && grace.ok) {
                const features = { ...(snap.features || {}) };
                if (snap.plan === 'pro' || snap.plan === 'enterprise') {
                    features.scanMailbox     = true;
                    features.dailyLimit      = features.dailyLimit  ?? Infinity;
                    features.linkLimit       = features.linkLimit   ?? Infinity;
                    features.attachmentScan  = true;
                }
                if (snap.plan === 'enterprise') {
                    features.imapConnection = true;
                    features.inboxScan      = true;
                    features.autoMonitor    = true;
                    features.realtimeAlert  = true;
                    features.batchScan      = true;
                    features.apiAccess      = true;
                    features.jsonReport     = true;
                }
                return { valid: true, plan: snap.plan || 'pro', tier: snap.tier || null, features };
            }
        } catch (_) {}
    }

    // Öncelik 2: .lic dosyası
    const licFile = loadLicenseFile();
    if (licFile && licFile.valid) return licFile;

    // Öncelik 3: eski HMAC key
    if (!licenseKey) return fallback;
    const result = validateLicenseKey(licenseKey);
    if (!result.valid) return fallback;
    const remote = getCachedStatus(licenseKey);
    if (remote && !remote.allowed) return fallback;
    return result;
}

async function enrichWithAI(result, parsedEmail) {
    const settings = loadSettings();
    const claudeKey = settings.claudeApiKey || '';
    const openaiKey = settings.openaiApiKey || '';
    const vtKey = settings.vtApiKey || '';

    // VirusTotal ek tarama
    if (vtKey && result.attachmentDetails?.length > 0) {
        const vtCandidates = result.attachmentDetails.filter((item) => item.vtEligible !== false);
        if (vtCandidates.length > 0) {
            try {
                const vtWithContent = vtCandidates.map((item) => {
                    const srcAtt = (parsedEmail.attachments || []).find((att) => {
                        if (item.hash && att.content) {
                            const hash = crypto.createHash('sha256').update(att.content).digest('hex');
                            if (hash === item.hash) return true;
                        }
                        return att.filename === item.filename;
                    });
                    return { ...item, content: srcAtt?.content, contentType: srcAtt?.contentType, filename: srcAtt?.filename || item.filename };
                });
                const vtEntries = await vtScan(vtWithContent, vtKey);
                result.virusTotal = vtEntries;

                // VT sonuçlarını findings'e yansıt
                vtEntries.forEach((entry) => {
                    const malicious = entry.stats?.malicious || 0;
                    const suspicious = entry.stats?.suspicious || 0;
                    if (malicious > 0) {
                        result.score = Math.min(100, result.score + 20);
                        result.findings.push({ severity: 'critical', category: 'virusTotal', message: `VirusTotal: ${entry.filename} zararlı (${malicious}/${entry.stats?.total || 0} motor)` });
                    } else if (suspicious > 0) {
                        result.score = Math.min(100, result.score + 10);
                        result.findings.push({ severity: 'warning', category: 'virusTotal', message: `VirusTotal: ${entry.filename} şüpheli (${suspicious} motor)` });
                    }
                });
                recalcMeta(result);
            } catch (e) {
                console.error('[WS-Monitor] VirusTotal error:', e.message);
            }
        }
    }

    // Claude AI analizi
    if (claudeKey) {
        try {
            const claudeResult = await analyzeWithClaude(
                claudeKey,
                parsedEmail.text || parsedEmail.textAsHtml || '',
                parsedEmail.subject
            );
            if (claudeResult.success) {
                result.claudeAnalysis = claudeResult.findings;
            }
        } catch (e) {
            console.error('[WS-Monitor] Claude error:', e.message);
        }
    }

    // OpenAI analizi
    if (openaiKey) {
        try {
            const { loadSettings: ls } = require('../storage/settingsStore');
            const openaiModel = ls().openaiModel || '';
            const linkResult = { urls: (result.findings || []).filter((f) => f.category === 'link').map((f) => f.message) };
            const openaiResult = await analyzeWithOpenAI(
                openaiKey,
                { parsedData: parsedEmail, linkUrls: linkResult.urls, attachmentDetails: result.attachmentDetails || [] },
                openaiModel
            );
            if (openaiResult.success) {
                result.openaiAnalysis = openaiResult.analysis;
                applyOpenAIInsights(result, openaiResult.analysis);
            }
        } catch (e) {
            console.error('[WS-Monitor] OpenAI error:', e.message);
        }
    }

    return result;
}

function applyOpenAIInsights(result, analysis) {
    if (!analysis) return;
    const baseByThreat = { safe: 0, low: 4, medium: 10, high: 18, critical: 26 };
    const base = baseByThreat[analysis.threatLevel] || 0;
    const confMul = Math.max(0.45, Math.min(1, (analysis.confidence || 0) / 100));
    const intentMul = Math.max(0.5, Math.min(1.15, (analysis.maliciousIntentScore || 0) / 100));
    const boost = Math.round(base * confMul * intentMul);
    if (boost > 0) result.score = Math.min(100, result.score + boost);

    const severity = (t) => (t === 'critical' || t === 'high') ? 'critical' : (t === 'medium' || t === 'low') ? 'warning' : 'safe';
    // "AI verdict:" patternini koru — scorer.js forcedLevelFromFindings bunu okur
    result.findings.unshift({
        severity: severity(analysis.threatLevel),
        category: 'ai',
        message: `AI verdict: ${analysis.category} / ${analysis.threatLevel} (${analysis.confidence || 0}% confidence)`
    });
    (analysis.redFlagsTR || []).slice(0, 3).forEach((flag) => {
        result.findings.push({ severity: severity(analysis.threatLevel), category: 'ai', message: `AI uyarı: ${flag}` });
    });
    recalcMeta(result);
}

function recalcMeta(result) {
    result.level = resolveLevel(result.score, result.findings || []);
    const meta = levelMeta(result.level);
    result.color = meta.color;
    result.labelTR = meta.labelTR;
    result.labelEN = meta.labelEN;
    result.summary = {
        critical: (result.findings || []).filter((f) => f.severity === 'critical').length,
        warning: (result.findings || []).filter((f) => f.severity === 'warning').length,
        info: (result.findings || []).filter((f) => f.severity === 'info').length,
        safe: (result.findings || []).filter((f) => f.severity === 'safe').length,
        total: (result.findings || []).length
    };
}

/**
 * Başlatma başarısız olan WebSocket monitörlerini üstel geri çekilme ile yeniden dener.
 */
function _scheduleWsMonitorRetry(account, license, entry, attempt = 0) {
    const delay = WS_MONITOR_BACKOFF[Math.min(attempt, WS_MONITOR_BACKOFF.length - 1)];
    console.warn(
        `[AutoMonitor] ${account.email} yeniden denenecek — ` +
        `${Math.round(delay / 1000)}s sonra (deneme ${attempt + 1})`
    );

    const prev = _wsMonitorRetryTimers.get(account.email);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(async () => {
        _wsMonitorRetryTimers.delete(account.email);

        // Dışarıdan zaten başlatıldıysa atla
        if (monitors.get(account.email)?.isRunning?.()) return;

        // Lisans hâlâ geçerli mi?
        const lic = resolveLicense(entry?.licenseKey);
        if (!lic.features?.autoMonitor) {
            console.warn(`[AutoMonitor] ${account.email} lisans geçersiz, retry iptal edildi.`);
            return;
        }

        console.log(`[AutoMonitor] ${account.email} yeniden başlatılıyor... (deneme ${attempt + 1})`);
        try {
            await startMonitorForAccount(account, lic);
            broadcast({ type: 'monitor-started', email: account.email });
            console.log(`[AutoMonitor] ${account.email} yeniden başlatıldı.`);
        } catch (e) {
            console.error(`[AutoMonitor] ${account.email} yeniden başlatma başarısız:`, e.message);
            _scheduleWsMonitorRetry(account, lic, entry, attempt + 1);
        }
    }, delay);

    if (timer.unref) timer.unref();
    _wsMonitorRetryTimers.set(account.email, timer);
}

/**
 * Tek bir maili analiz edip sonucu kaydeder ve WebSocket üzerinden yayınlar.
 * Hem gerçek zamanlı `onNewEmail` hem de reconnect catch-up tarafından kullanılır.
 *
 * @param {object} account  - IMAP hesap nesnesi
 * @param {object} license  - Çözülmüş lisans nesnesi
 * @param {number} uid      - IMAP UID
 * @param {object} email    - Ayrıştırılmış e-posta nesnesi
 * @param {string} [source] - Log etiketi ('realtime' | 'catchup')
 */
async function _analyzeAndBroadcast(account, license, uid, email, source = 'realtime') {
    const subject = String(email?.subject || '');

    // ─── Rapor maili tespiti ───────────────────────────────────────────────
    // MailTrustAI tarafından gönderilen güvenlik raporu mailleri:
    //   • Analiz yapmaz (self-loop koruması)
    //   • collectScannedMails ayarı açıksa → mailreports klasörüne taşır
    const isReportMail =
        subject.includes('[MailTrustAI Güvenlik Raporu]') ||
        subject.includes('[MailTrustAI Security Report]');

    if (isReportMail) {
        console.log(`[WS-Monitor][${source}] Rapor maili tespit edildi: ${account.email} uid=${uid} "${subject.slice(0, 60)}"`);
        // Ayar açıksa rapor mailini mailreports klasörüne taşı
        // messageId ile dış kural taşımışsa da bulunur
        const moveRes = await maybeMoveScannedMailToCollection({
            account, uid,
            messageId: email?.messageId || null
        });
        if (moveRes?.moved) {
            console.log(`[WS-Monitor][${source}] ✓ Rapor maili → mailreports (uid=${uid})`);
        } else if (moveRes?.reason && moveRes.reason !== 'disabled') {
            console.warn(`[WS-Monitor][${source}] Rapor maili taşınamadı (${moveRes.reason}): uid=${uid}`);
        }
        return;
    }
    // Self-loop koruması — kendi eklediğimiz 🔴/🟣 etiketli mailler (APPEND sonrası IDLE event)
    if (isAlreadyDecorated(email)) {
        console.log(`[WS-Monitor][${source}] Etiketli mail atlandı (re-scan döngüsü engellendi): "${subject.slice(0, 80)}"`);
        // UID baseline'ı yine de güncelle (yeni UID'yi takip et)
        const decUid = Number(uid);
        if (!Number.isNaN(decUid) && decUid > (_wsMonitorLastUid.get(account.email) || 0)) {
            _wsMonitorLastUid.set(account.email, decUid);
        }
        return;
    }
    const skipInfo = getImapSenderSkipInfo({ account, from: email?.from });
    if (skipInfo.skip) {
        console.log(`[WS-Monitor][${source}] Gönderen tarama dışı (${skipInfo.reason}): ${skipInfo.fromEmail}`);
        return;
    }

    const h = analyzeHeaders(email);
    const c = analyzeContent(email, 'advanced');
    const l = analyzeLinks(email);
    const a = license.features?.attachmentScan
        ? analyzeAttachments(email.attachments || [])
        : { findings: [], score: 0, results: [] };
    const result = calculateScore(h, c, l, a);
    result.emailMeta = {
        from: email.from,
        to: email.to,
        subject: email.subject,
        date: email.date,
        attachmentCount: email.attachmentCount || 0
    };
    result.attachmentDetails = a.results || [];
    result.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    result.timestamp = new Date().toISOString();
    result.account = account.email;
    if (source === 'catchup') result.catchup = true;   // UI'a göstermek için işaret

    // AI & VT analizi
    try {
        await enrichWithAI(result, email);
    } catch (e) {
        console.error(`[WS-Monitor][${source}] enrichWithAI error:`, e.message);
    }

    // ─── Mail akış özeti: log'larda mailin nereye gittiğini takip etmek için ───
    console.log(
        `[WS-Monitor][${source}] ${account.email} uid=${uid} ` +
        `level=${result.level} score=${result.score} ` +
        `subject="${String(email.subject || '').slice(0, 60)}"`
    );

    // NOT: Taranan mail mailreports'a TAŞINMAZ. Bu klasör yalnızca tarama
    // sonrası gelen RAPOR maillerini toplar (yukarıdaki isReportMail bloğunda).
    result.collectMove = { attempted: false, moved: false, reason: 'not-applicable' };

    // ─── 1) Risk emojisi etiketi (🔴 high, 🟣 medium) — ÖNCE çalışır ──────────
    // Dış kural (Outlook filter / Sieve) maili başka klasöre taşıdıysa,
    // subjectDecorator Message-ID ile maili bulup orada etiketler.
    // newFolder/newUid değerleri quarantine adımına aktarılır.
    result.subjectDecoration = await maybeDecorateSubject({
        account,
        uid,
        level: result.level,
        parsedEmail: email
    });

    // Decoration sonrası gerçek konum
    const decoratedFolder = result.subjectDecoration?.decorated
        ? (result.subjectDecoration.newFolder || 'INBOX')
        : 'INBOX';
    const effectiveUid = result.subjectDecoration?.decorated
        ? Number(result.subjectDecoration.newUid)
        : Number(uid);

    // ─── 2) Quarantine — etiketleme sonrası taşı ─────────────────────────────
    // Mail nerede olursa olsun bul (Message-ID ile) ve oradan Quarantine'e taşı
    result.quarantineMove = await maybeMoveMessageToQuarantine({
        account,
        uid:          effectiveUid,
        sourceFolder: decoratedFolder,
        messageId:    email?.messageId || null,
        result
    });

    // ─── Mail akışının final durumu — mail nerede? ─────────────────────────────
    // Sıra: decoration (önce) → quarantine (sonra)
    // Dış kural mail taşımış olsa bile locator ile bulunup işlem yapılır.
    let finalLocation;
    const decorated  = !!result.subjectDecoration?.decorated;
    const quarantine = !!result.quarantineMove?.moved;
    const extDec = result.subjectDecoration?.movedExternally;
    const extQua = result.quarantineMove?.movedExternally;
    const extTag = (extDec || extQua) ? ' [dış kuralla taşınmıştı, bulundu]' : '';

    if (decorated && quarantine) {
        finalLocation = `Quarantine — ETİKETLİ (${result.subjectDecoration.prefix.trim()}, ${result.quarantineMove.destinationFolder})${extTag}`;
    } else if (quarantine) {
        finalLocation = `Quarantine (${result.quarantineMove.destinationFolder})${extTag}`;
    } else if (decorated) {
        finalLocation = `${result.subjectDecoration.newFolder || 'INBOX'} (etiketli ${result.subjectDecoration.prefix.trim()}, yeni uid=${result.subjectDecoration.newUid})${extTag}`;
    } else if (result.subjectDecoration?.reason === 'mail-not-found-anywhere' ||
               result.quarantineMove?.reason   === 'mail-not-found-anywhere') {
        finalLocation = '⚠ Mail hiçbir klasörde bulunamadı (silinmiş olabilir)';
    } else {
        finalLocation = 'INBOX (değişiklik yok)';
        if (result.subjectDecoration?.attempted && !result.subjectDecoration.decorated) {
            console.warn(
                `[WS-Monitor][${source}] uid=${uid} decoration BAŞARISIZ ` +
                `(${result.subjectDecoration.reason || 'unknown'}) — mail KORUNDU`
            );
        }
    }
    console.log(`[WS-Monitor][${source}] uid=${uid} → ${finalLocation}`);

    // Otomatik mail raporu burada DEĞİL — scanMailboxMonitor (purpose='realtime')
    // akışında yapılıyor. Kullanıcı IMAP hesabı eklerken "anlık güvenlik raporu"
    // checkbox'ını işaretlerse otomatik olarak bir scanMailbox kaydı oluşur ve
    // o monitör mail gönderimini üstlenir.

    recordScan(result);
    broadcast({ type: 'new-email-scanned', result });

    // UID baseline'ı güncelle — yukarıdaki effectiveUid'i tekrar kullan
    // (decoration sonrası yeni UID, yoksa orijinal UID)
    if (!Number.isNaN(effectiveUid) && effectiveUid > (_wsMonitorLastUid.get(account.email) || 0)) {
        _wsMonitorLastUid.set(account.email, effectiveUid);
    }
}

/**
 * Bağlantı yeniden kurulduğunda çağrılır.
 * Son `CATCHUP_LIMIT` maili sorgular; son işlenen UID'den büyük olanları
 * eski→yeni sırasıyla tarayıp raporlarını WebSocket üzerinden iletir.
 */
const CATCHUP_LIMIT = 10;

async function _catchUpMissedEmails(account, license) {
    console.log(`[AutoMonitor] ${account.email} — bağlantı kopukken gelen mailler taranıyor (max ${CATCHUP_LIMIT})...`);
    try {
        const listed = await listEmails(account, 'INBOX', CATCHUP_LIMIT);
        if (!listed.success || !listed.messages?.length) return;

        const lastUid = _wsMonitorLastUid.get(account.email) || 0;
        // lastUid'den sonraki mailler; eskiden yeniye sırala
        const pending = listed.messages
            .filter(m => Number(m.uid) > lastUid)
            .sort((a, b) => Number(a.uid) - Number(b.uid));

        if (!pending.length) {
            console.log(`[AutoMonitor] ${account.email} — kaçırılan mail yok.`);
            return;
        }

        console.log(`[AutoMonitor] ${account.email} — ${pending.length} mail catch-up taranıyor...`);
        for (const msg of pending) {
            const parsed = await fetchAndParseEmail(account, msg.uid, 'INBOX');
            if (!parsed.success) {
                console.error(`[AutoMonitor] fetchAndParse hatası uid=${msg.uid}:`, parsed.error);
                continue;
            }
            await _analyzeAndBroadcast(account, license, msg.uid, parsed.data, 'catchup');
        }
        console.log(`[AutoMonitor] ${account.email} — catch-up taraması tamamlandı.`);
    } catch (e) {
        console.error(`[AutoMonitor] ${account.email} catch-up hatası:`, e.message);
    }
}

async function startMonitorForAccount(account, license) {
    const existing = monitors.get(account.email);
    if (existing?.isRunning?.()) return existing;

    const monitor = new ImapMonitor(
        account,
        // ─── onNewEmail: gerçek zamanlı IDLE event'i ───────────
        async (emailEvent) => {
            await _analyzeAndBroadcast(account, license, emailEvent.uid, emailEvent.email, 'realtime');
        },
        // ─── onReconnected: bağlantı kopukken kaçırılan mailler ─
        () => _catchUpMissedEmails(account, license)
    );

    await monitor.start();
    monitors.set(account.email, monitor);
    return monitor;
}

async function resumePersistedMonitors() {
    const entries = listAutoMonitors();
    if (!entries.length) return;

    const accounts = loadCredentials();
    for (const entry of entries) {
        const account = accounts.find(a => a.email === entry.email);
        if (!account) {
            console.warn(`[AutoMonitor] Kayıtlı IMAP hesabı bulunamadı, siliniyor: ${entry.email}`);
            removeAutoMonitor(entry.email);
            continue;
        }
        const license = resolveLicense(entry.licenseKey);
        if (!license.features?.autoMonitor) {
            console.warn(`[AutoMonitor] Lisans geçersiz/süresi dolmuş: ${entry.email}, atlanıyor`);
            continue;
        }
        try {
            await startMonitorForAccount(account, license);
            console.log(`[AutoMonitor] İzleme devam ettiriliyor: ${entry.email}`);
            broadcast({ type: 'monitor-started', email: entry.email });
        } catch (e) {
            console.error(`[AutoMonitor] ${entry.email} devam ettirilemedi:`, e.message);
            // Ağ geçici olarak erişilemez olabilir — supervisor retry başlat
            _scheduleWsMonitorRetry(account, license, entry, 0);
        }
    }
}

// WebSocket bağlantısı için authentication kontrolü.
// Dönüş: doğrulama başarılıysa { method, ref }, değilse null.
//   - method: 'admin-token' | 'customer-token' | 'license-key'
//   - ref: token (ilk 8 karakter, audit log için) veya license key prefix
// 'license-key' yöntemi DEPRECATED — proxy log'larında query string açıkta kalır.
// Frontend tercihen ?token= (customer token) kullanmalı; ?license= yalnızca eski
// kurulumlar için fallback ve gelecekte kaldırılacak.
function _authenticateWsClient(req) {
    try {
        const { verifyAdminToken } = require('../middleware/adminAuth');
        const { verifyCustomerToken } = require('../middleware/customerAuth');

        const authHeader = req.headers['authorization'] || '';
        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

        const urlObj = new URL(req.url, 'http://localhost');
        const qToken = urlObj.searchParams.get('token') || '';
        const qLicense = urlObj.searchParams.get('license') || '';

        for (const t of [bearerToken, qToken].filter(Boolean)) {
            if (verifyAdminToken(t))    return { method: 'admin-token',    ref: t.slice(0, 8) };
            if (verifyCustomerToken(t)) return { method: 'customer-token', ref: t.slice(0, 8) };
        }
        if (qLicense) {
            const r = validateLicenseKey(qLicense);
            if (r.valid) {
                if (!_licenseAuthWarned) {
                    _licenseAuthWarned = true;
                    console.warn('[ws] DEPRECATED: ?license= ile auth — proxy log leak riski. Frontend ?token= kullanmalı.');
                }
                return { method: 'license-key', ref: qLicense.slice(0, 8) };
            }
        }
    } catch { /* sessiz */ }
    return null;
}
let _licenseAuthWarned = false;

// Per-IP connection rate limiter: pencere içinde yeni-bağlantı sayısını bağlar.
// Aynı IP'den 60 sn'de 30+ bağlantı → 1013 ile reddedilir.
const WS_CONN_WINDOW_MS = 60_000;
const WS_CONN_MAX_PER_IP = 30;
const _wsConnBuckets = new Map(); // ip → { count, resetAt }
function _checkWsRate(ip) {
    const now = Date.now();
    const b = _wsConnBuckets.get(ip);
    if (!b || b.resetAt <= now) {
        _wsConnBuckets.set(ip, { count: 1, resetAt: now + WS_CONN_WINDOW_MS });
        return true;
    }
    b.count += 1;
    return b.count <= WS_CONN_MAX_PER_IP;
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of _wsConnBuckets) if (b.resetAt <= now) _wsConnBuckets.delete(ip);
}, 5 * 60 * 1000).unref();

// Bağlantı yaşı için periyodik re-auth: lisans/customer-token expire olduysa kop.
const WS_REAUTH_INTERVAL_MS = 5 * 60 * 1000;

function setupWebSocket(wss) {
    wss.on('connection', (ws, req) => {
        const ip = (req.socket?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown').toString();
        if (!_checkWsRate(ip)) {
            try { ws.close(1013, 'Try again later'); } catch {}
            return;
        }
        const authCtx = _authenticateWsClient(req);
        if (!authCtx) {
            try { ws.close(1008, 'Unauthorized'); } catch {}
            return;
        }
        ws._authCtx = authCtx;
        ws._reauthTimer = setInterval(() => {
            if (!_authenticateWsClient(req)) {
                try { ws.close(1008, 'Session expired'); } catch {}
            }
        }, WS_REAUTH_INTERVAL_MS);

        clients.add(ws);
        ws.send(JSON.stringify({
            type: 'monitor-status',
            emails: Array.from(monitors.entries())
                .filter(([, monitor]) => monitor?.isRunning?.())
                .map(([email]) => email)
        }));
        ws.on('close', () => {
            clients.delete(ws);
            if (ws._reauthTimer) { clearInterval(ws._reauthTimer); ws._reauthTimer = null; }
        });

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'start-monitor') {
                    const { email } = await startAutoMonitor({
                        email:                  msg.email,
                        licenseKey:             msg.licenseKey,
                        startMonitorForAccount: startMonitorForAccount
                    });
                    broadcast({ type: 'monitor-started', email });
                }
                if (msg.type === 'stop-monitor') {
                    const licStop = resolveLicense(msg.licenseKey);
                    if (!licStop.features?.autoMonitor) {
                        throw new Error('Otomatik izleme Enterprise lisansı gerektirir');
                    }
                    // Bekleyen supervisor retry'ı iptal et
                    const retryTimer = _wsMonitorRetryTimers.get(msg.email);
                    if (retryTimer) {
                        clearTimeout(retryTimer);
                        _wsMonitorRetryTimers.delete(msg.email);
                    }
                    await stopAutoMonitor({ email: msg.email, monitors });
                    broadcast({ type: 'monitor-stopped', email: msg.email });
                }
            } catch (e) {
                ws.send(JSON.stringify({ type: 'error', message: e.message }));
            }
        });
    });

    // Sunucu açıldığında daha önce aktif olan izleyicileri otomatik devam ettir
    setTimeout(() => {
        resumePersistedMonitors().catch(e =>
            console.error('[AutoMonitor] Resume error:', e.message)
        );
    }, 8 * 1000);

    // Her saat başı çalışan lisans geçerlilik kontrolü:
    // Süresi dolmuş / iptal edilmiş lisansa sahip aktif monitörleri durdurur.
    setInterval(async () => {
        const entries = listAutoMonitors();
        for (const entry of entries) {
            const license = resolveLicense(entry.licenseKey);
            if (!license.features?.autoMonitor) {
                const monitor = monitors.get(entry.email);
                if (monitor?.isRunning?.()) {
                    console.warn(`[AutoMonitor] Lisans geçersiz/süresi dolmuş → monitör durduruluyor: ${entry.email}`);
                    await monitor.stop().catch(() => {});
                    monitors.delete(entry.email);
                    removeAutoMonitor(entry.email);
                    broadcast({ type: 'monitor-stopped', email: entry.email, reason: 'license-expired' });
                }
            }
        }
    }, 60 * 60 * 1000); // saatte bir
}

function broadcast(data) {
    const msg = JSON.stringify(data);
    clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

module.exports = { setupWebSocket };
