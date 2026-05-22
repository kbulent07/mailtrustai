'use strict';
// Bayi (Dealer) Panel route'ları — bayi kendi müşterilerini, lisanslarını
// ve fiyatlandırmayı görüntüleyebilir.
//
// Auth: In-memory session token (bcrypt ile doğrulanan dealers tablosu).
// Endpoint'ler:
//   POST /api/dealer/login              → oturum başlat, sessionToken döner
//   GET  /api/dealer/pricing            → aktif fiyat planları (oturum gerekmez)
//   GET  /api/dealer/me                 → bayi bilgisi + kredi (oturum gerekir)
//   GET  /api/dealer/customers          → bayinin müşterileri + lisanslar (oturum gerekir)
//   POST /api/dealer/customers          → yeni müşteri ekle / güncelle (oturum gerekir)
//   POST /api/dealer/licenses           → kendi müşterisine lisans üret (kredi kesilir)
//   GET  /api/dealer/credit-log         → kendi kredi hareketleri
//   POST /api/dealer/logout             → oturumu kapat

const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcrypt');
const { v4: uuid } = require('uuid');
const { asyncH, envInt } = require('@mailtrustai/shared');
const { generateLicenseKey, getPlan, PLAN_MATRIX, TIER_MATRIX } = require('@mailtrustai/license-core');
const { all, get, run, upsert, audit } = require('../db');

const router = express.Router();

// ─── In-memory dealer session store ──────────────────────────────────────────
const _dealerSessions = new Map(); // token → { expiresAt, dealerId, name, email }
const DEALER_SESSION_TTL_MS = envInt('DEALER_SESSION_HOURS', 8) * 3600 * 1000;

function _pruneDealerSessions() {
    const now = Date.now();
    for (const [t, s] of _dealerSessions) {
        if (now > s.expiresAt) _dealerSessions.delete(t);
    }
}

function _newDealerSession(dealerId, name, email) {
    _pruneDealerSessions();
    const token = crypto.randomBytes(32).toString('hex');
    _dealerSessions.set(token, {
        expiresAt: Date.now() + DEALER_SESSION_TTL_MS,
        dealerId, name, email
    });
    return token;
}

function _getDealerSession(token) {
    if (!token) return null;
    const s = _dealerSessions.get(token);
    if (!s) return null;
    if (Date.now() > s.expiresAt) { _dealerSessions.delete(token); return null; }
    return s;
}

// Oturum doğrulama middleware
function dealerSessionAuth(req, res, next) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    const sess = m ? _getDealerSession(m[1]) : null;
    if (!sess) {
        return res.status(401).json({ error: 'Bayi oturumu gerekli — önce /api/dealer/login ile giriş yapın.' });
    }
    req.dealerSession = sess;
    next();
}

// ─── POST /api/dealer/login ───────────────────────────────────────────────────
// body: { dealerId, password }
// → { ok, sessionToken, dealerId, name, email, expiresIn }
router.post('/dealer/login', asyncH(async (req, res) => {
    const { dealerId, password } = req.body || {};
    if (!dealerId || typeof dealerId !== 'string' || !password || typeof password !== 'string') {
        return res.status(400).json({ error: 'dealerId ve password gerekli' });
    }

    const dealer = await get(
        'SELECT id, name, email, api_token_hash FROM dealers WHERE id = ?',
        [String(dealerId).trim()]
    );
    if (!dealer || !dealer.api_token_hash) {
        await audit(dealerId, 'dealer.panel.login.fail', null, { reason: 'no-record' });
        return res.status(401).json({ error: 'Geçersiz bayi ID veya parola' });
    }

    let ok = false;
    try { ok = await bcrypt.compare(String(password), dealer.api_token_hash); } catch (_) {}
    if (!ok) {
        await audit(dealerId, 'dealer.panel.login.fail', null, { reason: 'bad-password' });
        return res.status(401).json({ error: 'Geçersiz bayi ID veya parola' });
    }

    const sessionToken = _newDealerSession(dealer.id, dealer.name, dealer.email);
    await audit(dealer.id, 'dealer.panel.login.ok', null, null);
    res.json({
        ok: true,
        sessionToken,
        dealerId:  dealer.id,
        name:      dealer.name,
        email:     dealer.email,
        expiresIn: Math.floor(DEALER_SESSION_TTL_MS / 1000)
    });
}));

// ─── POST /api/dealer/logout ──────────────────────────────────────────────────
router.post('/dealer/logout', asyncH(async (req, res) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (m) _dealerSessions.delete(m[1]);
    res.json({ ok: true });
}));

// ─── GET /api/dealer/pricing — oturum gerektirmez (bayiler URL'yi paylaşabilir) ─
// Aktif fiyat planlarını + enterprise çarpanı + kredi birim adını döner.
router.get('/dealer/pricing', asyncH(async (req, res) => {
    const plans = await all(
        'SELECT id, plan, billing_period, currency, base_price, included_credits, extra_credit_price, notes FROM pricing_plans WHERE is_active = 1 ORDER BY plan, billing_period, currency'
    );
    const multRow = await get("SELECT setting_value FROM admin_settings WHERE setting_key = 'pricing_enterprise_multiplier'");
    const unitRow = await get("SELECT setting_value FROM admin_settings WHERE setting_key = 'pricing_credit_unit'");
    res.json({
        plans:                plans || [],
        enterpriseMultiplier: parseFloat(multRow?.setting_value || '1.20'),
        creditUnit:           unitRow?.setting_value || 'tarama'
    });
}));

// ─── GET /api/dealer/me — bayi bilgisi + kredi bakiyesi ──────────────────────
router.get('/dealer/me', dealerSessionAuth, asyncH(async (req, res) => {
    const { dealerId } = req.dealerSession;
    const dealer = await get(
        'SELECT id, name, email, credits, created_at FROM dealers WHERE id = ?',
        [dealerId]
    );
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });
    res.json({
        ok: true,
        dealer: {
            id:        dealer.id,
            name:      dealer.name,
            email:     dealer.email,
            credits:   dealer.credits || 0,
            createdAt: dealer.created_at
        }
    });
}));

// ─── GET /api/dealer/customers — bayinin müşterileri + lisansları ─────────────
router.get('/dealer/customers', dealerSessionAuth, asyncH(async (req, res) => {
    const { dealerId } = req.dealerSession;

    // Müşteri başına bir satır, lisansı JOIN ile çek.
    // Birden fazla lisansı olan müşteriler çoğaltılır; frontend'de
    // customer_id'ye göre gruplandırılır.
    const rows = await all(
        `SELECT
            c.id            AS customer_id,
            c.company_name,
            c.email         AS customer_email,
            c.created_at    AS customer_created_at,
            l.id            AS license_id,
            l.plan,
            l.tier,
            l.status,
            l.expires_at,
            l.license_key_masked,
            l.label,
            a.last_heartbeat_at,
            a.activated_at
         FROM customers c
         LEFT JOIN licenses  l ON l.customer_id = c.id
         LEFT JOIN activations a ON a.license_id = l.id
         WHERE c.dealer_id = ?
         ORDER BY c.created_at DESC, l.issued_at DESC`,
        [dealerId]
    );

    // Frontend'e gruplu gönder: müşteri başına licenses[]
    const grouped = new Map();
    for (const row of (rows || [])) {
        if (!grouped.has(row.customer_id)) {
            grouped.set(row.customer_id, {
                id:         row.customer_id,
                companyName:row.company_name,
                email:      row.customer_email,
                createdAt:  row.customer_created_at,
                licenses:   []
            });
        }
        if (row.license_id) {
            grouped.get(row.customer_id).licenses.push({
                id:               row.license_id,
                plan:             row.plan,
                tier:             row.tier,
                status:           row.status,
                expiresAt:        row.expires_at,
                keyMasked:        row.license_key_masked,
                label:            row.label,
                lastHeartbeatAt:  row.last_heartbeat_at,
                activatedAt:      row.activated_at
            });
        }
    }

    const customers = [...grouped.values()];
    res.json({ count: customers.length, customers });
}));

// ─── POST /api/dealer/customers — Yeni müşteri ekle / güncelle ───────────────
// body: { customerId, companyName, email, contactName?, contactPhone? }
// Müşteri dealer'a ait değilse 403.
router.post('/dealer/customers', dealerSessionAuth, asyncH(async (req, res) => {
    const { dealerId } = req.dealerSession;
    const { customerId, companyName, email, contactName, contactPhone } = req.body || {};
    if (!customerId || typeof customerId !== 'string' || customerId.trim().length < 3) {
        return res.status(400).json({ error: 'customerId en az 3 karakter olmalı' });
    }
    const cid = customerId.trim();

    // Varsa: sadece bu bayiye ait müşteri güncellenebilir
    const existing = await get('SELECT dealer_id FROM customers WHERE id = ?', [cid]);
    if (existing && existing.dealer_id !== dealerId) {
        return res.status(403).json({ error: 'Bu müşteri size ait değil' });
    }

    await upsert('customers',
        {
            id:            cid,
            dealer_id:     dealerId,
            company_name:  companyName    || null,
            email:         email          || null,
            contact_name:  contactName    || null,
            contact_phone: contactPhone   || null,
            created_at:    Date.now()
        },
        {
            keys:   ['id'],
            update: ['company_name', 'email', 'contact_name', 'contact_phone']
        }
    );
    await audit(dealerId, 'customer.upsert', cid, { companyName, source: 'dealer-panel' });
    res.json({ ok: true, customerId: cid });
}));

// ─── POST /api/dealer/licenses — Kendi müşterisine lisans üret ───────────────
// body: { customerId, plan, tier?, validDays?, label? }
// 1 kredi kesilir. Müşteri bu bayiye ait olmalıdır.
router.post('/dealer/licenses', dealerSessionAuth, asyncH(async (req, res) => {
    const { dealerId } = req.dealerSession;
    const { customerId, plan = 'pro', tier, label } = req.body || {};
    const validDays = Number(req.body?.validDays ?? 365);

    if (!customerId || typeof customerId !== 'string') {
        return res.status(400).json({ error: 'customerId gerekli' });
    }
    if (!Number.isFinite(validDays) || validDays < 1 || validDays > 36500) {
        return res.status(400).json({ error: 'validDays 1..36500 arası olmalı' });
    }
    if (!PLAN_MATRIX[plan]) {
        return res.status(400).json({ error: `Geçersiz plan: ${plan}. Geçerli: ${Object.keys(PLAN_MATRIX).join(', ')}` });
    }
    if (plan === 'demo' && validDays > 14) {
        return res.status(400).json({ error: 'Demo lisans en fazla 14 gün olabilir.' });
    }
    if (tier && !TIER_MATRIX[tier]) {
        return res.status(400).json({ error: `Geçersiz tier: ${tier}` });
    }

    // Müşteri bu bayiye ait mi?
    const customer = await get('SELECT id, dealer_id FROM customers WHERE id = ?', [customerId.trim()]);
    if (!customer) return res.status(404).json({ error: 'Müşteri bulunamadı' });
    if (customer.dealer_id !== dealerId) {
        return res.status(403).json({ error: 'Bu müşteri size ait değil' });
    }

    // Atomik kredi düşme: race condition koruması
    const dealer = await get('SELECT id, credits FROM dealers WHERE id = ?', [dealerId]);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });

    const upd = await run(
        'UPDATE dealers SET credits = credits - 1 WHERE id = ? AND credits > 0',
        [dealer.id]
    );
    const changed = upd?.affectedRows ?? upd?.changes ?? 0;
    if (changed === 0) {
        return res.status(402).json({
            error: 'Yetersiz kredi. Yöneticinizden kredi yüklemesini isteyin.',
            code:  'INSUFFICIENT_CREDITS',
            balance: dealer.credits ?? 0
        });
    }

    // UPDATE sonrası gerçek bakiyeyi DB'den oku — stale pre-UPDATE değeri yerine
    // kesin rakamı kullan. Concurrent istekler aynı anda geçse bile log doğru olur.
    const afterUpd   = await get('SELECT credits FROM dealers WHERE id = ?', [dealer.id]);
    const newBalance = afterUpd?.credits ?? 0;
    let priceAmount  = 0;
    let priceCurrency = 'TRY';
    try {
        const priceRow = await get(
            `SELECT extra_credit_price, currency
             FROM pricing_plans
             WHERE plan = ? AND is_active = 1
             ORDER BY extra_credit_price ASC LIMIT 1`,
            [plan]
        );
        if (priceRow) {
            priceAmount   = priceRow.extra_credit_price || 0;
            priceCurrency = priceRow.currency || 'TRY';
        }
    } catch (_) { /* pricing tablosu yoksa sessizce geç */ }

    await run(
        'INSERT INTO dealer_credit_log(id,dealer_id,delta,balance,reason,description,actor,created_at,price_amount,currency) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [uuid(), dealer.id, -1, newBalance, 'license.create',
         `Lisans üretimi (bayi paneli): müşteri=${customerId}, plan=${plan}`, 'dealer-panel', Date.now(),
         priceAmount, priceCurrency]
    );

    // Lisansı üret
    const planDef = getPlan(plan, tier);
    const { key, keyHash } = generateLicenseKey({ customerId: customerId.trim(), dealerId, plan });
    const id        = uuid();
    const issuedAt  = Date.now();
    const expiresAt = issuedAt + validDays * 86400 * 1000;
    const rawLabel  = typeof label === 'string' ? label.trim().slice(0, 128) : null;

    await run(
        `INSERT INTO licenses(id, customer_id, dealer_id, license_key_hash, license_key_masked, plan, tier, status, issued_at, expires_at, grace_days, features_json, limits_json, label)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, customerId.trim(), dealerId, keyHash,
         `${key.slice(0, 8)}…${key.slice(-4)}`,
         plan, planDef.tier || null, 'active', issuedAt, expiresAt, planDef.graceDays,
         JSON.stringify(planDef.features), JSON.stringify(planDef.limits), rawLabel || null]
    );

    await audit(dealerId, 'license.create', id, { customerId: customerId.trim(), plan, tier: planDef.tier, source: 'dealer-panel' });

    res.json({
        ok:         true,
        id,
        licenseKey: key,
        plan,
        tier:       planDef.tier,
        expiresAt,
        remainingCredits: newBalance
    });
}));

// ─── GET /api/dealer/transfers — Bayinin müşterilerinin transfer talepleri ─────
// ?status=pending|approved|rejected|all   (varsayılan: pending)
// ?limit=100 (max 500)
router.get('/dealer/transfers', dealerSessionAuth, asyncH(async (req, res) => {
    const { dealerId } = req.dealerSession;
    const status = req.query.status || 'pending';
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const statusFilter = status === 'all' ? null : status;

    const rows = await all(
        `SELECT tr.id, tr.status, tr.requested_at, tr.resolved_at, tr.resolved_by, tr.reject_reason,
                l.id AS license_id, l.plan, l.license_key_masked,
                c.id AS customer_id, c.company_name
         FROM transfer_requests tr
         JOIN licenses  l ON l.id = tr.license_id
         LEFT JOIN customers c ON c.id = l.customer_id
         WHERE l.dealer_id = ? ${statusFilter ? 'AND tr.status = ?' : ''}
         ORDER BY tr.requested_at DESC LIMIT ?`,
        statusFilter ? [dealerId, statusFilter, limit] : [dealerId, limit]
    );

    // Bekleyen sayısını da döndür (badge için)
    const pendingRow = await get(
        `SELECT COUNT(*) AS c FROM transfer_requests tr
         JOIN licenses l ON l.id = tr.license_id
         WHERE l.dealer_id = ? AND tr.status = 'pending'`,
        [dealerId]
    );

    res.json({ count: rows.length, pendingCount: pendingRow?.c || 0, transfers: rows || [] });
}));

// ─── POST /api/dealer/transfers/:id/approve ────────────────────────────────────
router.post('/dealer/transfers/:id/approve', dealerSessionAuth, asyncH(async (req, res) => {
    const { dealerId } = req.dealerSession;
    const tr = await get(
        `SELECT tr.*, l.dealer_id FROM transfer_requests tr
         JOIN licenses l ON l.id = tr.license_id
         WHERE tr.id = ?`,
        [req.params.id]
    );
    if (!tr) return res.status(404).json({ error: 'Transfer talebi bulunamadı' });
    if (tr.dealer_id !== dealerId) return res.status(403).json({ error: 'Bu talep size ait değil' });
    if (tr.status !== 'pending') return res.status(409).json({ error: `Talep zaten işlendi: ${tr.status}` });

    const resolvedAt = Date.now();
    const upd = await run(
        'UPDATE transfer_requests SET status=?, resolved_at=?, resolved_by=? WHERE id=? AND status=?',
        ['approved', resolvedAt, dealerId, tr.id, 'pending']
    );
    if ((upd?.affectedRows ?? upd?.changes ?? 0) === 0) {
        return res.status(409).json({ error: 'Talep eş zamanlı işlendi, yenileyin.' });
    }

    // Eski cihaz aktivasyonunu sil
    if (tr.old_hostname_hash) {
        await run('DELETE FROM activations WHERE license_id=? AND hostname_hash=? AND instance_id != ?',
            [tr.license_id, tr.old_hostname_hash, tr.new_instance_id || '']);
    }
    // Aynı lisans için diğer bekleyen talepleri reddet
    await run(
        'UPDATE transfer_requests SET status=?,resolved_at=?,resolved_by=?,reject_reason=? WHERE license_id=? AND status=? AND id!=?',
        ['rejected', resolvedAt, dealerId, 'Başka transfer onaylandı', tr.license_id, 'pending', tr.id]
    );
    await audit(dealerId, 'license.transfer.approved', tr.license_id, { transferId: tr.id });
    res.json({ ok: true, message: 'Transfer onaylandı. Müşteri lisansı yeniden aktive edebilir.' });
}));

// ─── POST /api/dealer/transfers/:id/reject ─────────────────────────────────────
router.post('/dealer/transfers/:id/reject', dealerSessionAuth, asyncH(async (req, res) => {
    const { dealerId } = req.dealerSession;
    const { reason } = req.body || {};
    const tr = await get(
        `SELECT tr.*, l.dealer_id FROM transfer_requests tr
         JOIN licenses l ON l.id = tr.license_id
         WHERE tr.id = ?`,
        [req.params.id]
    );
    if (!tr) return res.status(404).json({ error: 'Transfer talebi bulunamadı' });
    if (tr.dealer_id !== dealerId) return res.status(403).json({ error: 'Bu talep size ait değil' });
    if (tr.status !== 'pending') return res.status(409).json({ error: `Talep zaten işlendi: ${tr.status}` });

    const resolvedAt = Date.now();
    const upd = await run(
        'UPDATE transfer_requests SET status=?,resolved_at=?,resolved_by=?,reject_reason=? WHERE id=? AND status=?',
        ['rejected', resolvedAt, dealerId, reason || 'Bayi tarafından reddedildi', tr.id, 'pending']
    );
    if ((upd?.affectedRows ?? upd?.changes ?? 0) === 0) {
        return res.status(409).json({ error: 'Talep eş zamanlı işlendi, yenileyin.' });
    }
    await audit(dealerId, 'license.transfer.rejected', tr.license_id, { transferId: tr.id, reason });
    res.json({ ok: true, message: 'Transfer reddedildi.' });
}));

// ─── GET /api/dealer/credit-log — Bayi kendi kredi hareketlerini görür ────────
// ?limit=50 (max 200)
router.get('/dealer/credit-log', dealerSessionAuth, asyncH(async (req, res) => {
    const { dealerId } = req.dealerSession;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await all(
        `SELECT id, delta, balance, reason, description, actor, created_at,
                COALESCE(price_amount, 0) AS price_amount,
                COALESCE(currency, 'TRY') AS currency
         FROM dealer_credit_log
         WHERE dealer_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        [dealerId, limit]
    );
    res.json({ count: rows.length, log: rows || [] });
}));

module.exports = router;
