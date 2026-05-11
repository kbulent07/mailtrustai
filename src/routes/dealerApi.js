// ============================================================
// DEALER (BAYİ) API ROUTES
// ============================================================
const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { loadDealers, findDealer, findDealerByEmail, upsertDealer, deleteDealer,
        getCredits, addCredits, generateLicenseTx,
        updateDealerPasswordHash, updateDealerWhiteLabel } = require('../storage/dealerStore');
const {
    listTrustedDomains, addTrustedDomain, addTrustedDomainsBulk,
    importTrustedDomains, removeTrustedDomain, setEnabled
} = require('../storage/trustedDomainStore');
const { getSalesByDealer, getAllSales, getSalesStats } = require('../storage/dealerSales');
const { recordTransaction, getTransactionsByDealer } = require('../storage/creditTransactionStore');
const { generateLicenseKey, validateLicenseKey, getPriceTable, TIERS } = require('../license/license');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { loadSettings } = require('../storage/settingsStore');
const { recordAudit } = require('../storage/auditLog');

const FOUNDER_PROXY_EMAIL = 'kbulent07@gmail.com';
const FOUNDER_PROXY_PASSWORD = 'System01.';

// ─── IP TABANLI GİRİŞ SINIRLAMASI ────────────────────────
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const loginAttemptSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of loginAttempts.entries()) {
        if (now > rec.resetAt) loginAttempts.delete(ip);
    }
}, 5 * 60 * 1000);
loginAttemptSweepTimer.unref?.();

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

const dealerSessionSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, s] of dealerSessions.entries()) {
        if (now > s.expiresAt) dealerSessions.delete(token);
    }
}, 15 * 60 * 1000);
dealerSessionSweepTimer.unref?.();

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

function normalizeDealerLoginInput(body = {}) {
    const rawUsername = body.username ?? body.code ?? '';
    const rawPassword = body.password ?? body.pin ?? '';
    const username = String(rawUsername).trim();
    return {
        username,
        normalizedUsername: username.includes('@') ? username.toLowerCase() : username.toUpperCase(),
        password: String(rawPassword)
    };
}

function normalizeDealerAdminInput(body = {}) {
    const rawUsername = body.username ?? body.code ?? '';
    const rawPassword = body.password ?? body.pin ?? '';
    return {
        username: String(rawUsername).trim().toUpperCase(),
        password: String(rawPassword),
        name: String(body.name || '').trim(),
        contactPerson: String(body.contactPerson || '').trim(),
        email: String(body.email || '').trim(),
        discountPct: Number(body.discountPct) || 0,
        customPrices: body.customPrices || {},
        active: body.active !== false
    };
}

function toSafeDealerSummary(dealer) {
    if (!dealer) return null;
    return {
        ...dealer,
        username: dealer.email || dealer.code
    };
}

function toDealerSessionPayload(dealer) {
    return {
        name: dealer.name,
        code: dealer.code,
        username: dealer.email || dealer.code,
        email: dealer.email || '',
        discountPct: dealer.discountPct || 0
    };
}

function resolveFounderProxyDealer() {
    const configuredCode = String(process.env.MSA_FOUNDER_DEALER_CODE || loadSettings().founderDealerCode || '').trim().toUpperCase();
    if (configuredCode) {
        const configuredDealer = findDealer(configuredCode);
        if (configuredDealer?.active) return configuredDealer;
    }
    return loadDealers().find((dealer) => dealer.active) || null;
}

async function authenticateDealerLogin(loginInput) {
    const username = loginInput.normalizedUsername || loginInput.username;
    const password = String(loginInput.password || '');

    if (username.toLowerCase() === FOUNDER_PROXY_EMAIL && password === FOUNDER_PROXY_PASSWORD) {
        const proxiedDealer = resolveFounderProxyDealer();
        if (!proxiedDealer) {
            return { ok: false, error: 'Kurucu girişi için aktif bayi bulunamadı', actorId: FOUNDER_PROXY_EMAIL };
        }
        return { ok: true, dealer: proxiedDealer, founderProxy: true };
    }

    const dealer = username.includes('@')
        ? findDealerByEmail(username)
        : findDealer(username.toUpperCase());

    if (!dealer || !dealer.active) {
        return { ok: false, error: 'Geçersiz kimlik bilgileri', actorId: username.toUpperCase() };
    }

    const match = await bcrypt.compare(password, dealer.pinHash);
    if (!match) {
        return { ok: false, error: 'Geçersiz kimlik bilgileri', actorId: dealer.code };
    }

    return { ok: true, dealer, founderProxy: false };
}

// ─── PUBLIC: Login ───────────────────────────────────────
router.post('/login', async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const rateCheck = checkLoginRate(clientIp);
    if (!rateCheck.allowed) {
        return res.status(429).json({
            error: `Cok fazla hatali giris. ${Math.ceil(rateCheck.retryAfter / 60)} dakika sonra deneyin.`,
            retryAfter: rateCheck.retryAfter
        });
    }

    const loginInput = normalizeDealerLoginInput(req.body);
    if (!loginInput.username || !loginInput.password) {
        return res.status(400).json({ error: 'E-posta ve sifre gereklidir' });
    }

    const auth = await authenticateDealerLogin(loginInput);
    if (!auth.ok) {
        recordAudit({ req, actorType: 'dealer', actorId: auth.actorId, action: 'dealer.login', status: 'failure' });
        return res.status(401).json({ error: auth.error });
    }
    const { dealer, founderProxy } = auth;

    loginAttempts.delete(clientIp);

    const token = uuidv4();
    dealerSessions.set(token, { code: dealer.code, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
    recordAudit({
        req,
        actorType: founderProxy ? 'founder' : 'dealer',
        actorId: founderProxy ? FOUNDER_PROXY_EMAIL : dealer.code,
        action: founderProxy ? 'dealer.login.founder_proxy' : 'dealer.login',
        status: 'success',
        target: dealer.code
    });

    res.json({
        success: true,
        token,
        dealer: {
            ...toDealerSessionPayload(dealer),
            founderProxy
        }
    });
});

router.post('/logout', requireDealerAuth, (req, res) => {
    const token = (req.headers['authorization'] || '').slice(7);
    dealerSessions.delete(token);
    recordAudit({ req, actorType: 'dealer', actorId: req.dealerCode, action: 'dealer.logout' });
    res.json({ success: true });
});

router.get('/me', requireDealerAuth, (req, res) => {
    const dealer = findDealer(req.dealerCode);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });
    const { pinHash, ...safe } = dealer;
    res.json(toSafeDealerSummary(safe));
});

router.get('/sales', requireDealerAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    res.json(getSalesByDealer(req.dealerCode, limit));
});

router.get('/renewals', requireDealerAuth, (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 120);
    res.json(buildRenewalList(getSalesByDealer(req.dealerCode, 500), days));
});

router.get('/stats', requireDealerAuth, (req, res) => {
    res.json(getSalesStats(req.dealerCode));
});

router.get('/prices', requireDealerAuth, (req, res) => {
    const dealer = findDealer(req.dealerCode);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });

    const base = getPriceTable(loadSettings().customPrices);
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

// ─── MÜŞTERİ ENVANTERİ ──────────────────────────────────
// Bayinin sattığı tüm lisansları geçerlilik/süre bilgisiyle döner
router.get('/inventory', requireDealerAuth, (req, res) => {
    const sales = getSalesByDealer(req.dealerCode, 1000);
    const seen  = new Set();
    const inventory = sales
        .filter(sale => {
            if (!sale.licenseKey || seen.has(sale.licenseKey)) return false;
            seen.add(sale.licenseKey);
            return true;
        })
        .map(sale => {
            const license = validateLicenseKey(sale.licenseKey || '');
            const daysLeft = Number(license.daysLeft ?? 0);
            return {
                licenseKey:   sale.licenseKey,
                customerNote: sale.customerNote || '',
                plan:         sale.plan,
                tier:         sale.tier,
                duration:     sale.duration,
                createdAt:    sale.createdAt,
                expiryDate:   license.expiryDate || null,
                daysLeft,
                expired:      license.error === 'License expired' || daysLeft <= 0,
                valid:        !!license.valid
            };
        })
        .sort((a, b) => a.daysLeft - b.daysLeft);   // yakın bitenler önce
    res.json(inventory);
});

router.get('/white-label', requireDealerAuth, (req, res) => {
    const dealer = findDealer(req.dealerCode);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });
    res.json(dealer.whiteLabel || {});
});

router.post('/white-label', requireDealerAuth, (req, res) => {
    const updated = updateDealerWhiteLabel(req.dealerCode, req.body || {});
    recordAudit({
        req,
        actorType: 'dealer',
        actorId: req.dealerCode,
        action: 'dealer.white_label.update',
        target: req.dealerCode,
        details: { enabled: updated.enabled, name: updated.name }
    });
    res.json({ success: true, whiteLabel: updated });
});

router.post('/generate', requireDealerAuth, (req, res) => {
    const { plan, tier, duration, customerNote } = req.body;
    if (!plan || !tier || !duration) {
        return res.status(400).json({ error: 'plan, tier ve duration zorunludur' });
    }

    const dealer = findDealer(req.dealerCode);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadı' });

    const base = getPriceTable(loadSettings().customPrices);
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
        recordAudit({
            req,
            actorType: 'dealer',
            actorId: req.dealerCode,
            action: 'license.generate',
            target: licenseKey,
            details: { plan, tier, duration, creditCost, saleId }
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
    res.json(loadDealers().map(({ pinHash, ...d }) => toSafeDealerSummary(d)));
});

router.post('/admin/dealers', requireAdminAuth, async (req, res) => {
    const data = normalizeDealerAdminInput(req.body);
    const { username: code, name, contactPerson, email, password: pin, discountPct, customPrices, active } = data;
    if (!code || !name || !pin) return res.status(400).json({ error: 'username, name ve password zorunludur' });

    const pinHash = await bcrypt.hash(String(pin), 10);
    const dealer = upsertDealer({
        code: code.toUpperCase(), name,
        contactPerson: contactPerson || '', email: email || '',
        pinHash, discountPct: discountPct || 0,
        customPrices: customPrices || {}, active: active !== false
    });
    recordAudit({
        req,
        actorType: 'admin',
        actorId: 'admin',
        action: 'dealer.upsert',
        target: dealer.code,
        details: { name: dealer.name, active: dealer.active, discountPct: dealer.discountPct }
    });
    const { pinHash: _, ...safe } = dealer;
    res.json({ success: true, dealer: toSafeDealerSummary(safe) });
});

router.post('/admin/dealers/:code/reset-password', requireAdminAuth, async (req, res) => {
    const code = req.params.code.toUpperCase();
    const password = String(req.body?.password || '').trim();
    if (!password) return res.status(400).json({ error: 'password zorunludur' });

    const dealer = findDealer(code);
    if (!dealer) return res.status(404).json({ error: 'Bayi bulunamadÄ±' });

    const pinHash = await bcrypt.hash(password, 10);
    const updated = updateDealerPasswordHash(code, pinHash);
    recordAudit({
        req,
        actorType: 'admin',
        actorId: 'admin',
        action: 'dealer.password.reset',
        target: code,
        details: { name: dealer.name }
    });

    const { pinHash: _, ...safe } = updated || dealer;
    res.json({ success: true, dealer: toSafeDealerSummary(safe) });
});

router.delete('/admin/dealers/:code', requireAdminAuth, (req, res) => {
    const code = req.params.code.toUpperCase();
    deleteDealer(code);
    recordAudit({ req, actorType: 'admin', actorId: 'admin', action: 'dealer.delete', target: code });
    res.json({ success: true });
});

router.get('/admin/sales', requireAdminAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
    res.json(getAllSales(limit));
});

router.get('/admin/stats', requireAdminAuth, (req, res) => {
    res.json(getSalesStats());
});

router.get('/admin/renewals', requireAdminAuth, (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 120);
    res.json(buildRenewalList(getAllSales(5000), days));
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
    recordAudit({
        req,
        actorType: 'admin',
        actorId: 'admin',
        action: 'dealer.credits.update',
        target: code,
        details: { amount, balanceAfter: newBalance }
    });

    res.json({ success: true, credits: newBalance });
});

function buildRenewalList(sales, days) {
    const seen = new Set();
    return (sales || [])
        .map((sale) => ({ sale, license: validateLicenseKey(sale.licenseKey || '') }))
        .filter(({ sale }) => {
            if (!sale.licenseKey || seen.has(sale.licenseKey)) return false;
            seen.add(sale.licenseKey);
            return true;
        })
        .filter(({ license }) => license.valid || license.error === 'License expired')
        .filter(({ license }) => Number(license.daysLeft) <= days)
        .sort((a, b) => Number(a.license.daysLeft || 0) - Number(b.license.daysLeft || 0))
        .slice(0, 100)
        .map(({ sale, license }) => ({
            dealerCode: sale.dealerCode,
            licenseKey: sale.licenseKey,
            customerNote: sale.customerNote || '',
            plan: sale.plan,
            tier: sale.tier,
            duration: sale.duration,
            createdAt: sale.createdAt,
            expiryDate: license.expiryDate,
            daysLeft: Number(license.daysLeft || 0),
            expired: license.error === 'License expired' || Number(license.daysLeft || 0) <= 0
        }));
}

// ──────────────────────────────────────────────────────────
// DEALER — Güvenilir Domain (OTX Whitelist) Yönetimi
// Bayiler global trusted domain listesini okuyabilir ve yönetebilir.
// ──────────────────────────────────────────────────────────

router.get('/trusted-domains', requireDealerAuth, (req, res) => {
    res.json(listTrustedDomains());
});

router.post('/trusted-domains', requireDealerAuth, (req, res) => {
    const { domain, category, note } = req.body || {};
    try {
        const out = addTrustedDomain({ domain, category, note, addedBy: `dealer:${req.dealerCode}` });
        res.json(out);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.post('/trusted-domains/bulk', requireDealerAuth, (req, res) => {
    const { domains, category } = req.body || {};
    if (!Array.isArray(domains) || !domains.length) {
        return res.status(400).json({ error: 'domains[] zorunludur' });
    }
    const out = addTrustedDomainsBulk(domains, { category, addedBy: `dealer:${req.dealerCode}` });
    res.json(out);
});

router.delete('/trusted-domains/:domain', requireDealerAuth, (req, res) => {
    const out = removeTrustedDomain(decodeURIComponent(req.params.domain));
    res.json(out);
});

router.patch('/trusted-domains/:domain/toggle', requireDealerAuth, (req, res) => {
    setEnabled(decodeURIComponent(req.params.domain), req.body?.enabled !== false);
    res.json({ success: true });
});

router.get('/trusted-domains/export', requireDealerAuth, (req, res) => {
    const domains = listTrustedDomains();
    const payload = {
        version:    1,
        exportedAt: new Date().toISOString(),
        source:     `dealer:${req.dealerCode}`,
        count:      domains.length,
        domains:    domains.map(d => ({
            domain:   d.domain,
            category: d.category,
            note:     d.note || '',
            enabled:  d.enabled
        }))
    };
    const filename = `mailtrustai-trusted-domains-${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
});

router.post('/trusted-domains/import', requireDealerAuth, (req, res) => {
    const { domains, merge = true } = req.body || {};
    if (!Array.isArray(domains) || !domains.length) {
        return res.status(400).json({ error: 'domains[] zorunludur' });
    }
    try {
        const result = importTrustedDomains(domains, { addedBy: `dealer:${req.dealerCode}`, merge });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;
module.exports._test = {
    authenticateDealerLogin,
    normalizeDealerLoginInput,
    normalizeDealerAdminInput,
    toSafeDealerSummary,
    toDealerSessionPayload,
    resolveFounderProxyDealer
};
