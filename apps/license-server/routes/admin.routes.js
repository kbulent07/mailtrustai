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
//   Bir müşterinin BIRDEN FAZLA lisansı olabilir — her lisans için ayrı row.
//   licenseCount alanı, aynı müşterinin toplam lisans sayısını gösterir.
// ============================================================
router.get('/admin/customers', adminAuth, asyncH(async (req, res) => {
    const { dealerId, plan, status, q } = req.query;

    let where = [];
    let params = [];
    if (dealerId) { where.push('c.dealer_id = ?'); params.push(dealerId); }
    if (plan)     { where.push('l.plan = ?');      params.push(plan); }
    if (status)   { where.push('l.status = ?');    params.push(status); }
    if (q)        {
        where.push('(c.company_name LIKE ? OR c.email LIKE ? OR c.id LIKE ? OR l.label LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
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
            l.label        AS license_label,
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

    // licenseCount: aynı customer'a kaç lisans (filtreden bağımsız, toplam)
    const countRows = await all(
        'SELECT customer_id, COUNT(*) AS c FROM licenses GROUP BY customer_id'
    );
    const countByCustomer = new Map(countRows.map(r => [r.customer_id, r.c]));

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
            licenseCount: countByCustomer.get(r.customer_id) || 0,
            license: r.license_id ? {
                id: r.license_id,
                plan: r.plan,
                tier: r.tier,
                status: r.license_status,
                keyMasked: r.license_key_masked,
                label: r.license_label,
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
// GET /api/admin/customers-grouped — Müşteri başına 1 row, lisanslar array
//   Bir müşterinin N lisansı varsa hepsi licenses[] içinde döner.
// ============================================================
router.get('/admin/customers-grouped', adminAuth, asyncH(async (req, res) => {
    const { dealerId, q } = req.query;
    let where = [];
    let params = [];
    if (dealerId) { where.push('c.dealer_id = ?'); params.push(dealerId); }
    if (q)        {
        where.push('(c.company_name LIKE ? OR c.email LIKE ? OR c.id LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const customers = await all(`
        SELECT c.id AS customer_id, c.company_name, c.dealer_id, c.email, c.created_at,
               d.name AS dealer_name
        FROM customers c
        LEFT JOIN dealers d ON d.id = c.dealer_id
        ${whereSql}
        ORDER BY c.created_at DESC
    `, params);

    const out = [];
    for (const c of customers) {
        const licenses = await all(`
            SELECT id, plan, tier, status, license_key_masked, label,
                   issued_at, expires_at, grace_days, offline_grace_days_override
            FROM licenses
            WHERE customer_id = ?
            ORDER BY issued_at DESC
        `, [c.customer_id]);

        const activations = await all(`
            SELECT a.license_id, a.instance_id, a.app_version, a.last_heartbeat_at
            FROM activations a
            JOIN licenses l ON l.id = a.license_id
            WHERE l.customer_id = ?
        `, [c.customer_id]);

        out.push({
            customerId: c.customer_id,
            companyName: c.company_name,
            email: c.email,
            dealerId: c.dealer_id,
            dealerName: c.dealer_name,
            customerCreatedAt: c.created_at,
            licenseCount: licenses.length,
            activeCount: licenses.filter(l => l.status === 'active').length,
            licenses: licenses.map(l => ({
                id: l.id,
                plan: l.plan,
                tier: l.tier,
                status: l.status,
                keyMasked: l.license_key_masked,
                label: l.label,
                issuedAt: l.issued_at,
                expiresAt: l.expires_at,
                graceDays: l.grace_days,
                offlineGraceOverride: l.offline_grace_days_override,
                activations: activations.filter(a => a.license_id === l.id).map(a => ({
                    instanceId: a.instance_id,
                    appVersion: a.app_version,
                    lastHeartbeatAt: a.last_heartbeat_at
                }))
            }))
        });
    }

    res.json({ count: out.length, items: out });
}));

// ============================================================
// POST /api/admin/licenses/:id/label — lisansa etiket ata
// body: { label: string | null }   max 128 karakter
// ============================================================
router.post('/admin/licenses/:id/label', adminAuth, asyncH(async (req, res) => {
    const { label } = req.body || {};
    const licenseId = req.params.id;

    let v = null;
    if (label !== null && label !== undefined && String(label).trim() !== '') {
        v = String(label).trim().slice(0, 128);
    }

    const license = await get('SELECT id FROM licenses WHERE id = ?', [licenseId]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    await run('UPDATE licenses SET label = ? WHERE id = ?', [v, licenseId]);
    await audit('admin', 'license.label.set', licenseId, { label: v });

    res.json({ ok: true, licenseId, label: v });
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
// DEALER YÖNETİMİ (admin paneli)
// ============================================================
const { v4: uuid } = require('uuid');
let bcrypt = null;
try { bcrypt = require('bcrypt'); } catch (_) {}

// POST /api/admin/dealers — yeni bayi olustur
router.post('/admin/dealers', adminAuth, asyncH(async (req, res) => {
    const { id, name, email, password } = req.body || {};
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id gerekli' });
    if (id.length > 64) return res.status(400).json({ error: 'id 64 karakteri aşmamalı' });

    const existing = await get('SELECT id FROM dealers WHERE id = ?', [id]);
    if (existing) return res.status(409).json({ error: 'bu id mevcut' });

    let hash = null;
    if (password) {
        if (typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'parola 8+ karakter olmalı' });
        }
        if (!bcrypt) return res.status(503).json({ error: 'bcrypt kurulu değil' });
        hash = bcrypt.hashSync(password, 10);
    }

    await run('INSERT INTO dealers(id, name, email, api_token_hash, credits, created_at) VALUES(?,?,?,?,?,?)',
        [id, name || id, email || null, hash, 0, Date.now()]);
    await audit('admin', 'dealer.create', id, { name, email, hasPassword: !!hash });
    res.json({ ok: true, id, name: name || id, email: email || null });
}));

// POST /api/admin/dealers/:id/password — parolayi guncelle/set
router.post('/admin/dealers/:id/password', adminAuth, asyncH(async (req, res) => {
    const { password } = req.body || {};
    if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'parola 8+ karakter olmalı' });
    }
    if (!bcrypt) return res.status(503).json({ error: 'bcrypt kurulu değil' });

    const dealer = await get('SELECT id FROM dealers WHERE id = ?', [req.params.id]);
    if (!dealer) return res.status(404).json({ error: 'bayi bulunamadı' });

    const hash = bcrypt.hashSync(password, 10);
    await run('UPDATE dealers SET api_token_hash = ? WHERE id = ?', [hash, req.params.id]);
    await audit('admin', 'dealer.password.set', req.params.id, null);
    res.json({ ok: true });
}));

// DELETE /api/admin/dealers/:id — bayi sil (yumusak: customer.dealer_id NULL kalir)
router.delete('/admin/dealers/:id', adminAuth, asyncH(async (req, res) => {
    const dealer = await get('SELECT id FROM dealers WHERE id = ?', [req.params.id]);
    if (!dealer) return res.status(404).json({ error: 'bayi bulunamadı' });
    // 0001 migration: customers.dealer_id ON DELETE SET NULL (mariadb) / no-action (sqlite)
    // SQLite tarafinda foreign_keys=ON, FK NULL'a set olur ya da silme reddedilir.
    // Once musteri lisanslarini orphan etmemek icin dealer_id'leri NULL'a cevirelim
    await run('UPDATE customers SET dealer_id = NULL WHERE dealer_id = ?', [req.params.id]);
    await run('UPDATE licenses SET dealer_id = NULL WHERE dealer_id = ?', [req.params.id]);
    await run('DELETE FROM dealers WHERE id = ?', [req.params.id]);
    await audit('admin', 'dealer.delete', req.params.id, null);
    res.json({ ok: true });
}));

// ============================================================
// LİSANS YÖNETİMİ (admin direkt)
// ============================================================
const { sha256 } = require('@mailtrustai/security');
const { generateLicenseKey, getPlan, PLAN_MATRIX } = require('@mailtrustai/license-core');

// POST /api/admin/licenses — admin'in direkt lisans uretmesi
router.post('/admin/licenses', adminAuth, asyncH(async (req, res) => {
    const { customerId, dealerId, plan = 'pro', companyName, email, validDays = 365, label } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'customerId gerekli' });
    const validDaysNum = Number(validDays);
    if (!Number.isFinite(validDaysNum) || validDaysNum <= 0 || validDaysNum > 36500) {
        return res.status(400).json({ error: 'validDays 1..36500 olmalı' });
    }
    if (!PLAN_MATRIX[plan]) {
        return res.status(400).json({ error: `plan geçersiz: ${plan}` });
    }
    const labelClean = (typeof label === 'string' && label.trim()) ? label.trim().slice(0, 128) : null;

    if (dealerId) {
        const dlr = await get('SELECT id FROM dealers WHERE id = ?', [dealerId]);
        if (!dlr) return res.status(400).json({ error: `dealer bulunamadı: ${dealerId}` });
    }

    const upsertSql = isMariaCheck()
        ? `INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             dealer_id    = COALESCE(VALUES(dealer_id), dealer_id),
             company_name = COALESCE(VALUES(company_name), company_name),
             email        = COALESCE(VALUES(email), email)`
        : `INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             dealer_id    = COALESCE(excluded.dealer_id,   customers.dealer_id),
             company_name = COALESCE(excluded.company_name, customers.company_name),
             email        = COALESCE(excluded.email,       customers.email)`;
    await run(upsertSql, [customerId, dealerId || null, companyName || null, email || null, Date.now()]);

    const planDef = getPlan(plan);
    const { key, keyHash } = generateLicenseKey({ customerId, dealerId, plan });
    const id = uuid();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + validDaysNum * 86400 * 1000;

    await run(
        `INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,label)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, customerId, dealerId || null, keyHash, `${key.slice(0, 8)}…${key.slice(-4)}`, plan, planDef.tier, 'active', issuedAt, expiresAt, planDef.graceDays, JSON.stringify(planDef.features), JSON.stringify(planDef.limits), labelClean]
    );
    await audit('admin', 'license.create', id, { customerId, dealerId, plan, label: labelClean, source: 'admin-panel' });

    res.json({ ok: true, id, licenseKey: key, plan, tier: planDef.tier, expiresAt, label: labelClean });
}));

function isMariaCheck() {
    // db.isMaria getter — admin.routes en üstte require edildi
    return require('../db').isMaria;
}

// POST /api/admin/licenses/:id/revoke
router.post('/admin/licenses/:id/revoke', adminAuth, asyncH(async (req, res) => {
    const { reason } = req.body || {};
    const license = await get('SELECT id, customer_id FROM licenses WHERE id = ?', [req.params.id]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });
    await run("UPDATE licenses SET status = 'revoked' WHERE id = ?", [req.params.id]);
    await audit('admin', 'license.revoke', req.params.id, { reason: reason || null });
    res.json({ ok: true });
}));

// POST /api/admin/licenses/:id/unrevoke — yeniden aktive et
router.post('/admin/licenses/:id/unrevoke', adminAuth, asyncH(async (req, res) => {
    const license = await get('SELECT id, expires_at FROM licenses WHERE id = ?', [req.params.id]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });
    await run("UPDATE licenses SET status = 'active' WHERE id = ?", [req.params.id]);
    await audit('admin', 'license.unrevoke', req.params.id, null);
    res.json({ ok: true });
}));

// POST /api/admin/licenses/:id/renew { addDays }
router.post('/admin/licenses/:id/renew', adminAuth, asyncH(async (req, res) => {
    const { addDays = 365 } = req.body || {};
    const days = Number(addDays);
    if (!Number.isFinite(days) || days <= 0 || days > 36500) {
        return res.status(400).json({ error: 'addDays geçersiz' });
    }
    const license = await get('SELECT id, expires_at FROM licenses WHERE id = ?', [req.params.id]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });
    const newExpiry = Math.max(license.expires_at || Date.now(), Date.now()) + days * 86400 * 1000;
    await run("UPDATE licenses SET expires_at = ?, status = 'active' WHERE id = ?", [newExpiry, req.params.id]);
    await audit('admin', 'license.renew', req.params.id, { addDays: days, newExpiry });
    res.json({ ok: true, expiresAt: newExpiry });
}));

// ============================================================
// GET /api/admin/audit — filtreli
// ============================================================
router.get('/admin/audit', adminAuth, asyncH(async (req, res) => {
    const { actor, action, target, limit, since } = req.query;
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);

    let where = [];
    let params = [];
    if (actor)  { where.push('actor LIKE ?');  params.push(`%${actor}%`); }
    if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
    if (target) { where.push('target LIKE ?'); params.push(`%${target}%`); }
    if (since)  {
        const s = Number(since);
        if (Number.isFinite(s)) { where.push('ts >= ?'); params.push(s); }
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = await all(
        `SELECT id, ts, actor, action, target, detail_json FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ?`,
        [...params, lim]
    );
    res.json({ count: rows.length, entries: rows });
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
