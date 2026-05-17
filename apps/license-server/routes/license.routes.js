'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const { asyncH, safeJSON } = require('@mailtrustai/shared');
const { sha256 } = require('@mailtrustai/security');
const { generateLicenseKey, getPlan, PLAN_MATRIX } = require('@mailtrustai/license-core');
const { get, all, run, audit, isMaria } = require('../db');

const router = express.Router();

function badRequest(res, msg) { return res.status(400).json({ error: msg }); }

const HASH_RE = /^[a-f0-9]{64}$/i;
function assertHash(res, h, field = 'licenseKeyHash') {
    if (typeof h !== 'string' || !HASH_RE.test(h)) {
        badRequest(res, `${field} sha256 hex (64 karakter) olmalı`);
        return false;
    }
    return true;
}

// Tek customer üzerinde aynı anda max aktivasyon. limits.maxActivations
// plan tarafından gelmiyorsa default 10.
const DEFAULT_MAX_ACTIVATIONS = 10;

// POST /license/customers — Müşteri kaydı oluştur/güncelle (lisans üretmeden).
// Bayi yeni bir müşteri eklerken önce bu endpoint'i çağırabilir.
router.post('/license/customers', asyncH(async (req, res) => {
    const { customerId, dealerId, companyName, email } = req.body || {};
    if (!customerId || typeof customerId !== 'string') {
        return badRequest(res, 'customerId gerekli');
    }
    const upsertSql = isMaria
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
    await audit(dealerId || 'admin', 'customer.create', customerId, { companyName, email, source: 'dealer' });
    res.json({ ok: true, customerId, dealerId: dealerId || null, companyName: companyName || null, email: email || null });
}));

router.post('/license/create', asyncH(async (req, res) => {
    const { customerId, dealerId, plan = 'pro', companyName, email, label } = req.body || {};
    const validDays = Number(req.body?.validDays ?? 365);
    if (!customerId) return badRequest(res, 'customerId gerekli');
    if (!Number.isFinite(validDays) || validDays <= 0 || validDays > 36500) {
        return badRequest(res, 'validDays geçersiz (1..36500)');
    }
    if (!PLAN_MATRIX[plan]) {
        return badRequest(res, `plan geçersiz: ${plan}. Geçerli: ${Object.keys(PLAN_MATRIX).join(', ')}`);
    }
    // Label opsiyonel — boş string null'a dönüşür.
    const licenseLabel = (typeof label === 'string' && label.trim()) ? label.trim().slice(0, 128) : null;

    // UPSERT: dealer transferi/şirket adı güncellemesi mümkün.
    const upsertSql = isMaria
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
    const expiresAt = issuedAt + validDays * 86400 * 1000;

    await run(
        `INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,label)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, customerId, dealerId || null, keyHash, `${key.slice(0, 8)}…${key.slice(-4)}`, plan, planDef.tier, 'active', issuedAt, expiresAt, planDef.graceDays, JSON.stringify(planDef.features), JSON.stringify(planDef.limits), licenseLabel]
    );

    await audit(dealerId || 'admin', 'license.create', id, { customerId, plan, label: licenseLabel });
    res.json({ ok: true, id, licenseKey: key, plan, tier: planDef.tier, expiresAt, label: licenseLabel, features: planDef.features, limits: planDef.limits });
}));

router.post('/license/activate', asyncH(async (req, res) => {
    const { licenseKey, instanceId, appVersion, buildVersion, nodeVersion, environment, hostnameHash } = req.body || {};
    if (!licenseKey || !instanceId) return badRequest(res, 'licenseKey ve instanceId gerekli');
    if (typeof licenseKey !== 'string' || typeof instanceId !== 'string') {
        return badRequest(res, 'licenseKey ve instanceId string olmalı');
    }
    if (instanceId.length > 128 || licenseKey.length > 512) return badRequest(res, 'alan çok uzun');

    const keyHash = sha256(licenseKey);
    const license = await get('SELECT * FROM licenses WHERE license_key_hash = ?', [keyHash]);
    if (!license) {
        await audit(null, 'license.activate.fail', null, { reason: 'unknown-key' });
        return res.status(404).json({ error: 'lisans bulunamadı' });
    }
    if (license.status !== 'active') return res.status(403).json({ error: `lisans durumu: ${license.status}` });
    if (license.expires_at && license.expires_at < Date.now()) return res.status(403).json({ error: 'lisans süresi dolmuş' });

    // maxActivations limiti.
    const limits = safeJSON(license.limits_json, {});
    const maxAct = Number(limits.maxActivations) > 0 ? Number(limits.maxActivations) : DEFAULT_MAX_ACTIVATIONS;

    // TOCTOU önlemi: önce UPSERT yap, sonra count kontrol; aşıldıysa rollback.
    // Aynı instanceId için yeniden activate idempotent (UPSERT). Yeni instanceId
    // limit aşıyorsa eklenen satırı sil. Bu yaklaşım iki paralel /activate'te
    // bile en fazla 1 fazla geçici satır yaratır ve hemen temizler.
    const activationId = uuid();
    const sql = isMaria
        ? `INSERT INTO activations(id,license_id,instance_id,hostname_hash,app_version,build_version,node_version,environment,activated_at,last_heartbeat_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
               hostname_hash=VALUES(hostname_hash),
               app_version=VALUES(app_version),
               build_version=VALUES(build_version),
               node_version=VALUES(node_version),
               environment=VALUES(environment),
               last_heartbeat_at=VALUES(last_heartbeat_at)`
        : `INSERT INTO activations(id,license_id,instance_id,hostname_hash,app_version,build_version,node_version,environment,activated_at,last_heartbeat_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(license_id,instance_id) DO UPDATE SET
               hostname_hash=excluded.hostname_hash,
               app_version=excluded.app_version,
               build_version=excluded.build_version,
               node_version=excluded.node_version,
               environment=excluded.environment,
               last_heartbeat_at=excluded.last_heartbeat_at`;
    await run(sql, [activationId, license.id, instanceId, hostnameHash || null, appVersion || null, buildVersion || null, nodeVersion || null, environment || null, Date.now(), Date.now()]);

    // Post-insert count: limit aşıldıysa eklenen satırı geri al (sadece bu instance yeni eklendiyse).
    const countRow = await get('SELECT COUNT(*) AS c FROM activations WHERE license_id=?', [license.id]);
    if ((countRow?.c || 0) > maxAct) {
        // Bu instance daha önce vardıysa UPSERT idempotent — count zaten <= maxAct olmalıydı.
        // Bu noktaya geldiysek bu çağrı sınırı aşan yeni instance'tır → temizle.
        await run('DELETE FROM activations WHERE license_id=? AND instance_id=? AND activated_at>=?',
            [license.id, instanceId, Date.now() - 5000]);
        await audit(license.customer_id, 'license.activate.fail', license.id, { reason: 'max-activations', max: maxAct });
        return res.status(403).json({ error: `maksimum aktivasyon aşıldı (${maxAct})` });
    }

    const activation = await get('SELECT id FROM activations WHERE license_id=? AND instance_id=?', [license.id, instanceId]);

    await audit(license.customer_id, 'license.activate', license.id, { instanceId, appVersion });
    res.json({
        activationId: activation?.id || activationId,
        customerId: license.customer_id,
        dealerId: license.dealer_id,
        plan: license.plan,
        tier: license.tier,
        expiresAt: license.expires_at,
        graceDays: license.grace_days,
        // Admin paneli (keygen.html) tarafından set edilen offline grace override.
        // Customer license-client graceCheck()'te bunu graceDays yerine kullanır.
        offlineGraceDaysOverride: license.offline_grace_days_override ?? null,
        features: safeJSON(license.features_json, {}),
        limits,
        licenseStatus: license.status
    });
}));

router.post('/license/validate', asyncH(async (req, res) => {
    const { licenseKeyHash, instanceId } = req.body || {};
    if (!licenseKeyHash || !instanceId) return badRequest(res, 'licenseKeyHash ve instanceId gerekli');
    if (!assertHash(res, licenseKeyHash)) return;
    if (typeof instanceId !== 'string' || instanceId.length > 128) return badRequest(res, 'instanceId geçersiz');

    const license = await get('SELECT * FROM licenses WHERE license_key_hash = ?', [licenseKeyHash]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    const activation = await get(
        'SELECT id FROM activations WHERE license_id=? AND instance_id=?',
        [license.id, instanceId]
    );
    if (!activation) {
        await audit(license.customer_id, 'license.validate.fail', license.id, { reason: 'no-activation', instanceId });
        return res.status(403).json({ error: 'aktivasyon bulunamadı' });
    }

    const expired = license.expires_at && license.expires_at < Date.now();
    res.json({
        licenseStatus: expired ? 'expired' : license.status,
        plan: license.plan,
        tier: license.tier,
        expiresAt: license.expires_at,
        graceDays: license.grace_days,
        offlineGraceDaysOverride: license.offline_grace_days_override ?? null,
        features: safeJSON(license.features_json, {}),
        limits: safeJSON(license.limits_json, {})
    });
}));

router.post('/license/heartbeat', asyncH(async (req, res) => {
    const { licenseKeyHash, instanceId } = req.body || {};
    if (!licenseKeyHash || !instanceId) return badRequest(res, 'licenseKeyHash ve instanceId gerekli');
    if (!assertHash(res, licenseKeyHash)) return;
    if (typeof instanceId !== 'string' || instanceId.length > 128) return badRequest(res, 'instanceId geçersiz');

    const license = await get('SELECT id FROM licenses WHERE license_key_hash = ?', [licenseKeyHash]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    // Tüm body'yi değil — sadece güvenli telemetri alanlarını sakla (server-side whitelist).
    const SAFE_KEYS = ['appVersion', 'buildVersion', 'nodeVersion', 'environment', 'healthStatus',
        'monthlyScanCount', 'dailyScanCount', 'mailboxCount', 'userCount',
        'localPolicyVersion', 'localWhitelistVersion', 'localBlacklistVersion', 'localApiConfigVersion',
        'enabledFeatures', 'services', 'errorSummary'];
    const safePayload = {};
    for (const k of SAFE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) safePayload[k] = req.body[k];
    }
    await run('UPDATE activations SET last_heartbeat_at=?, last_payload_json=? WHERE license_id=? AND instance_id=?',
        [Date.now(), JSON.stringify(safePayload), license.id, instanceId]);
    res.json({ ok: true, serverTime: Date.now() });
}));

function assertOwnership(license, dealerId) {
    if (dealerId && license.dealer_id !== dealerId) {
        const error = new Error('bu lisans bu bayiye ait değil');
        error.status = 403;
        throw error;
    }
}

router.post('/license/revoke', asyncH(async (req, res) => {
    const { id, licenseKeyHash, reason, dealerId } = req.body || {};
    const license = id
        ? await get('SELECT * FROM licenses WHERE id=?', [id])
        : await get('SELECT * FROM licenses WHERE license_key_hash=?', [licenseKeyHash]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    assertOwnership(license, dealerId);
    await run('UPDATE licenses SET status=? WHERE id=?', ['revoked', license.id]);
    await audit(dealerId || 'admin', 'license.revoke', license.id, { reason });
    res.json({ ok: true });
}));

router.post('/license/renew', asyncH(async (req, res) => {
    const { id, addDays = 365, dealerId } = req.body || {};
    const days = Number(addDays);
    if (!Number.isFinite(days) || days <= 0 || days > 36500) return badRequest(res, 'addDays geçersiz');

    const license = await get('SELECT * FROM licenses WHERE id=?', [id]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    assertOwnership(license, dealerId);
    const expiresAt = Math.max(license.expires_at || Date.now(), Date.now()) + days * 86400 * 1000;
    await run('UPDATE licenses SET expires_at=?, status=? WHERE id=?', [expiresAt, 'active', license.id]);
    await audit(dealerId || 'admin', 'license.renew', license.id, { addDays: days, newExpiry: expiresAt });
    res.json({ ok: true, expiresAt });
}));

// ============================================================
// Dealer scope zorunlu: dealerId query param ile filtre.
// ============================================================
router.get('/license/customer/:id', asyncH(async (req, res) => {
    const dealerId = req.query.dealerId;
    if (!dealerId) return res.status(400).json({ error: 'dealerId query param zorunlu' });

    const rows = await all(
        'SELECT id, plan, tier, status, issued_at, expires_at FROM licenses WHERE customer_id=? AND dealer_id=?',
        [req.params.id, dealerId]
    );
    res.json({ customerId: req.params.id, dealerId, licenses: rows });
}));

router.get('/license/audit', asyncH(async (req, res) => {
    const dealerId = req.query.dealerId;
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);

    let rows;
    if (dealerId) {
        // Dealer'a kısıtlı: kendi audit'leri ve kendi customer'larındaki olaylar.
        rows = await all(
            `SELECT a.* FROM audit_log a
             WHERE a.actor = ?
                OR a.target IN (SELECT id FROM licenses WHERE dealer_id = ?)
                OR a.actor  IN (SELECT id FROM customers WHERE dealer_id = ?)
             ORDER BY a.id DESC LIMIT ?`,
            [dealerId, dealerId, dealerId, limit]
        );
    } else {
        // Admin (Bearer token doğrulanmış); tam erişim.
        rows = await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
    }
    res.json({ entries: rows });
}));

module.exports = router;
