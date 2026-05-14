const nodemailer = require('nodemailer');

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
        const info = await transport.sendMail({ from, to, subject, html: htmlBody });
        return { success: true, messageId: info.messageId };
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

module.exports = { sendReportEmail, testSmtpConnection, sendSystemEmail, testSystemSmtp };
