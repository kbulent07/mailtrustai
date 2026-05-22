const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Rapor maili işareti — saldırgan rapor öneki taklit edip self-loop bypass
// yapmasın diye HMAC ile imzalı, sadece BU kurulum tarafından üretilebilen
// bir header değeri ekleriz. scanMailboxMonitor self-loop kontrolünde bu
// header'ın değil sadece subject prefix'in varlığına da bakar (zayıf check).
const REPORT_HEADER_NAME = 'X-MailTrustAI-Report-Id';

/**
 * Bu kuruluma özgü HMAC anahtarı — runtime'da rastgele üretilir.
 * Process restart'ta değişir ama bu sorun değil: eski rapor mailler
 * yine subject prefix ile yakalanır (yedek check). Yeni mailler yeni
 * key ile imzalanır.
 */
const _REPORT_HMAC_KEY = process.env.MSA_REPORT_HMAC_KEY ||
    crypto.randomBytes(32).toString('hex');

function buildReportId() {
    const ts = Date.now().toString(36);
    const nonce = crypto.randomBytes(6).toString('hex');
    const payload = `${ts}.${nonce}`;
    const sig = crypto.createHmac('sha256', _REPORT_HMAC_KEY)
        .update(payload).digest('hex').slice(0, 16);
    return `${payload}.${sig}`;
}

function verifyReportId(id) {
    if (!id || typeof id !== 'string') return false;
    const parts = id.split('.');
    if (parts.length !== 3) return false;
    const [ts, nonce, sig] = parts;
    const expected = crypto.createHmac('sha256', _REPORT_HMAC_KEY)
        .update(`${ts}.${nonce}`).digest('hex').slice(0, 16);
    // timing-safe karşılaştırma
    try {
        const a = Buffer.from(sig, 'hex');
        const b = Buffer.from(expected, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) { return false; }
}

async function sendReportEmail({ smtpConfig, to, from, subject, htmlBody }) {
    const transport = nodemailer.createTransport({
        host: smtpConfig.smtpHost,
        port: smtpConfig.smtpPort || 587,
        secure: smtpConfig.smtpSecure === true,
        auth: {
            user: smtpConfig.smtpUser,
            pass: smtpConfig.smtpPassword
        },
        tls: {
            rejectUnauthorized: smtpConfig.smtpRejectUnauthorized !== false
        }
    });

    try {
        const reportId = buildReportId();
        const info = await transport.sendMail({
            from, to, subject, html: htmlBody,
            headers: { [REPORT_HEADER_NAME]: reportId }
        });
        return { success: true, messageId: info.messageId, reportId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function testSmtpConnection(smtpConfig) {
    const transport = nodemailer.createTransport({
        host: smtpConfig.smtpHost,
        port: smtpConfig.smtpPort || 587,
        secure: smtpConfig.smtpSecure === true,
        auth: {
            user: smtpConfig.smtpUser,
            pass: smtpConfig.smtpPassword
        },
        tls: {
            rejectUnauthorized: smtpConfig.smtpRejectUnauthorized !== false
        }
    });

    try {
        await transport.verify();
        return { success: true, message: 'SMTP bağlantısı başarılı' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

function _systemTransport() {
    const { loadSettings } = require('../storage/settingsStore');
    const s = loadSettings();
    const cfg = s.systemSmtp || {};
    if (!cfg.host || !cfg.user || !s.systemSmtpPassword) return null;
    return nodemailer.createTransport({
        host:   cfg.host,
        port:   Number(cfg.port) || 587,
        secure: cfg.secure === true,
        auth:   { user: cfg.user, pass: s.systemSmtpPassword },
        tls:    { rejectUnauthorized: false }
    });
}

async function sendSystemEmail({ to, subject, htmlBody }) {
    const transport = _systemTransport();
    if (!transport) return { success: false, error: 'Sistem SMTP yapılandırılmamış.' };
    const { loadSettings } = require('../storage/settingsStore');
    const s = loadSettings();
    const fromName = s.systemSmtp?.fromName || 'MailTrustAI';
    const fromAddr = s.systemSmtp?.user || '';
    try {
        const info = await transport.sendMail({
            from: `"${fromName}" <${fromAddr}>`,
            to, subject, html: htmlBody
        });
        return { success: true, messageId: info.messageId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function testSystemSmtp() {
    const transport = _systemTransport();
    if (!transport) return { success: false, message: 'Sistem SMTP yapılandırılmamış.' };
    try {
        await transport.verify();
        return { success: true, message: 'Sistem SMTP bağlantısı başarılı' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

module.exports = {
    sendReportEmail, testSmtpConnection, sendSystemEmail, testSystemSmtp,
    REPORT_HEADER_NAME, verifyReportId, buildReportId
};
