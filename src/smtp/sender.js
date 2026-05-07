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

module.exports = { sendReportEmail, testSmtpConnection };
