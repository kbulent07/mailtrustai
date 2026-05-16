'use strict';
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const { logger, env, envInt } = require('@mailtrustai/shared');
const { ready } = require('./db');

const licenseRoutes = require('./routes/license.routes');
const centralRoutes = require('./routes/central.routes');
const policyRoutes = require('./routes/policy.routes');
const listsRoutes = require('./routes/lists.routes');
const apiPolicyRoutes = require('./routes/apiPolicy.routes');
const customerSync = require('./routes/customerSync.routes');
const dealerAuth = require('./routes/dealerAuth.routes');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

function healthPayload() {
    return { ok: true, service: 'license-server', time: Date.now() };
}
app.get('/healthz', (req, res) => res.json(healthPayload()));
app.get('/health', (req, res) => res.json(healthPayload()));
app.get('/api/health', (req, res) => res.json(healthPayload()));

const adminSecret = env('DEALER_API_SECRET') || env('TOKEN_SECRET') || 'CHANGE_ME';
const publicPrefixes = ['/api/customer-sync/', '/api/license/activate', '/api/license/validate', '/api/license/heartbeat', '/api/dealer/auth/', '/healthz'];

app.use((req, res, next) => {
    const currentPath = req.path || '';
    if (publicPrefixes.some((prefix) => currentPath === prefix || currentPath.startsWith(prefix))) return next();
    if (!currentPath.startsWith('/api/')) return next();

    const authHeader = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match) return res.status(401).json({ error: 'unauthorized' });

    try {
        if (!crypto.timingSafeEqual(Buffer.from(match[1]), Buffer.from(adminSecret))) {
            return res.status(401).json({ error: 'unauthorized' });
        }
    } catch (_) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    next();
});

app.use('/api', customerSync);
app.use('/api', dealerAuth);
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

const port = envInt('PORT', 3200);
(async () => {
    await ready;
    app.listen(port, () => logger.info(`License-Server @ http://localhost:${port}`));
})().catch((error) => {
    logger.error('[license-server] bootstrap failed:', error);
    process.exit(1);
});
