// ============================================================
// TARAMA POSTA KUTUSU SERVİSİ
// Monitor yaşam döngüsü + supervisor retry yönetimi
// ============================================================
const { ScanMailboxMonitor } = require('../imap/scanMailboxMonitor');
const { decrypt, loadCredentials } = require('../imap/connection');
const { analyzeParsedEmailData } = require('../application/analyze/AnalyzeMessageService');
const { loadSettings } = require('../storage/settingsStore');

// email → ScanMailboxMonitor  (dışa aktarılır, route'lar okur/yazar)
const scanMailboxMonitors = new Map();

// email → supervisor timer (dışarıdan stop edildiğinde iptal edilir)
const _supervisorTimers = new Map();

// Supervisor backoff adımları (ms): 10s, 30s, 60s, 2dk, 5dk
const SUPERVISOR_BACKOFF = [10_000, 30_000, 60_000, 120_000, 300_000];

/**
 * Şifreli değeri güvenle çözer.
 * Eğer değer şifreli değilse (eski düz metin kayıtlar) olduğu gibi döner.
 */
function safeDecrypt(value) {
    if (!value) return '';
    try {
        return decrypt(value);
    } catch {
        return value;
    }
}

async function startScanMailboxMonitor(smb) {
    const imapAccount = loadCredentials().find((item) => item.email === smb.imapEmail);
    const account = {
        email:              smb.imapEmail,
        host:               smb.imapHost,
        port:               Number(smb.imapPort) || 993,
        secure:             smb.imapTls !== false,
        password:           safeDecrypt(smb.imapPassword),
        rejectUnauthorized: smb.imapRejectUnauthorized !== false,
        moveHighRiskToQuarantine: imapAccount?.moveHighRiskToQuarantine === true
    };

    const smtpConfig = {
        ...smb,
        smtpHost:               smb.smtpHost || smb.imapHost,
        smtpPort:               Number(smb.smtpPort) || 587,
        smtpUser:               smb.imapEmail,
        smtpPassword:           safeDecrypt(smb.smtpPassword || smb.imapPassword),
        smtpSecure:             Number(smb.smtpPort) === 465,
        smtpRejectUnauthorized: smb.imapRejectUnauthorized !== false,
        smtpFromName:           'MailTrustAI'
    };

    const license = {
        licenseKey: '',
        features: { virusTotal: true, contentAnalysis: 'advanced', linkLimit: Infinity },
        monthlyLimit: Infinity
    };

    const monitor = new ScanMailboxMonitor({
        account,
        smtpConfig,
        buildAnalysisFn: (emailData) => analyzeParsedEmailData({
            parsedData:      emailData,
            license,
            scanSource:      'scan-mailbox',
            account:         smb.imapEmail,
            persist:         false,
            incrementCounts: false
        }),
        lang:              smb.reportLang       || 'tr',
        reportMode:        smb.reportMode       || 'risky',
        reportToForwarder: smb.reportToForwarder === true,
        allowedDomains:    Array.isArray(smb.allowedDomains) ? smb.allowedDomains : []
    });

    await monitor.start();
    scanMailboxMonitors.set(smb.imapEmail, monitor);
    console.log(`[ScanMailbox] Monitor başlatıldı: ${smb.imapEmail} (${smb.imapHost}:${smb.imapPort || 993})`);
}

/**
 * Başlatma başarısız olduğunda, ya da dışarıdan stop edilmeden monitor
 * beklenmedik şekilde durduğunda, üstel geri çekilme ile yeniden dener.
 *
 * @param {object} smb     - Scan mailbox ayar nesnesi
 * @param {number} attempt - Kaçıncı deneme (backoff hesabında kullanılır)
 */
function scheduleScanMailboxRetry(smb, attempt = 0) {
    const delay = SUPERVISOR_BACKOFF[Math.min(attempt, SUPERVISOR_BACKOFF.length - 1)];
    console.warn(
        `[ScanMailbox] ${smb.imapEmail} başlatılamadı/durdu — ` +
        `${Math.round(delay / 1000)}s sonra yeniden denenecek (deneme ${attempt + 1})`
    );

    // Önceki bekleyen timer'ı iptal et
    const prev = _supervisorTimers.get(smb.imapEmail);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(async () => {
        _supervisorTimers.delete(smb.imapEmail);

        // Dışarıdan zaten başlatıldıysa veya duruyorsa atla
        const existing = scanMailboxMonitors.get(smb.imapEmail);
        if (existing?.isRunning()) {
            console.log(`[ScanMailbox] ${smb.imapEmail} zaten çalışıyor, supervisor retry atlandı.`);
            return;
        }

        console.log(`[ScanMailbox] ${smb.imapEmail} yeniden başlatılıyor... (deneme ${attempt + 1})`);
        try {
            await startScanMailboxMonitor(smb);
            console.log(`[ScanMailbox] ${smb.imapEmail} yeniden başlatıldı.`);
        } catch (e) {
            console.error(`[ScanMailbox] ${smb.imapEmail} yeniden başlatma başarısız:`, e.message);
            scheduleScanMailboxRetry(smb, attempt + 1);
        }
    }, delay);

    // Node.js'in bu timer yüzünden process'i açık tutmasını engelle
    if (timer.unref) timer.unref();
    _supervisorTimers.set(smb.imapEmail, timer);
}

/**
 * Monitor'ü supervisor korumasıyla başlatır.
 * İlk başlatma başarısız olursa otomatik retry devreye girer.
 */
async function startScanMailboxMonitorSupervised(smb) {
    try {
        await startScanMailboxMonitor(smb);
    } catch (e) {
        console.error(`[ScanMailbox] ${smb.imapEmail} ilk başlatma başarısız:`, e.message);
        scheduleScanMailboxRetry(smb, 0);
    }
}

/**
 * Monitor'ü durdurur ve supervisor retry'ı iptal eder.
 */
function stopScanMailboxMonitor(email) {
    // Bekleyen supervisor timer'ı iptal et
    const timer = _supervisorTimers.get(email);
    if (timer) {
        clearTimeout(timer);
        _supervisorTimers.delete(email);
    }

    const monitor = scanMailboxMonitors.get(email);
    if (monitor) {
        monitor.stop().catch(() => {});
        scanMailboxMonitors.delete(email);
    }
}

/**
 * Sunucu yeniden başladığında ayarlardaki tüm etkin scan mailbox
 * monitörlerini supervisor korumasıyla yeniden başlatır.
 * WebSocket setupWebSocket() çağrısından ~10s sonra çağrılmalıdır.
 */
async function resumeScanMailboxMonitors() {
    let mailboxes;
    try {
        mailboxes = loadSettings().scanMailboxes || [];
    } catch (e) {
        console.error('[ScanMailbox] Resume: ayarlar okunamadı:', e.message);
        return;
    }

    const enabled = mailboxes.filter(smb => smb.enabled !== false);
    if (!enabled.length) return;

    console.log(`[ScanMailbox] ${enabled.length} adet etkin monitor yeniden başlatılıyor...`);
    for (const smb of enabled) {
        // Dışarıdan zaten çalışıyorsa atla
        if (scanMailboxMonitors.get(smb.imapEmail)?.isRunning()) continue;
        await startScanMailboxMonitorSupervised(smb);
    }
}

module.exports = {
    scanMailboxMonitors,
    startScanMailboxMonitor,
    startScanMailboxMonitorSupervised,
    scheduleScanMailboxRetry,
    stopScanMailboxMonitor,
    resumeScanMailboxMonitors
};
