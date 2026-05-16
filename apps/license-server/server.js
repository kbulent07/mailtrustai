'use strict';
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const { logger, env, envInt } = require('@mailtrustai/shared');
const { db } = require('./db');

const licenseRoutes  = require('./routes/license.routes');
const centralRoutes  = require('./routes/central.routes');
const policyRoutes   = require('./routes/policy.routes');
const listsRoutes    = require('./routes/lists.routes');
const apiPolicyRoutes= require('./routes/apiPolicy.routes');
const customerSync   = require('./routes/customerSync.routes');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/healthz', (req, res) => res.json({ ok: true, service: 'license-server', time: Date.now() }));

// Auth: customer-erişimli yollar bearer GEREKTİRMEZ; gerisi admin/dealer bearer ile.
const ADMIN_SECRET = env('DEALER_API_SECRET') || env('TOKEN_SECRET') || 'CHANGE_ME';
const PUBLIC_PREFIXES = ['/api/customer-sync/', '/api/license/activate', '/api/license/validate', '/api/license/heartbeat', '/healthz'];

app.use((req, res, next) => {
    const p = req.path || '';
    if (PUBLIC_PREFIXES.some(pre => p === pre || p.startsWith(pre))) return next();
    if (!p.startsWith('/api/')) return next();
    const h = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return res.status(401).json({ error: 'unauthorized' });
    try {
        if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(ADMIN_SECRET))) {
            return res.status(401).json({ error: 'unauthorized' });
        }
    } catch (_) { return res.status(401).json({ error: 'unauthorized' }); }
    next();
});

app.use('/api', customerSync);
app.use('/api', licenseRoutes);
app.use('/api', centralRoutes);
app.use('/api', policyRoutes);
app.use('/api', listsRoutes.router);
app.use('/api', apiPolicyRoutes.router);

app.use('/api', (req, res) => res.status(404).json({ error: `API endpoint bulunamadı: ${req.method} ${req.path}` }));
app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) logger.error('[license-server]', err);
    res.status(status).json({ error: err.message || 'internal' });
});

const PORT = envInt('PORT', 3200);
app.listen(PORT, () => logger.info(`🔐 License-Server @ http://localhost:${PORT}`));
