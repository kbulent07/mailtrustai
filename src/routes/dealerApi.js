// ============================================================
// DEALER (BAYİ) API ROUTES
// ============================================================
const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { loadDealers, findDealer, upsertDealer, deleteDealer,
        getCredits, addCredits, generateLicenseTx } = require('../storage/dealerStore');
const { getSalesByDealer, getAllSales, getSalesStats } = require('../storage/dealerSales');
const { recordTransaction, getTransactionsByDealer } = require('../storage/creditTransactionStore');
const { generateLicenseKey, getPriceTable, TIERS } = require('../license/license');
const { requireAdminAuth } = require('../middleware/adminAuth');

// ─── IP TABANLI GİRİŞ SINIRLAMASI ────────────────────────
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of loginAttempts.entries()) {
        if (now > rec.resetAt) loginAttempts.delete(ip);
    }
}, 5 * 60 * 1000);

function checkLoginRate(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || now > rec.resetAt) {
        loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
        return { allowed: true };
    }
    rec.count++;
    if (rec.count > MAX_LOGIN_ATTEMPTS) {
        return { allowed: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
    }
    return { allowed: true };
}

// ─── OTURUM YÖNETİMİ ─────────────────────────────────────
const dealerSessions = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [token, s] of dealerSessions.entries()) {
        if (now > s.expiresAt) dealerSessions.delete(token);
    }
}, 15 * 60 * 1000);

function requireDealerAuth(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const session = dealerSessions.get(token);
    if (!session || Date.now() > session.expiresAt) {
        dealerSessions.delete(token);
        return res.status(401).json({ error: 'Session expired' });
    }
    req.dealerCode = session.code;
    next();
}

// ─── PUBLIC: Login ───────────────────────────────────────
router.post('/login', async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const rateCheck = checkLoginRate(clientIp);
    if (!rateCheck.allowed) {
        return res.status(429).json({
            error: `Çok fazla hatalı giriş. ${Math.ceil(rateCheck.retryAfter / 60)} dakika sonra deneyin.`,
            retryAfter: rateCheck.retryAfter
        });
    }

    const { code, pin } = req.body;
    if (!code || !pin) return res.status(400).json({ error: 'Bayi kodu ve PIN gereklidir' });

    const dealer = findDealer(code.toUpperCase());
    if (!dealer || !dealer.active) return res.status(401).json({ error: 'Geçersiz kimlik bilgileri' });

    const match = await bcrypt.compare(String(pin), dealer.pinHash);
    if (!match) return res.status(401).json({ error: 'Geçersiz kimlik bilgileri' });

    loginAttempts.delete(clientIp);

    const token = uuidv4();
    dealerSessions.set(token, { code: dealer.code, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });

    res.json({
        success: true, token,
        dealer: { name: dealer.name, code: dealer.code, discountPct: dealer.discountPct || 0 }
    });
});

// ─── DEALER AUTH GEREKTİREN ENDPOINTLER ──────────────────
router.post('/logout', requireDealerAuth, (req, res) => {
    const token = (req.headers['authorization'] || '').slice(7);
    dealerSessions.delete(token);
    res.json({ success: true });
});

router.get('/me', requireDealerAuth, (req, res) => {
    const dealer = findDealer(req.dealerCode);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });
    const { pinHash, ...safe } = dealer;
    res.json(safe);
});

router.get('/sales', requireDealerAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    res.json(getSalesByDealer(req.dealerCode, limit));
});

router.get('/stats', requireDealerAuth, (req, res) => {
    res.json(getSalesStats(req.dealerCode));
});

router.get('/prices', requireDealerAuth, (req, res) => {
    const dealer = findDealer(req.dealerCode);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });

    const base = getPriceTable();
    const discount = dealer.discountPct || 0;
    const result = {};
    for (const [plan, tiers] of Object.entries(base)) {
        result[plan] = {};
        for (const [tier, prices] of Object.entries(tiers)) {
            const custom = dealer.customPrices?.[`${plan}_${tier}`];
            result[plan][tier] = custom || {
                M: Math.round(prices.M * (1 - discount / 100)),
                Y: Math.round(prices.Y * (1 - discount / 100))
            };
        }
    }

    const tierInfo = {};
    for (const [k, v] of Object.entries(TIERS)) {
        tierInfo[k] = { label: v.label, monthlyLimit: v.monthlyLimit };
    }
    res.json({ prices: result, tierInfo, discountPct: discount });
});

router.post('/generate', requireDealerAuth, (req, res) => {
    const { plan, tier, duration, customerNote } = req.body;
    if (!plan || !tier || !duration) {
        return res.status(400).json({ error: 'plan, tier ve duration zorunludur' });
    }

    const dealer = findDealer(req.dealerCode);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });

    const base = getPriceTable();
    const basePrice = base[plan]?.[tier]?.[duration] ?? null;
    if (basePrice === null) return res.status(400).json({ error: 'Geçersiz plan/tier/süre' });

    const isFree = basePrice === 0;
    const creditCost = isFree ? 0 : Math.ceil(basePrice * (1 - (dealer.discountPct || 0) / 100));
    const licenseKey = generateLicenseKey(plan, tier, duration, req.dealerCode);

    try {
        // generateLicenseTx: bakiye kontrolü + kredi kesintisi + satış kaydı + işlem logu
        // hepsi tek SQLite transaction içinde — atomik, rollback destekli
        const { saleId, newBalance } = generateLicenseTx({
            dealerCode: req.dealerCode, plan, tier, duration,
            licenseKey, customerNote: customerNote || '',
            creditCost, isFree
        });

        res.json({ success: true, licenseKey, saleId, plan, tier, duration, creditCost, creditsRemaining: newBalance });
    } catch (e) {
        if (e.message === 'INSUFFICIENT_CREDITS') {
            return res.status(402).json({
                error: `Yetersiz kredi. Bu lisans ${e.creditCost} kredi gerektirir, mevcut bakiye: ${e.current}.`,
                creditCost: e.creditCost,
                currentCredits: e.current
            });
        }
        if (e.status) return res.status(e.status).json({ error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// ─── ADMIN ENDPOINTLER ───────────────────────────────────
router.get('/admin/dealers', requireAdminAuth, (req, res) => {
    res.json(loadDealers().map(({ pinHash, ...d }) => d));
});

router.post('/admin/dealers', requireAdminAuth, async (req, res) => {
    const { code, name, contactPerson, email, pin, discountPct, customPrices, active } = req.body;
    if (!code || !name || !pin) return res.status(400).json({ error: 'code, name ve pin zorunludur' });

    const pinHash = await bcrypt.hash(String(pin), 10);
    const dealer = upsertDealer({
        code: code.toUpperCase(), name,
        contactPerson: contactPerson || '', email: email || '',
        pinHash, discountPct: discountPct || 0,
        customPrices: customPrices || {}, active: active !== false
    });
    const { pinHash: _, ...safe } = dealer;
    res.json({ success: true, dealer: safe });
});

router.delete('/admin/dealers/:code', requireAdminAuth, (req, res) => {
    deleteDealer(req.params.code.toUpperCase());
    res.json({ success: true });
});

router.get('/admin/sales', requireAdminAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
    res.json(getAllSales(limit));
});

router.get('/admin/stats', requireAdminAuth, (req, res) => {
    res.json(getSalesStats());
});

// ─── KREDİ YÖNETİMİ ─────────────────────────────────────
router.get('/admin/dealers/:code/credits', requireAdminAuth, (req, res) => {
    const code = req.params.code.toUpperCase();
    const credits = getCredits(code);
    if (credits === null) return res.status(404).json({ error: 'Bayi bulunamadı' });
    res.json({ credits, transactions: getTransactionsByDealer(code, 50) });
});

router.post('/admin/dealers/:code/credits', requireAdminAuth, (req, res) => {
    const code = req.params.code.toUpperCase();
    const amount = Number(req.body.amount);
    const note = String(req.body.note || '').trim();
    if (!amount || isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir miktar girin' });

    const newBalance = addCredits(code, amount);
    if (newBalance === null) return res.status(404).json({ error: 'Bayi bulunamadı' });

    recordTransaction({
        dealerCode: code,
        type: amount > 0 ? 'load' : 'adjust',
        amount,
        note: note || (amount > 0 ? 'Admin kredi yükleme' : 'Admin kredi düzeltme'),
        balanceAfter: newBalance
    });

    res.json({ success: true, credits: newBalance });
});

module.exports = router;
