'use strict';
// Admin (kurucu/geliştirici) paneli endpoint'leri — keygen.html SPA tarafından çağrılır.
// Auth: ADMIN_PANEL_TOKEN env'i (bayilerden AYRI bir secret).
//
// Bütün endpoint'ler bearer token doğrulamasından geçer (server.js ana
// middleware'i tarafından). Burada ek olarak ADMIN_PANEL_TOKEN kontrol edilir
// — DEALER_API_SECRET sahibi bayi yönetim panelinden geçemez.

const express = require('express');
const crypto = require('crypto');
const { asyncH, env, safeJSON, envInt } = require('@mailtrustai/shared');
const { all, get, run, audit } = require('../db');

const router = express.Router();

const ADMIN_TOKEN = env('ADMIN_PANEL_TOKEN') || '';
const isProd = String(env('NODE_ENV', 'development')).toLowerCase() === 'production';
if (!ADMIN_TOKEN && isProd) {
    // server.js boot probe — bu modul require edilirse direkt log uyarisi
    require('@mailtrustai/shared').logger.warn(
        '[admin] UYARI: ADMIN_PANEL_TOKEN tanımsız. Admin panel kullanılamaz (boot fail-fast yok — uçlar 401).'
    );
}

function adminAuth(req, res, next) {
    if (!ADMIN_TOKEN) return res.status(503).json({ error: 'admin panel kapalı (ADMIN_PANEL_TOKEN tanımsız)' });
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'admin token gerekli' });
    const tokenBuf = Buffer.from(m[1]);
    const expectBuf = Buffer.from(ADMIN_TOKEN);
    if (tokenBuf.length !== expectBuf.length) return res.status(401).json({ error: 'admin token gecersiz' });
    try {
        if (!crypto.timingSafeEqual(tokenBuf, expectBuf)) {
            return res.status(401).json({ error: 'admin token gecersiz' });
        }
    } catch (_) { return res.status(401).json({ error: 'admin token gecersiz' }); }
    req.actor = 'admin';
    next();
}

// ============================================================
// POST /api/admin/login  (public — token doğrulama + audit)
// ============================================================
router.post('/admin/login', asyncH(async (req, res) => {
    const { token } = req.body || {};
    if (!ADMIN_TOKEN) return res.status(503).json({ error: 'admin panel kapalı' });
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token gerekli' });
    const a = Buffer.from(token), b = Buffer.from(ADMIN_TOKEN);
    if (a.length !== b.length) {
        await audit('admin', 'admin.login.fail', null, { reason: 'bad-length' });
        return res.status(401).json({ error: 'gecersiz token' });
    }
    let ok = false;
    try { ok = crypto.timingSafeEqual(a, b); } catch (_) {}
    if (!ok) {
        await audit('admin', 'admin.login.fail', null, { reason: 'bad-token' });
        return res.status(401).json({ error: 'gecersiz token' });
    }
    await audit('admin', 'admin.login.ok', null, null);
    res.json({ ok: true, expiresIn: envInt('ADMIN_PANEL_SESSION_HOURS', 12) * 3600 });
}));

// ============================================================
// GET /api/admin/customers — TÜM müşteriler + lisansları + son aktivasyonları
// ============================================================
router.get('/admin/customers', adminAuth, asyncH(async (req, res) => {
    const { dealerId, plan, status, q } = req.query;

    let where = [];
    let params = [];
    if (dealerId) { where.push('c.dealer_id = ?'); params.push(dealerId); }
    if (plan)     { where.push('l.plan = ?');      params.push(plan); }
    if (status)   { where.push('l.status = ?');    params.push(status); }
    if (q)        {
        where.push('(c.company_name LIKE ? OR c.email LIKE ? OR c.id LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Lisans + customer + en son aktivasyon (1 lisansa 1 row — instance bilgisi dışarıya)
    const sql = `
        SELECT
            c.id           AS customer_id,
            c.company_name AS company_name,
            c.dealer_id    AS dealer_id,
            c.email        AS customer_email,
            c.created_at   AS customer_created_at,
            d.name         AS dealer_name,
            l.id           AS license_id,
            l.plan         AS plan,
            l.tier         AS tier,
            l.status       AS license_status,
            l.license_key_masked AS license_key_masked,
            l.issued_at    AS issued_at,
            l.expires_at   AS expires_at,
            l.grace_days   AS grace_days,
            l.offline_grace_days_override AS offline_override
        FROM customers c
        LEFT JOIN licenses l ON l.customer_id = c.id
        LEFT JOIN dealers  d ON d.id = c.dealer_id
        ${whereSql}
        ORDER BY c.created_at DESC, l.issued_at DESC
    `;
    const rows = await all(sql, params);

    // Her lisans için son aktivasyon (en güncel heartbeat)
    const items = [];
    for (const r of rows) {
        let latestAct = null;
        if (r.license_id) {
            latestAct = await get(
                `SELECT instance_id, app_version, environment, last_heartbeat_at, last_payload_json
                 FROM activations
                 WHERE license_id = ?
                 ORDER BY last_heartbeat_at DESC NULLS LAST
                 LIMIT 1`,
                [r.license_id]
            ).catch(async () => {
                // SQLite NULLS LAST'i 3.30+'da destekler; yoksa fallback
                return get(
                    `SELECT instance_id, app_version, environment, last_heartbeat_at, last_payload_json
                     FROM activations WHERE license_id = ?
                     ORDER BY COALESCE(last_heartbeat_at, 0) DESC LIMIT 1`,
                    [r.license_id]
                );
            });
        }
        const payload = safeJSON(latestAct?.last_payload_json, {});
        const onlineThreshold = envInt('HEARTBEAT_ONLINE_THRESHOLD_SECONDS', 300) * 1000;
        const staleThreshold = envInt('HEARTBEAT_STALE_THRESHOLD_SECONDS', 1800) * 1000;
        const age = latestAct?.last_heartbeat_at ? Date.now() - latestAct.last_heartbeat_at : null;
        const onlineStatus = !age ? 'never' : age <= onlineThreshold ? 'online' : age <= staleThreshold ? 'stale' : 'offline';

        items.push({
            customerId: r.customer_id,
            companyName: r.company_name,
            email: r.customer_email,
            dealerId: r.dealer_id,
            dealerName: r.dealer_name,
            customerCreatedAt: r.customer_created_at,
            license: r.license_id ? {
                id: r.license_id,
                plan: r.plan,
                tier: r.tier,
                status: r.license_status,
                keyMasked: r.license_key_masked,
                issuedAt: r.issued_at,
                expiresAt: r.expires_at,
                graceDays: r.grace_days,
                offlineGraceOverride: r.offline_override
            } : null,
            latest: latestAct ? {
                instanceId: latestAct.instance_id,
                appVersion: latestAct.app_version,
                environment: latestAct.environment,
                lastHeartbeatAt: latestAct.last_heartbeat_at,
                onlineStatus,
                monthlyScanCount: payload.monthlyScanCount ?? null,
                enabledFeatures: payload.enabledFeatures || null,
                healthStatus: payload.healthStatus || null
            } : null
        });
    }

    res.json({ count: items.length, items });
}));

// ============================================================
// GET /api/admin/licenses — sade liste (tablo için)
// ============================================================
router.get('/admin/licenses', adminAuth, asyncH(async (req, res) => {
    const rows = await all(
        `SELECT l.id, l.customer_id, l.dealer_id, l.plan, l.tier, l.status,
                l.license_key_masked, l.issued_at, l.expires_at, l.grace_days,
                l.offline_grace_days_override
         FROM licenses l ORDER BY l.issued_at DESC`
    );
    res.json({ count: rows.length, licenses: rows });
}));

// ============================================================
// POST /api/admin/licenses/:id/offline-grace
// body: { days: number | null }   (null = override sil — plan default'a dön)
// ============================================================
router.post('/admin/licenses/:id/offline-grace', adminAuth, asyncH(async (req, res) => {
    const { days } = req.body || {};
    const licenseId = req.params.id;

    let override;
    if (days === null || days === undefined) {
        override = null;
    } else {
        const n = Number(days);
        if (!Number.isFinite(n) || n < 0 || n > 36500) {
            return res.status(400).json({ error: 'days 0..36500 arası tamsayı olmalı' });
        }
        override = Math.floor(n);
    }

    const license = await get('SELECT id, customer_id FROM licenses WHERE id = ?', [licenseId]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    await run('UPDATE licenses SET offline_grace_days_override = ? WHERE id = ?', [override, licenseId]);
    await audit('admin', 'license.offline_grace.set', licenseId, { override });

    res.json({ ok: true, licenseId, offlineGraceOverride: override });
}));

// ============================================================
// POST /api/admin/offline-grace/bulk
// body: { days: number | null, dealerId?: string, plan?: string, status?: string }
//   Filtreler verilirse sadece eşleşen aktif lisanslara uygulanır.
//   Hepsi boşsa = TÜM AKTİF lisanslar.
// ============================================================
router.post('/admin/offline-grace/bulk', adminAuth, asyncH(async (req, res) => {
    const { days, dealerId, plan, status } = req.body || {};

    let override;
    if (days === null || days === undefined) {
        override = null;
    } else {
        const n = Number(days);
        if (!Number.isFinite(n) || n < 0 || n > 36500) {
            return res.status(400).json({ error: 'days 0..36500 arası tamsayı olmalı' });
        }
        override = Math.floor(n);
    }

    const where = [];
    const params = [];
    where.push("status = COALESCE(?, 'active')"); params.push(status || null);
    if (dealerId) { where.push('dealer_id = ?'); params.push(dealerId); }
    if (plan)     { where.push('plan = ?');      params.push(plan); }
    const whereSql = where.join(' AND ');

    // Önce kaç tane etkilenecek bak
    const countRow = await get(`SELECT COUNT(*) AS c FROM licenses WHERE ${whereSql}`, params);
    const affectedExpected = countRow?.c || 0;

    await run(`UPDATE licenses SET offline_grace_days_override = ? WHERE ${whereSql}`, [override, ...params]);
    await audit('admin', 'license.offline_grace.bulk', null,
        { override, filter: { dealerId, plan, status: status || 'active' }, expected: affectedExpected });

    res.json({ ok: true, expected: affectedExpected, override });
}));

// ============================================================
// GET /api/admin/dealers — bulk filter dropdown'lar için
// ============================================================
router.get('/admin/dealers', adminAuth, asyncH(async (req, res) => {
    const rows = await all('SELECT id, name, email, created_at FROM dealers ORDER BY name');
    res.json({ dealers: rows });
}));

// ============================================================
// GET /api/admin/stats — özet kart'lar için
// ============================================================
router.get('/admin/stats', adminAuth, asyncH(async (req, res) => {
    const total = await get('SELECT COUNT(*) AS c FROM customers');
    const activeLic = await get("SELECT COUNT(*) AS c FROM licenses WHERE status = 'active'");
    const expiredLic = await get('SELECT COUNT(*) AS c FROM licenses WHERE expires_at IS NOT NULL AND expires_at < ?', [Date.now()]);
    const revokedLic = await get("SELECT COUNT(*) AS c FROM licenses WHERE status = 'revoked'");
    const dealers = await get('SELECT COUNT(*) AS c FROM dealers');
    const onlineThreshold = envInt('HEARTBEAT_ONLINE_THRESHOLD_SECONDS', 300) * 1000;
    const onlineRow = await get(
        'SELECT COUNT(DISTINCT license_id) AS c FROM activations WHERE last_heartbeat_at > ?',
        [Date.now() - onlineThreshold]
    );

    res.json({
        customers: total?.c || 0,
        licensesActive: activeLic?.c || 0,
        licensesExpired: expiredLic?.c || 0,
        licensesRevoked: revokedLic?.c || 0,
        dealers: dealers?.c || 0,
        onlineNow: onlineRow?.c || 0
    });
}));

module.exports = router;
