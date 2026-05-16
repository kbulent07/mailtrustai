'use strict';
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const { logger, env, envInt, asyncH } = require('@mailtrustai/shared');
const ls = require('./licenseServerClient');
const { sanitizeCustomerStatusList } = require('./customerVisibility');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));

const SESSION_SECRET = env('DEALER_SESSION_SECRET') || 'CHANGE_ME';
function signSession(dealerId) {
    const ts = Date.now();
    const payload = `${dealerId}.${ts}`;
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex').slice(0, 32);
    return `${payload}.${sig}`;
}
function verifySession(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [dealerId, ts, sig] = parts;
    const expect = crypto.createHmac('sha256', SESSION_SECRET).update(`${dealerId}.${ts}`).digest('hex').slice(0, 32);
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    } catch (_) {
        return null;
    }
    return { dealerId, ts: Number(ts) };
}
function requireDealer(req, res, next) {
    const token = req.headers['x-dealer-session'] || (req.headers.cookie || '').match(/dealer_session=([^;]+)/)?.[1];
    const s = verifySession(token);
    if (!s) return res.status(401).json({ error: 'login gerekli' });
    req.dealer = s;
    next();
}

function healthPayload() {
    return { ok: true, service: 'dealer', time: Date.now() };
}
app.get('/healthz', (req, res) => res.json(healthPayload()));
app.get('/health', (req, res) => res.json(healthPayload()));
app.get('/api/health', (req, res) => res.json(healthPayload()));

app.post('/api/dealer/login', asyncH(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username ve password gerekli' });

    if (env('MSA_DEALER_AUTH_MODE') === 'demo') {
        const u = env('DEALER_DEMO_USER');
        const p = env('DEALER_DEMO_PASS');
        if (u && p && username === u && password === p) {
            const token = signSession(username);
            res.setHeader('Set-Cookie', `dealer_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
            return res.json({ ok: true, dealerId: username, token, mode: 'demo' });
        }
        return res.status(401).json({ error: 'gecersiz kimlik (demo)' });
    }

    try {
        const r = await ls.verifyDealer(username, password);
        const token = signSession(r.dealerId);
        res.setHeader('Set-Cookie', `dealer_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
        return res.json({ ok: true, dealerId: r.dealerId, name: r.name, token });
    } catch (e) {
        return res.status(e.status || 401).json({ error: e.message || 'gecersiz kimlik' });
    }
}));

app.post('/api/dealer/customers', requireDealer, asyncH(async (req, res) => {
    const { customerId, companyName, email, plan = 'pro', validDays = 365 } = req.body || {};
    const result = await ls.createLicense({
        customerId,
        dealerId: req.dealer.dealerId,
        plan,
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
    const own = (r.instances || []).every((x) => !x.dealerId || x.dealerId === req.dealer.dealerId);
    if (!own) return res.status(403).json({ error: 'bu musteri bu bayiye ait degil' });
    res.json({ ...r, instances: sanitizeCustomerStatusList(r.instances) });
}));

app.post('/api/dealer/license/renew', requireDealer, asyncH(async (req, res) => {
    const result = await ls.renewLicense({ ...(req.body || {}), dealerId: req.dealer.dealerId });
    res.json(result);
}));

app.post('/api/dealer/license/revoke', requireDealer, asyncH(async (req, res) => {
    const result = await ls.revokeLicense({ ...(req.body || {}), dealerId: req.dealer.dealerId });
    res.json(result);
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) logger.error('[dealer]', err);
    res.status(status).json({ error: err.message || 'internal' });
});

const PORT = envInt('PORT', 3100);
app.listen(PORT, () => logger.info(`Dealer Portal @ http://localhost:${PORT}`));
