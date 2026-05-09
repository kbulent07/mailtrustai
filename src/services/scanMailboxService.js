// ============================================================
// TARAMA POSTA KUTUSU SERVİSİ
// Monitor yaşam döngüsü yönetimi
// ============================================================
const { ScanMailboxMonitor } = require('../imap/scanMailboxMonitor');
const { decrypt } = require('../imap/connection');
const { buildEmailAnalysisResult } = require('../analysis/emailAnalyzer');

// email → ScanMailboxMonitor  (dışa aktarılır, route'lar okur/yazar)
const scanMailboxMonitors = new Map();

/**
 * Şifreli değeri güvenle çözer.
 * Eğer değer şifreli değilse (eski düz metin kayıtlar) olduğu gibi döner.
 */
function safeDecrypt(value) {
    if (!value) return '';
    try {
        return decrypt(value);
    } catch {
        // Eski düz metin kayıt — olduğu gibi kullan
        return value;
    }
}

async function startScanMailboxMonitor(smb) {
    // Hesap nesnesini doğrudan kaydedilen IMAP bilgilerinden oluştur
    const account = {
        email:             smb.imapEmail,
        host:              smb.imapHost,
        port:              Number(smb.imapPort) || 993,
        secure:            smb.imapTls !== false,
        password:          safeDecrypt(smb.imapPassword),
        rejectUnauthorized: smb.imapRejectUnauthorized !== false
    };

    const smtpConfig = {
        ...smb,
        smtpHost:              smb.smtpHost || smb.imapHost,
        smtpPort:              Number(smb.smtpPort) || 587,
        smtpUser:              smb.imapEmail,
        smtpPassword:          safeDecrypt(smb.smtpPassword || smb.imapPassword),
        smtpSecure:            Number(smb.smtpPort) === 465,
        smtpRejectUnauthorized: smb.imapRejectUnauthorized !== false,
        smtpFromName:          'MailTrustAI'
    };

    const features = { virusTotal: true, contentAnalysis: 'advanced', linkLimit: Infinity };
    const monitor  = new ScanMailboxMonitor({
        account,
        smtpConfig,
        buildAnalysisFn:   emailData => buildEmailAnalysisResult(emailData, { features, monthlyLimit: Infinity }),
        lang:              smb.reportLang       || 'tr',
        reportMode:        smb.reportMode       || 'risky',
        reportToForwarder: smb.reportToForwarder === true,
        allowedDomains:    Array.isArray(smb.allowedDomains) ? smb.allowedDomains : []
    });

    await monitor.start();
    scanMailboxMonitors.set(smb.imapEmail, monitor);
    console.log(`[ScanMailbox] Monitor started: ${smb.imapEmail} (${smb.imapHost}:${smb.imapPort || 993})`);
}

module.exports = { scanMailboxMonitors, startScanMailboxMonitor };
