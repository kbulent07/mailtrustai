'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const { asyncH, safeJSON } = require('@mailtrustai/shared');
const { sha256 } = require('@mailtrustai/security');
const { generateLicenseKey, getPlan, PLAN_MATRIX, TIER_MATRIX } = require('@mailtrustai/license-core');
const { get, run, all, audit } = require('../db');
const customerRepo   = require('../repositories/customerRepository');
const licenseRepo    = require('../repositories/licenseRepository');
const activationRepo = require('../repositories/activationRepository');
const auditRepo      = require('../repositories/auditRepository');

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
    await customerRepo.upsertFull({
        id:              customerId,
        dealer_id:       dealerId       || null,
        company_name:    companyName    || null,
        email:           email          || null,
        tax_office:      taxOffice      || null,
        tax_number:      taxNumber      || null,
        billing_address: billingAddress || null,
        contact_name:    contactName    || null,
        contact_email:   contactEmail   || null,
        contact_phone:   contactPhone   || null,
        address:         address        || null,
        phone:           phone          || null
    });
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

    // ─── Bayi kredi kontrolü — bayiyle üretiliyorsa 1 kredi kesilir ─────────
    // Admin panelinden (dealerId olmadan) üretimde kredi kontrolü yapılmaz.
    if (dealerId) {
        const dealer = await get('SELECT id, credits FROM dealers WHERE id = ?', [String(dealerId)]);
        if (!dealer) return badRequest(res, `bayi bulunamadı: ${dealerId}`);

        // Atomik kredi düşme: credits > 0 koşuluyla — race condition koruması.
        const upd = await run(
            'UPDATE dealers SET credits = credits - 1 WHERE id = ? AND credits > 0',
            [dealer.id]
        );
        const changed = upd?.affectedRows ?? upd?.changes ?? 0;
        if (changed === 0) {
            await audit(dealerId, 'dealer.credit.insufficient', null, { customerId, plan });
            return res.status(402).json({
                error: 'Yetersiz kredi. Lütfen yöneticinizle iletişime geçin.',
                code:  'INSUFFICIENT_CREDITS',
                balance: dealer.credits ?? 0
            });
        }
        // UPDATE sonrası gerçek bakiyeyi oku — stale pre-UPDATE değeri yerine kesin rakamı kullan.
        const afterUpd   = await get('SELECT credits FROM dealers WHERE id = ?', [dealer.id]);
        const newBalance = afterUpd?.credits ?? 0;
        const { v4: _uuid } = require('uuid');
        await run(
            'INSERT INTO dealer_credit_log(id,dealer_id,delta,balance,reason,description,actor,created_at) VALUES(?,?,?,?,?,?,?,?)',
            [_uuid(), dealer.id, -1, newBalance, 'license.create',
             `Lisans üretimi: müşteri=${customerId}, plan=${plan}`, 'system', Date.now()]
        );
        await audit(dealerId, 'dealer.credit.deduct', dealer.id,
            { delta: -1, newBalance, customerId, plan });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Label opsiyonel; trial ise otomatik "[Trial]" prefix eklenir.
    const rawLabel = (typeof label === 'string' && label.trim()) ? label.trim() : '';
    const licenseLabel = isTrial
        ? ('[Trial] ' + (rawLabel || `${plan.charAt(0).toUpperCase() + plan.slice(1)} Deneme`)).slice(0, 128)
        : (rawLabel.slice(0, 128) || null);

    // UPSERT: dealer transferi/şirket adı güncellemesi mümkün.
    await customerRepo.upsertSlim({ id: customerId, dealerId, companyName, email });

    // tier varsa planDef'in tarama limitini tier ile override et
    const planDef = getPlan(plan, tier);
    const { key, keyHash } = generateLicenseKey({ customerId, dealerId, plan });
    const id = uuid();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + validDays * 86400 * 1000;

    await licenseRepo.insertLicense({
        id,
        customer_id:        customerId,
        dealer_id:          dealerId || null,
        license_key_hash:   keyHash,
        license_key_masked: `${key.slice(0, 8)}…${key.slice(-4)}`,
        plan,
        tier:               planDef.tier,
        status:             'active',
        issued_at:          issuedAt,
        expires_at:         expiresAt,
        grace_days:         planDef.graceDays,
        features_json:      JSON.stringify(planDef.features),
        limits_json:        JSON.stringify(planDef.limits),
        label:              licenseLabel
    });

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
    const license = await licenseRepo.findByKeyHash(keyHash);
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
    // Aynı (license_id, instance_id) için UPSERT idempotent. Yeni instanceId
    // limit aşıyorsa eklenen satır son 5sn içinde olduğundan silinir. Bu
    // yaklaşım iki paralel /activate'te bile en fazla 1 fazla geçici satır
    // yaratır ve hemen temizler.
    const activationId = uuid();
    const now = Date.now();
    await activationRepo.upsertActivation({
        id:                activationId,
        license_id:        license.id,
        instance_id:       instanceId,
        hostname_hash:     hostnameHash || null,
        app_version:       appVersion   || null,
        build_version:     buildVersion || null,
        node_version:      nodeVersion  || null,
        environment:       environment  || null,
        activated_at:      now,
        last_heartbeat_at: now
    });

    const count = await activationRepo.countByLicense(license.id);
    if (count > maxAct) {
        await activationRepo.deleteRecentByInstance(license.id, instanceId);
        await audit(license.customer_id, 'license.activate.fail', license.id, { reason: 'max-activations', max: maxAct });
        return res.status(403).json({ error: `maksimum aktivasyon aşıldı (${maxAct})` });
    }

    const activation = await activationRepo.findByLicenseAndInstance(license.id, instanceId);

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

    const license = await licenseRepo.findByKeyHash(licenseKeyHash);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    const activation = await activationRepo.findByLicenseAndInstance(license.id, instanceId);
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

    const license = await licenseRepo.findByKeyHash(licenseKeyHash);
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
    // activationRepo.updateHeartbeat: activations UPSERT + heartbeat_log arşiv kaydı
    await activationRepo.updateHeartbeat(license.id, instanceId, JSON.stringify(safePayload), {
        appVersion:   safePayload.appVersion   || null,
        environment:  safePayload.environment  || null,
        healthStatus: safePayload.healthStatus || null
    });
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
        ? await licenseRepo.findById(id)
        : await licenseRepo.findByKeyHash(licenseKeyHash);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    assertOwnership(license, dealerId);
    await licenseRepo.setStatus(license.id, 'revoked');
    await audit(dealerId || 'admin', 'license.revoke', license.id, { reason });
    res.json({ ok: true });
}));

router.post('/license/renew', asyncH(async (req, res) => {
    const { id, addDays = 365, dealerId } = req.body || {};
    const days = Number(addDays);
    if (!Number.isFinite(days) || days <= 0 || days > 36500) return badRequest(res, 'addDays geçersiz');

    const license = await licenseRepo.findById(id);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });

    assertOwnership(license, dealerId);
    const expiresAt = Math.max(license.expires_at || Date.now(), Date.now()) + days * 86400 * 1000;
    await licenseRepo.extendExpiry(license.id, expiresAt);
    await audit(dealerId || 'admin', 'license.renew', license.id, { addDays: days, newExpiry: expiresAt });
    res.json({ ok: true, expiresAt });
}));

// ============================================================
// Dealer scope zorunlu: dealerId query param ile filtre.
// ============================================================
router.get('/license/customer/:id', asyncH(async (req, res) => {
    const dealerId = req.query.dealerId;
    if (!dealerId) return res.status(400).json({ error: 'dealerId query param zorunlu' });

    const rows = await licenseRepo.listByCustomerAndDealer(req.params.id, dealerId);
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

    // Atomik UPDATE: yalnızca hâlâ 'pending' olan satırı güncelle.
    // Eş zamanlı iki onay isteğinde sadece biri etkilenen satır alır.
    const resolvedAt = Date.now();
    const resolver = dealerId || 'admin';
    const updateResult = await run(
        'UPDATE transfer_requests SET status=?, resolved_at=?, resolved_by=? WHERE id=? AND status=?',
        ['approved', resolvedAt, resolver, tr.id, 'pending']
    );
    const affected = updateResult?.affectedRows ?? updateResult?.changes ?? 0;
    if (affected === 0) {
        // Yarış koşulu: başka bir istek önce onayladı/reddetti.
        const current = await get('SELECT status FROM transfer_requests WHERE id=?', [tr.id]);
        return res.status(409).json({ error: `talep zaten işlendi: ${current?.status ?? 'unknown'}` });
    }

    // Eski instance'ın aktivasyonunu kaldır (fingerprint değişti → yeni cihaz).
    if (tr.old_hostname_hash) {
        await run('DELETE FROM activations WHERE license_id=? AND hostname_hash=? AND instance_id != ?',
            [tr.license_id, tr.old_hostname_hash, tr.new_instance_id || '']);
    }
    // Aynı lisans için diğer bekleyen talepleri de reddet.
    await run(
        'UPDATE transfer_requests SET status=?, resolved_at=?, resolved_by=?, reject_reason=? WHERE license_id=? AND status=? AND id!=?',
        ['rejected', resolvedAt, resolver, 'Başka transfer onaylandı', tr.license_id, 'pending', tr.id]
    );
    await audit(resolver, 'license.transfer.approved', tr.license_id, { transferId: tr.id, newHash: tr.new_hostname_hash });
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

    // Atomik UPDATE — race condition koruması.
    const updateResult = await run(
        'UPDATE transfer_requests SET status=?, resolved_at=?, resolved_by=?, reject_reason=? WHERE id=? AND status=?',
        ['rejected', Date.now(), dealerId || 'admin', reason || null, tr.id, 'pending']
    );
    const affected = updateResult?.affectedRows ?? updateResult?.changes ?? 0;
    if (affected === 0) {
        const current = await get('SELECT status FROM transfer_requests WHERE id=?', [tr.id]);
        return res.status(409).json({ error: `talep zaten işlendi: ${current?.status ?? 'unknown'}` });
    }
    await audit(dealerId || 'admin', 'license.transfer.rejected', tr.license_id, { transferId: tr.id, reason });
    res.json({ ok: true, message: 'Transfer reddedildi.' });
}));

router.get('/license/audit', asyncH(async (req, res) => {
    const dealerId = req.query.dealerId;
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);

    // Dealer scope: yalnızca kendi audit'leri ve kendi müşterileri/lisanslarındaki olaylar.
    // Admin (Bearer token doğrulanmış): tam erişim.
    const rows = dealerId
        ? await auditRepo.listForDealer(dealerId, { limit })
        : await auditRepo.listAll({ limit });
    res.json({ entries: rows });
}));

module.exports = router;
