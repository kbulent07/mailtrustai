'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { asyncH, envInt } = require('@mailtrustai/shared');
const { sha256 } = require('@mailtrustai/security');
const { generateLicenseKey, getPlan } = require('@mailtrustai/license-core');
const { db, audit } = require('../db');

const router = express.Router();

// POST /api/license/create  — dealer veya admin
router.post('/license/create', asyncH((req, res) => {
    const { customerId, dealerId, plan = 'pro', companyName, email, validDays = 365 } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'customerId gerekli' });

    db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
      .run(customerId, dealerId || null, companyName || null, email || null, Date.now());

    const p = getPlan(plan);
    const { key, keyHash } = generateLicenseKey({ customerId, dealerId, plan });
    const id = uuid();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + validDays * 86400 * 1000;
    db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, customerId, dealerId || null, keyHash, key.slice(0, 8) + '…' + key.slice(-4),
           plan, p.tier, 'active', issuedAt, expiresAt, p.graceDays, JSON.stringify(p.features), JSON.stringify(p.limits));

    audit(dealerId || 'admin', 'license.create', id, { customerId, plan });
    res.json({ ok: true, id, licenseKey: key, plan, tier: p.tier, expiresAt, features: p.features, limits: p.limits });
}));

// POST /api/license/activate  — customer
router.post('/license/activate', asyncH((req, res) => {
    const { licenseKey, instanceId, appVersion, buildVersion, nodeVersion, environment, hostnameHash } = req.body || {};
    if (!licenseKey || !instanceId) return res.status(400).json({ error: 'licenseKey ve instanceId gerekli' });

    const keyHash = sha256(licenseKey);
    const lic = db.prepare('SELECT * FROM licenses WHERE license_key_hash = ?').get(keyHash);
    if (!lic) return res.status(404).json({ error: 'lisans bulunamadı' });
    if (lic.status !== 'active') return res.status(403).json({ error: `lisans durumu: ${lic.status}` });
    if (lic.expires_at && lic.expires_at < Date.now()) return res.status(403).json({ error: 'lisans süresi dolmuş' });

    const aid = uuid();
    db.prepare(`INSERT INTO activations(id,license_id,instance_id,hostname_hash,app_version,build_version,node_version,environment,activated_at,last_heartbeat_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(license_id,instance_id) DO UPDATE SET
                    hostname_hash=excluded.hostname_hash,
                    app_version=excluded.app_version,
                    build_version=excluded.build_version,
                    node_version=excluded.node_version,
                    environment=excluded.environment,
                    last_heartbeat_at=excluded.last_heartbeat_at`)
      .run(aid, lic.id, instanceId, hostnameHash || null, appVersion || null, buildVersion || null, nodeVersion || null, environment || null, Date.now(), Date.now());

    audit(lic.customer_id, 'license.activate', lic.id, { instanceId, appVersion });
    res.json({
        activationId: aid, customerId: lic.customer_id, dealerId: lic.dealer_id,
        plan: lic.plan, tier: lic.tier, expiresAt: lic.expires_at, graceDays: lic.grace_days,
        features: JSON.parse(lic.features_json || '{}'),
        limits:   JSON.parse(lic.limits_json   || '{}'),
        licenseStatus: lic.status
    });
}));

// POST /api/license/validate  — customer
router.post('/license/validate', asyncH((req, res) => {
    const { licenseKeyHash, instanceId } = req.body || {};
    if (!licenseKeyHash) return res.status(400).json({ error: 'licenseKeyHash gerekli' });
    const lic = db.prepare('SELECT * FROM licenses WHERE license_key_hash = ?').get(licenseKeyHash);
    if (!lic) return res.status(404).json({ error: 'lisans bulunamadı' });
    const expired = lic.expires_at && lic.expires_at < Date.now();
    res.json({
        licenseStatus: expired ? 'expired' : lic.status,
        plan: lic.plan, tier: lic.tier, expiresAt: lic.expires_at, graceDays: lic.grace_days,
        features: JSON.parse(lic.features_json || '{}'),
        limits:   JSON.parse(lic.limits_json   || '{}')
    });
}));

// POST /api/license/heartbeat  — customer (kısa yol; customer-sync/heartbeat de aynı işi yapar)
router.post('/license/heartbeat', asyncH((req, res) => {
    const { licenseKeyHash, instanceId } = req.body || {};
    if (!licenseKeyHash || !instanceId) return res.status(400).json({ error: 'licenseKeyHash ve instanceId gerekli' });
    const lic = db.prepare('SELECT id FROM licenses WHERE license_key_hash = ?').get(licenseKeyHash);
    if (!lic) return res.status(404).json({ error: 'lisans bulunamadı' });
    db.prepare(`UPDATE activations SET last_heartbeat_at=?, last_payload_json=? WHERE license_id=? AND instance_id=?`)
      .run(Date.now(), JSON.stringify(req.body || {}), lic.id, instanceId);
    res.json({ ok: true, serverTime: Date.now() });
}));

// POST /api/license/revoke
router.post('/license/revoke', asyncH((req, res) => {
    const { id, licenseKeyHash, reason } = req.body || {};
    const lic = id ? db.prepare('SELECT * FROM licenses WHERE id=?').get(id)
                   : db.prepare('SELECT * FROM licenses WHERE license_key_hash=?').get(licenseKeyHash);
    if (!lic) return res.status(404).json({ error: 'lisans bulunamadı' });
    db.prepare('UPDATE licenses SET status=? WHERE id=?').run('revoked', lic.id);
    audit('admin', 'license.revoke', lic.id, { reason });
    res.json({ ok: true });
}));

// POST /api/license/renew
router.post('/license/renew', asyncH((req, res) => {
    const { id, addDays = 365 } = req.body || {};
    const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(id);
    if (!lic) return res.status(404).json({ error: 'lisans bulunamadı' });
    const newExpiry = Math.max(lic.expires_at || Date.now(), Date.now()) + Number(addDays) * 86400 * 1000;
    db.prepare('UPDATE licenses SET expires_at=?, status=? WHERE id=?').run(newExpiry, 'active', lic.id);
    audit('admin', 'license.renew', lic.id, { addDays, newExpiry });
    res.json({ ok: true, expiresAt: newExpiry });
}));

// GET /api/license/customer/:id
router.get('/license/customer/:id', asyncH((req, res) => {
    const rows = db.prepare('SELECT id, plan, tier, status, issued_at, expires_at FROM licenses WHERE customer_id=?').all(req.params.id);
    res.json({ customerId: req.params.id, licenses: rows });
}));

// GET /api/license/audit
router.get('/license/audit', asyncH((req, res) => {
    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all();
    res.json({ entries: rows });
}));

module.exports = router;
