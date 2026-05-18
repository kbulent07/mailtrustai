'use strict';
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const { logger, env, envInt, asyncH, safeJSONReviver, hardenPrototypes, installShutdownHandlers } = require('@mailtrustai/shared');
const ls = require('./licenseServerClient');
const { sanitizeCustomerStatusList } = require('./customerVisibility');

hardenPrototypes();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: envInt('DEALER_JSON_LIMIT_KB', 128) * 1024, reviver: safeJSONReviver }));

// ============================================================
// Secret zorunlulukları — production'da fail-fast.
// ============================================================
const isProd = String(env('NODE_ENV', 'development')).toLowerCase() === 'production';
const SESSION_SECRET = env('DEALER_SESSION_SECRET') || '';
if (!SESSION_SECRET || SESSION_SECRET === 'CHANGE_ME') {
    if (isProd) {
        logger.error('[dealer] FATAL: DEALER_SESSION_SECRET production\'da zorunludur.');
        process.exit(1);
    }
    logger.warn('[dealer] UYARI: DEALER_SESSION_SECRET tanımsız — yalnızca development için.');
}
const SESSION_KEY = SESSION_SECRET || 'dev-only-placeholder';

// Demo modu yalnızca development'ta serbest.
const DEMO_MODE = env('MSA_DEALER_AUTH_MODE') === 'demo';
if (DEMO_MODE && isProd) {
    logger.error('[dealer] FATAL: MSA_DEALER_AUTH_MODE=demo production\'da kapalıdır.');
    process.exit(1);
}

function signSession(dealerId) {
    const ts = Date.now();
    const payload = `${dealerId}.${ts}`;
    // HMAC-SHA256 64-hex'in ilk 32 karakteri (128-bit kuvvet) — cookie boyutu
    // için tasarruf, brute-force eşiği yine de 2^128. Daha kısaltma yapma.
    const sig = crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('hex').slice(0, 32);
    return `${payload}.${sig}`;
}
function verifySession(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [dealerId, ts, sig] = parts;
    const expect = crypto.createHmac('sha256', SESSION_KEY).update(`${dealerId}.${ts}`).digest('hex').slice(0, 32);
    try {
        const a = Buffer.from(sig), b = Buffer.from(expect);
        if (a.length !== b.length) return null;
        if (!crypto.timingSafeEqual(a, b)) return null;
    } catch (_) {
        return null;
    }
    // Session TTL (default 8 saat).
    const ttlMs = envInt('DEALER_SESSION_TTL_MINUTES', 480) * 60 * 1000;
    if (Date.now() - Number(ts) > ttlMs) return null;
    return { dealerId, ts: Number(ts) };
}
function requireDealer(req, res, next) {
    const token = req.headers['x-dealer-session'] || (req.headers.cookie || '').match(/dealer_session=([^;]+)/)?.[1];
    const s = verifySession(token);
    if (!s) return res.status(401).json({ error: 'login gerekli' });
    req.dealer = s;
    next();
}

function timingSafeEq(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ba = Buffer.from(a), bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    try { return crypto.timingSafeEqual(ba, bb); } catch (_) { return false; }
}

function healthPayload() {
    return { ok: true, service: 'dealer', time: Date.now() };
}
app.get('/healthz', (req, res) => res.json(healthPayload()));
app.get('/health', (req, res) => res.json(healthPayload()));
app.get('/api/health', (req, res) => res.json(healthPayload()));

app.post('/api/dealer/login', asyncH(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'username ve password gerekli' });
    }
    if (username.length > 128 || password.length > 512) {
        return res.status(400).json({ error: 'alan çok uzun' });
    }

    if (DEMO_MODE) {
        const u = env('DEALER_DEMO_USER');
        const p = env('DEALER_DEMO_PASS');
        if (u && p && timingSafeEq(username, u) && timingSafeEq(password, p)) {
            const token = signSession(username);
            res.setHeader('Set-Cookie', `dealer_session=${token}; HttpOnly; SameSite=Strict; Path=/${isProd ? '; Secure' : ''}`);
            return res.json({ ok: true, dealerId: username, token, mode: 'demo' });
        }
        return res.status(401).json({ error: 'gecersiz kimlik (demo)' });
    }

    try {
        const r = await ls.verifyDealer(username, password);
        const token = signSession(r.dealerId);
        res.setHeader('Set-Cookie', `dealer_session=${token}; HttpOnly; SameSite=Strict; Path=/${isProd ? '; Secure' : ''}`);
        return res.json({ ok: true, dealerId: r.dealerId, name: r.name, token });
    } catch (e) {
        return res.status(e.status || 401).json({ error: e.message || 'gecersiz kimlik' });
    }
}));

app.post('/api/dealer/logout', asyncH(async (req, res) => {
    res.setHeader('Set-Cookie', 'dealer_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
}));

// Sadece müşteri kaydı oluştur (lisans üretmeden) — admin panelinde de görünür.
// Genişletilmiş alanlar: fatura, BI iletişim, adres.
app.post('/api/dealer/customers/create', requireDealer, asyncH(async (req, res) => {
    const {
        customerId, companyName, email,
        taxOffice, taxNumber, billingAddress,
        contactName, contactEmail, contactPhone,
        address, phone
    } = req.body || {};
    if (!customerId || typeof customerId !== 'string') return res.status(400).json({ error: 'customerId gerekli' });
    const result = await ls.createCustomer({
        customerId,
        dealerId: req.dealer.dealerId,
        companyName, email,
        taxOffice, taxNumber, billingAddress,
        contactName, contactEmail, contactPhone,
        address, phone
    });
    res.json(result);
}));

// Müşteri + lisans oluştur (mevcut akış)
app.post('/api/dealer/customers', requireDealer, asyncH(async (req, res) => {
    const { customerId, companyName, email, plan = 'pro', tier, validDays = 365 } = req.body || {};
    if (!customerId || typeof customerId !== 'string') return res.status(400).json({ error: 'customerId gerekli' });
    const result = await ls.createLicense({
        customerId,
        dealerId: req.dealer.dealerId,
        plan,
        tier,
        companyName,
        email,
        validDays
    });
    res.json(result);
}));

app.get('/api/dealer/customers/status', requireDealer, asyncH(async (req, res) => {
    const r = await ls.dealerCustomersStatus(req.dealer.dealerId);
    res.json({ ...r, customers: sanitizeCustomerStatusList(r.customers) });
}));

app.get('/api/dealer/customers/:id/status', requireDealer, asyncH(async (req, res) => {
    const r = await ls.customerStatus(req.params.id);
    const instances = Array.isArray(r.instances) ? r.instances : [];
    if (instances.length === 0) {
        return res.status(404).json({ error: 'kayit bulunamadi' });
    }
    // Tüm instance'ların dealer'a ait olması ZORUNLU (boş dealer_id sayılmaz).
    const own = instances.every((x) => x && x.dealerId === req.dealer.dealerId);
    if (!own) return res.status(403).json({ error: 'bu musteri bu bayiye ait degil' });
    res.json({ ...r, instances: sanitizeCustomerStatusList(instances) });
}));

app.post('/api/dealer/license/renew', requireDealer, asyncH(async (req, res) => {
    const result = await ls.renewLicense({ ...(req.body || {}), dealerId: req.dealer.dealerId });
    res.json(result);
}));

app.post('/api/dealer/license/revoke', requireDealer, asyncH(async (req, res) => {
    const result = await ls.revokeLicense({ ...(req.body || {}), dealerId: req.dealer.dealerId });
    res.json(result);
}));

// Bayinin müşteri lisans listesi (license-server'ın /license/customer/:id'sine
// dealerId scope ile delege eder).
app.get('/api/dealer/customers/:id/licenses', requireDealer, asyncH(async (req, res) => {
    const result = await ls.listCustomerLicenses(req.params.id, req.dealer.dealerId);
    res.json(result);
}));

// Bayi audit log — sadece kendi olayları
app.get('/api/dealer/audit', requireDealer, asyncH(async (req, res) => {
    const result = await ls.auditForDealer(req.dealer.dealerId);
    res.json(result);
}));

// Bayi bilgisi (oturum açıkken kim olduğunu döner)
app.get('/api/dealer/me', requireDealer, (req, res) => {
    res.json({ dealerId: req.dealer.dealerId });
});

// HTML dosyaları cache'lenmemeli; JS/CSS production'da kısa TTL
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
            res.set('Cache-Control', 'no-store');
        } else {
            res.set('Cache-Control', 'public, max-age=60');
        }
    }
}));
app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) logger.error('[dealer]', err);
    res.status(status).json({ error: err.message || 'internal' });
});

const PORT = envInt('PORT', 3100);
const httpSrv = app.listen(PORT, () => logger.info(`Dealer Portal @ http://localhost:${PORT}`));

installShutdownHandlers([
    () => new Promise((resolve) => {
        httpSrv.close(() => { logger.info('[dealer] HTTP server kapandı'); resolve(); });
        setTimeout(() => { try { httpSrv.closeAllConnections?.(); } catch (_) {} resolve(); }, 8000).unref();
    })
]);

process.on('unhandledRejection', (reason) => logger.error('[dealer] unhandledRejection', reason));
process.on('uncaughtException', (err) => { logger.error('[dealer] uncaughtException', err); process.exit(1); });
