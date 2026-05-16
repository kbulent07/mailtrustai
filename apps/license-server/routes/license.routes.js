'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const { asyncH } = require('@mailtrustai/shared');
const { sha256 } = require('@mailtrustai/security');
const { generateLicenseKey, getPlan } = require('@mailtrustai/license-core');
const { get, all, run, audit, isMaria } = require('../db');

const router = express.Router();

router.post('/license/create', asyncH(async (req, res) => {
    const { customerId, dealerId, plan = 'pro', companyName, email, validDays = 365 } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'customerId gerekli' });

    await run(
        isMaria
            ? 'INSERT IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)'
            : 'INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)',
        [customerId, dealerId || null, companyName || null, email || null, Date.now()]
    );

    const planDef = getPlan(plan);
    const { key, keyHash } = generateLicenseKey({ customerId, dealerId, plan });
    const id = uuid();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + validDays * 86400 * 1000;

    await run(
        `INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, customerId, dealerId || null, keyHash, `${key.slice(0, 8)}…${key.slice(-4)}`, plan, planDef.tier, 'active', issuedAt, expiresAt, planDef.graceDays, JSON.stringify(planDef.features), JSON.stringify(planDef.limits)]
    );

    await audit(dealerId || 'admin', 'license.create', id, { customerId, plan });
    res.json({ ok: true, id, licenseKey: key, plan, tier: planDef.tier, expiresAt, features: planDef.features, limits: planDef.limits });
}));

router.post('/license/activate', asyncH(async (req, res) => {
    const { licenseKey, instanceId, appVersion, buildVersion, nodeVersion, environment, hostnameHash } = req.body || {};
    if (!licenseKey || !instanceId) return res.status(400).json({ error: 'licenseKey ve instanceId gerekli' });

    const keyHash = sha256(licenseKey);
    const license = await get('SELECT * FROM licenses WHERE license_key_hash = ?', [keyHash]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });
    if (license.status !== 'active') return res.status(403).json({ error: `lisans durumu: ${license.status}` });
    if (license.expires_at && license.expires_at < Date.now()) return res.status(403).json({ error: 'lisans süresi dolmuş' });

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
        features: JSON.parse(license.features_json || '{}'),
        limits: JSON.parse(license.limits_json || '{}'),
        licenseStatus: license.status
    });
}));

router.post('/license/validate', asyncH(async (req, res) => {
    const { licenseKeyHash } = req.body || {};
    if (!licenseKeyHash) return res.status(400).json({ error: 'licenseKeyHash gerekli' });
    const license = await get('SELECT * FROM licenses WHERE license_key_hash = ?', [licenseKeyHash]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });
    const expired = license.expires_at && license.expires_at < Date.now();
    res.json({
        licenseStatus: expired ? 'expired' : license.status,
        plan: license.plan,
        tier: license.tier,
        expiresAt: license.expires_at,
        graceDays: license.grace_days,
        features: JSON.parse(license.features_json || '{}'),
        limits: JSON.parse(license.limits_json || '{}')
    });
}));

router.post('/license/heartbeat', asyncH(async (req, res) => {
    const { licenseKeyHash, instanceId } = req.body || {};
    if (!licenseKeyHash || !instanceId) return res.status(400).json({ error: 'licenseKeyHash ve instanceId gerekli' });

    const license = await get('SELECT id FROM licenses WHERE license_key_hash = ?', [licenseKeyHash]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    await run('UPDATE activations SET last_heartbeat_at=?, last_payload_json=? WHERE license_id=? AND instance_id=?', [Date.now(), JSON.stringify(req.body || {}), license.id, instanceId]);
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
    const license = await get('SELECT * FROM licenses WHERE id=?', [id]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    assertOwnership(license, dealerId);
    const expiresAt = Math.max(license.expires_at || Date.now(), Date.now()) + Number(addDays) * 86400 * 1000;
    await run('UPDATE licenses SET expires_at=?, status=? WHERE id=?', [expiresAt, 'active', license.id]);
    await audit(dealerId || 'admin', 'license.renew', license.id, { addDays, newExpiry: expiresAt });
    res.json({ ok: true, expiresAt });
}));

router.get('/license/customer/:id', asyncH(async (req, res) => {
    const rows = await all('SELECT id, plan, tier, status, issued_at, expires_at FROM licenses WHERE customer_id=?', [req.params.id]);
    res.json({ customerId: req.params.id, licenses: rows });
}));

router.get('/license/audit', asyncH(async (req, res) => {
    const rows = await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500');
    res.json({ entries: rows });
}));

module.exports = router;
