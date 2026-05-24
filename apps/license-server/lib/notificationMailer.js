'use strict';
// Lisans bitiş bildirimi SMTP mailer.
// Ayarlar admin_settings tablosundan okunur (key: 'expiry_notifications').
const nodemailer = require('nodemailer');

function _buildTransport(cfg) {
    return nodemailer.createTransport({
        host:   cfg.smtpHost,
        port:   Number(cfg.smtpPort) || 587,
        secure: cfg.smtpSecure === true,
        auth:   { user: cfg.smtpUser, pass: cfg.smtpPassword },
        tls:    { rejectUnauthorized: cfg.smtpRejectUnauthorized !== false }
    });
}

/**
 * Bağlantıyı test eder. { ok: true } veya { ok: false, error: '...' } döner.
 */
async function testSmtpConnection(cfg) {
    try {
        const transport = _buildTransport(cfg);
        await transport.verify();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Lisans bitiş uyarısı maili gönderir.
 * @param {object} cfg    - SMTP + bildirim ayarları
 * @param {object} license - { id, customerEmail, companyName, plan, tier, expiresAt, keyMasked, dealerName }
 * @param {number} daysLeft - Kaç gün kaldı
 */
async function sendExpiryNotification(cfg, license, daysLeft) {
    const transport = _buildTransport(cfg);

    const expiryDate = new Date(license.expiresAt).toLocaleDateString('tr-TR', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    const subject = daysLeft <= 1
        ? `[MailTrustAI] Lisans BİTİYOR — ${license.companyName || license.customerId}`
        : `[MailTrustAI] Lisans ${daysLeft} gün içinde bitiyor — ${license.companyName || license.customerId}`;

    const to = [cfg.adminEmail].filter(Boolean);
    if (license.customerEmail) to.push(license.customerEmail);

    const html = `
<div style="font-family:sans-serif;max-width:540px;color:#1e2235">
  <div style="background:#1e2235;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
    <strong style="font-size:1.1em">MailTrustAI — Lisans Bitiş Uyarısı</strong>
  </div>
  <div style="border:1px solid #e0e4ef;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>Merhaba,</p>
    <p>Aşağıdaki lisansın geçerlilik süresi <strong style="color:${daysLeft <= 1 ? '#ef4444' : '#f59e0b'}">${daysLeft <= 1 ? 'bugün bitiyor' : `${daysLeft} gün içinde bitiyor`}</strong>:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#6b7280">Müşteri</td><td style="padding:8px 12px"><strong>${license.companyName || license.customerId}</strong></td></tr>
      <tr><td style="padding:8px 12px;color:#6b7280">Lisans</td><td style="padding:8px 12px"><code>${license.keyMasked || license.id}</code></td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#6b7280">Plan / Tier</td><td style="padding:8px 12px">${license.plan} / ${license.tier || '—'}</td></tr>
      ${license.dealerName ? `<tr><td style="padding:8px 12px;color:#6b7280">Bayi</td><td style="padding:8px 12px">${license.dealerName}</td></tr>` : ''}
      <tr ${license.dealerName ? 'style="background:#f8fafc"' : ''}><td style="padding:8px 12px;color:#6b7280">Bitiş Tarihi</td><td style="padding:8px 12px;color:${daysLeft <= 1 ? '#ef4444' : '#f59e0b'}"><strong>${expiryDate}</strong></td></tr>
    </table>
    <p style="font-size:.9em;color:#6b7280">Lisansı uzatmak için admin panelinize giriş yapın.</p>
  </div>
</div>`;

    await transport.sendMail({
        from: `"${cfg.fromName || 'MailTrustAI'}" <${cfg.fromEmail}>`,
        to:   to.join(', '),
        subject,
        html
    });
}

module.exports = { sendExpiryNotification, testSmtpConnection };
