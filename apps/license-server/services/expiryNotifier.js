'use strict';
// Günlük lisans bitiş kontrolü ve bildirim göndericisi.
// server.js içinden startExpiryNotifier() ile başlatılır.
const { get, all, run, isMaria } = require('../db');
const { sendExpiryNotification } = require('../lib/notificationMailer');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 saat

async function _getSettings() {
    try {
        const row = await get("SELECT setting_value FROM admin_settings WHERE setting_key = 'expiry_notifications'");
        return row ? JSON.parse(row.setting_value) : null;
    } catch (_) { return null; }
}

async function runExpiryCheck() {
    const cfg = await _getSettings();
    if (!cfg?.enabled) return;

    const notifyDays = Array.isArray(cfg.notifyBeforeDays) ? cfg.notifyBeforeDays : [30, 7, 1];
    if (!notifyDays.length) return;
    if (!cfg.smtpHost || !cfg.smtpUser || !cfg.fromEmail) {
        console.warn('[ExpiryNotifier] SMTP ayarları eksik — bildirim gönderilemiyor.');
        return;
    }

    const now = Date.now();
    const maxDays = Math.max(...notifyDays);

    // Önümüzdeki maxDays gün içinde biten aktif lisansları getir
    const licenses = await all(
        `SELECT l.id, l.plan, l.tier, l.expires_at, l.license_key_masked,
                c.id AS customer_id, c.company_name, c.email AS customer_email,
                d.name AS dealer_name
         FROM licenses l
         LEFT JOIN customers c ON c.id = l.customer_id
         LEFT JOIN dealers   d ON d.id = l.dealer_id
         WHERE l.status = 'active'
           AND l.expires_at IS NOT NULL
           AND l.expires_at > ?
           AND l.expires_at <= ?`,
        [now, now + maxDays * 86400 * 1000]
    );

    let sent = 0;
    for (const lic of licenses) {
        const daysLeft = Math.ceil((lic.expires_at - now) / 86400000);
        for (const threshold of notifyDays) {
            if (daysLeft > threshold) continue;

            // Zaten bu threshold için bildirim gönderilmiş mi?
            const already = await get(
                'SELECT id FROM license_notifications WHERE license_id = ? AND days_before = ?',
                [lic.id, threshold]
            );
            if (already) continue;

            try {
                await sendExpiryNotification(cfg, {
                    id:            lic.id,
                    customerId:    lic.customer_id,
                    companyName:   lic.company_name,
                    customerEmail: lic.customer_email,
                    plan:          lic.plan,
                    tier:          lic.tier,
                    expiresAt:     lic.expires_at,
                    keyMasked:     lic.license_key_masked,
                    dealerName:    lic.dealer_name
                }, daysLeft);

                const insertSql = isMaria
                    ? 'INSERT IGNORE INTO license_notifications(license_id, days_before, sent_at) VALUES(?,?,?)'
                    : 'INSERT OR IGNORE INTO license_notifications(license_id, days_before, sent_at) VALUES(?,?,?)';
                await run(insertSql, [lic.id, threshold, now]);
                sent++;
                console.log(`[ExpiryNotifier] Bildirim gönderildi: ${lic.id} (${daysLeft} gün kaldı, threshold=${threshold})`);
            } catch (e) {
                console.error(`[ExpiryNotifier] Mail gönderilemedi (${lic.id}):`, e.message);
            }
        }
    }

    if (sent > 0) console.log(`[ExpiryNotifier] Toplam ${sent} bildirim gönderildi.`);
}

function startExpiryNotifier() {
    // İlk kontrol: DB'nin yerleşmesi için 60s bekle
    const initial = setTimeout(async () => {
        try { await runExpiryCheck(); } catch (e) { console.error('[ExpiryNotifier] ilk kontrol hatası:', e.message); }
    }, 60_000);
    if (initial.unref) initial.unref();

    const interval = setInterval(async () => {
        try { await runExpiryCheck(); } catch (e) { console.error('[ExpiryNotifier] kontrol hatası:', e.message); }
    }, CHECK_INTERVAL_MS);
    if (interval.unref) interval.unref();

    console.log('[ExpiryNotifier] Günlük lisans bitiş bildirimi başlatıldı.');
}

module.exports = { startExpiryNotifier, runExpiryCheck };
