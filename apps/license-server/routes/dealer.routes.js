'use strict';
// Bayi (Dealer) Panel route'ları — bayi kendi müşterilerini, lisanslarını
// ve fiyatlandırmayı görüntüleyebilir.
//
// Auth: In-memory session token (bcrypt ile doğrulanan dealers tablosu).
// Endpoint'ler:
//   POST /api/dealer/login        → oturum başlat, sessionToken döner
//   GET  /api/dealer/pricing      → aktif fiyat planları (oturum gerekmez)
//   GET  /api/dealer/me           → bayi bilgisi + kredi (oturum gerekir)
//   GET  /api/dealer/customers    → bayinin müşterileri + lisanslar (oturum gerekir)
//   POST /api/dealer/logout       → oturumu kapat

const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcrypt');
const { asyncH, envInt } = require('@mailtrustai/shared');
const { all, get, audit } = require('../db');

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

module.exports = router;
