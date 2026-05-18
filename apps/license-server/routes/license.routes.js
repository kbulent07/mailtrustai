'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const { asyncH, safeJSON } = require('@mailtrustai/shared');
const { sha256 } = require('@mailtrustai/security');
const { generateLicenseKey, getPlan, PLAN_MATRIX, TIER_MATRIX } = require('@mailtrustai/license-core');
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
// Bayi/admin yeni bir müşteri eklerken önce bu endpoint'i çağırabilir.
// Genişletilmiş alanlar (opsiyonel): fatura, BI iletişim, adres.
router.post('/license/customers', asyncH(async (req, res) => {
    const {
        customerId, dealerId, companyName, email,
        taxOffice, taxNumber, billingAddress,
        contactName, contactEmail, contactPhone,
        address, phone
    } = req.body || {};
    if (!customerId || typeof customerId !== 'string') {
        return badRequest(res, 'customerId gerekli');
    }
    const upsertSql = isMaria
        ? `INSERT INTO customers(id,dealer_id,company_name,email,created_at,
                tax_office,tax_number,billing_address,
                contact_name,contact_email,contact_phone,
                address,phone)
           VALUES(?,?,?,?,?, ?,?,?, ?,?,?, ?,?)
           ON DUPLICATE KEY UPDATE
             dealer_id       = COALESCE(VALUES(dealer_id), dealer_id),
             company_name    = COALESCE(VALUES(company_name), company_name),
             email           = COALESCE(VALUES(email), email),
             tax_office      = COALESCE(VALUES(tax_office), tax_office),
             tax_number      = COALESCE(VALUES(tax_number), tax_number),
             billing_address = COALESCE(VALUES(billing_address), billing_address),
             contact_name    = COALESCE(VALUES(contact_name), contact_name),
             contact_email   = COALESCE(VALUES(contact_email), contact_email),
             contact_phone   = COALESCE(VALUES(contact_phone), contact_phone),
             address         = COALESCE(VALUES(address), address),
             phone           = COALESCE(VALUES(phone), phone)`
        : `INSERT INTO customers(id,dealer_id,company_name,email,created_at,
                tax_office,tax_number,billing_address,
                contact_name,contact_email,contact_phone,
                address,phone)
           VALUES(?,?,?,?,?, ?,?,?, ?,?,?, ?,?)
           ON CONFLICT(id) DO UPDATE SET
             dealer_id       = COALESCE(excluded.dealer_id, customers.dealer_id),
             company_name    = COALESCE(excluded.company_name, customers.company_name),
             email           = COALESCE(excluded.email, customers.email),
             tax_office      = COALESCE(excluded.tax_office, customers.tax_office),
             tax_number      = COALESCE(excluded.tax_number, customers.tax_number),
             billing_address = COALESCE(excluded.billing_address, customers.billing_address),
             contact_name    = COALESCE(excluded.contact_name, customers.contact_name),
             contact_email   = COALESCE(excluded.contact_email, customers.contact_email),
             contact_phone   = COALESCE(excluded.contact_phone, customers.contact_phone),
             address         = COALESCE(excluded.address, customers.address),
             phone           = COALESCE(excluded.phone, customers.phone)`;
    await run(upsertSql, [
        customerId, dealerId || null, companyName || null, email || null, Date.now(),
        taxOffice || null, taxNumber || null, billingAddress || null,
        contactName || null, contactEmail || null, contactPhone || null,
        address || null, phone || null
    ]);
    await audit(dealerId || 'admin', 'customer.create', customerId,
        { companyName, email, source: dealerId ? 'dealer' : 'admin' });
    res.json({
        ok: true, customerId, dealerId: dealerId || null,
        companyName: companyName || null, email: email || null
    });
}));

router.post('/license/create', asyncH(async (req, res) => {
    const { customerId, dealerId, plan = 'pro', tier, companyName, email, label } = req.body || {};
    const isTrial   = req.body?.trial === true || req.body?.trial === 'true';
    const validDays = Number(req.body?.validDays ?? (isTrial ? 14 : 365));
    if (!customerId) return badRequest(res, 'customerId gerekli');
    if (!Number.isFinite(validDays) || validDays <= 0 || validDays > 36500) {
        return badRequest(res, 'validDays geçersiz (1..36500)');
    }
    if (plan === 'demo' && validDays > 14) {
        return badRequest(res, 'Demo lisans maksimum 14 gün olabilir.');
    }
    if (!PLAN_MATRIX[plan]) {
        return badRequest(res, `plan geçersiz: ${plan}. Geçerli: ${Object.keys(PLAN_MATRIX).join(', ')}`);
    }
    if (isTrial && validDays > 14) {
        return badRequest(res, 'Deneme lisansı en fazla 14 gün olabilir.');
    }
    if (tier && !TIER_MATRIX[tier]) {
        return badRequest(res, `tier geçersiz: ${tier}. Geçerli: ${Object.keys(TIER_MATRIX).join(', ')}`);
    }
    // Label opsiyonel; trial ise otomatik "[Trial]" prefix eklenir.
    const rawLabel = (typeof label === 'string' && label.trim()) ? label.trim() : '';
    const licenseLabel = isTrial
        ? ('[Trial] ' + (rawLabel || `${plan.charAt(0).toUpperCase() + plan.slice(1)} Deneme`)).slice(0, 128)
        : (rawLabel.slice(0, 128) || null);

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

    // tier varsa planDef'in tarama limitini tier ile override et
    const planDef = getPlan(plan, tier);
    const { key, keyHash } = generateLicenseKey({ customerId, dealerId, plan });
    const id = uuid();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + validDays * 86400 * 1000;

    await run(
        `INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,label)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, customerId, dealerId || null, keyHash, `${key.slice(0, 8)}…${key.slice(-4)}`, plan, planDef.tier, 'active', issuedAt, expiresAt, planDef.graceDays, JSON.stringify(planDef.features), JSON.stringify(planDef.limits), licenseLabel]
    );

    await audit(dealerId || 'admin', 'license.create', id, { customerId, plan, tier: planDef.tier, label: licenseLabel });
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

    // ── Fingerprint / cihaz transfer kontrolü ────────────────────────────────
    // Eğer hostnameHash varsa ve bu license_id altında zaten farklı bir
    // hostnameHash ile kaydedilmiş bir aktivasyon bulunuyorsa → transfer talebi.
    // Aynı instance_id yeniden aktive ediyorsa (donanım değişikliği) → izin ver.
    if (hostnameHash) {
        const existingActs = await all(
            'SELECT instance_id, hostname_hash FROM activations WHERE license_id=?',
            [license.id]
        );
        const thisInstanceExists = existingActs.some(a => a.instance_id === instanceId);
        if (!thisInstanceExists && existingActs.length > 0) {
            const mismatch = existingActs.some(a => a.hostname_hash && a.hostname_hash !== hostnameHash);
            if (mismatch) {
                // Zaten bekleyen bir transfer talebi var mı?
                const existingTr = await get(
                    'SELECT id FROM transfer_requests WHERE license_id=? AND new_hostname_hash=? AND status=?',
                    [license.id, hostnameHash, 'pending']
                );
                if (!existingTr) {
                    const trId = uuid();
                    const oldHash = existingActs.find(a => a.hostname_hash)?.hostname_hash || null;
                    await run(
                        'INSERT INTO transfer_requests(id,license_id,old_hostname_hash,new_hostname_hash,new_instance_id,status,requested_at) VALUES(?,?,?,?,?,?,?)',
                        [trId, license.id, oldHash, hostnameHash, instanceId, 'pending', Date.now()]
                    );
                    await audit(license.customer_id, 'license.transfer.requested', license.id, { instanceId, hostnameHash });
                    return res.status(409).json({
                        error: 'transfer_required',
                        message: 'Bu lisans farklı bir cihaza kayıtlıdır. Bayi veya admin onayı bekleniyor.',
                        transferRequestId: trId,
                        customerId: license.customer_id,
                        dealerId: license.dealer_id
                    });
                } else {
                    return res.status(409).json({
                        error: 'transfer_pending',
                        message: 'Transfer talebi oluşturulmuş, bayi veya admin onayı bekleniyor.',
                        transferRequestId: existingTr.id,
                        customerId: license.customer_id,
                        dealerId: license.dealer_id
                    });
                }
            }
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

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

// ============================================================
// Transfer Talepleri — Bayi (Bearer) veya Admin (adminAuth) erişir.
// ============================================================

router.get('/license/transfers', asyncH(async (req, res) => {
    const dealerId = req.query.dealerId;
    const status   = req.query.status || 'pending'; // pending | approved | rejected | all
    const limitN   = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const statusFilter = status === 'all' ? null : status;
    let rows;
    if (dealerId) {
        rows = await all(
            `SELECT tr.*, l.customer_id, l.dealer_id, l.plan, l.tier, l.license_key_masked,
                    c.company_name
             FROM transfer_requests tr
             JOIN licenses l ON l.id = tr.license_id
             LEFT JOIN customers c ON c.id = l.customer_id
             WHERE l.dealer_id = ? ${statusFilter ? 'AND tr.status = ?' : ''}
             ORDER BY tr.requested_at DESC LIMIT ?`,
            statusFilter ? [dealerId, statusFilter, limitN] : [dealerId, limitN]
        );
    } else {
        rows = await all(
            `SELECT tr.*, l.customer_id, l.dealer_id, l.plan, l.tier, l.license_key_masked,
                    c.company_name
             FROM transfer_requests tr
             JOIN licenses l ON l.id = tr.license_id
             LEFT JOIN customers c ON c.id = l.customer_id
             ${statusFilter ? 'WHERE tr.status = ?' : ''}
             ORDER BY tr.requested_at DESC LIMIT ?`,
            statusFilter ? [statusFilter, limitN] : [limitN]
        );
    }
    res.json({ transfers: rows || [] });
}));

router.post('/license/transfers/:id/approve', asyncH(async (req, res) => {
    const { dealerId } = req.body || {};
    const tr = await get('SELECT * FROM transfer_requests WHERE id=?', [req.params.id]);
    if (!tr) return res.status(404).json({ error: 'transfer talebi bulunamadı' });
    if (tr.status !== 'pending') return res.status(409).json({ error: `talep zaten işlendi: ${tr.status}` });

    const license = await get('SELECT * FROM licenses WHERE id=?', [tr.license_id]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    // Dealer yalnızca kendi lisansını onaylayabilir.
    if (dealerId && license.dealer_id && license.dealer_id !== dealerId) {
        return res.status(403).json({ error: 'bu lisans size ait değil' });
    }

    // Eski instance'ın aktivasyonunu kaldır (fingerprint değişti → yeni cihaz).
    if (tr.old_hostname_hash) {
        await run('DELETE FROM activations WHERE license_id=? AND hostname_hash=? AND instance_id != ?',
            [tr.license_id, tr.old_hostname_hash, tr.new_instance_id || '']);
    }
    // Transfer talebini kapat.
    await run(
        'UPDATE transfer_requests SET status=?, resolved_at=?, resolved_by=? WHERE id=?',
        ['approved', Date.now(), dealerId || 'admin', tr.id]
    );
    // Aynı lisans için diğer bekleyen talepleri de reddet.
    await run(
        'UPDATE transfer_requests SET status=?, resolved_at=?, resolved_by=?, reject_reason=? WHERE license_id=? AND status=? AND id!=?',
        ['rejected', Date.now(), dealerId || 'admin', 'Başka transfer onaylandı', tr.license_id, 'pending', tr.id]
    );
    await audit(dealerId || 'admin', 'license.transfer.approved', tr.license_id, { transferId: tr.id, newHash: tr.new_hostname_hash });
    res.json({ ok: true, message: 'Transfer onaylandı. Müşteri lisansı yeniden aktive edebilir.' });
}));

router.post('/license/transfers/:id/reject', asyncH(async (req, res) => {
    const { dealerId, reason } = req.body || {};
    const tr = await get('SELECT * FROM transfer_requests WHERE id=?', [req.params.id]);
    if (!tr) return res.status(404).json({ error: 'transfer talebi bulunamadı' });
    if (tr.status !== 'pending') return res.status(409).json({ error: `talep zaten işlendi: ${tr.status}` });

    const license = await get('SELECT dealer_id FROM licenses WHERE id=?', [tr.license_id]);
    if (dealerId && license?.dealer_id && license.dealer_id !== dealerId) {
        return res.status(403).json({ error: 'bu lisans size ait değil' });
    }

    await run(
        'UPDATE transfer_requests SET status=?, resolved_at=?, resolved_by=?, reject_reason=? WHERE id=?',
        ['rejected', Date.now(), dealerId || 'admin', reason || null, tr.id]
    );
    await audit(dealerId || 'admin', 'license.transfer.rejected', tr.license_id, { transferId: tr.id, reason });
    res.json({ ok: true, message: 'Transfer reddedildi.' });
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
