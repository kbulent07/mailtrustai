'use strict';
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const { logger, env, envInt, safeJSONReviver, hardenPrototypes, installShutdownHandlers } = require('@mailtrustai/shared');

// Process-level güvenlik: prototype'ları dondur (`__proto__` injection koruması).
hardenPrototypes();

// license-core SECRET'i boot'ta tetikle (route handler içinde 500 patlamasın).
// Eğer SECRET prod'da boşsa license-core throw → burada yakalanır ve fail-fast.
try {
    const licCore = require('@mailtrustai/license-core');
    // Dummy call — SECRET() invoke eder; eksikse exception fırlatır.
    licCore.generateLicenseKey({ customerId: '__boot_probe__', plan: 'demo' });
} catch (e) {
    logger.error('[license-server] FATAL: license-core SECRET probe başarısız:', e.message);
    process.exit(1);
}

const { ready } = require('./db');

const licenseRoutes = require('./routes/license.routes');
const centralRoutes = require('./routes/central.routes');
const policyRoutes = require('./routes/policy.routes');
const listsRoutes = require('./routes/lists.routes');
const apiPolicyRoutes = require('./routes/apiPolicy.routes');
const customerSync = require('./routes/customerSync.routes');
const dealerAuth = require('./routes/dealerAuth.routes');
const adminRoutes = require('./routes/admin.routes');
const { createRateLimiters } = require('./middleware/rateLimit');
const path = require('path');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
// reviver: `__proto__`/`prototype`/`constructor` anahtarlarını body'den temizler.
app.use(express.json({ limit: envInt('LICENSE_SERVER_JSON_LIMIT_KB', 256) * 1024, reviver: safeJSONReviver }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

function healthPayload() {
    return { ok: true, service: 'license-server', time: Date.now() };
}
app.get('/healthz', (req, res) => res.json(healthPayload()));
app.get('/health', (req, res) => res.json(healthPayload()));
app.get('/api/health', (req, res) => res.json(healthPayload()));

// ============================================================
// Secret zorunlulukları — production'da fail-fast.
// ============================================================
const adminSecret = env('DEALER_API_SECRET') || env('TOKEN_SECRET') || '';
const isProd = String(env('NODE_ENV', 'development')).toLowerCase() === 'production';
if (!adminSecret || adminSecret === 'CHANGE_ME') {
    if (isProd) {
        logger.error('[license-server] FATAL: DEALER_API_SECRET (veya TOKEN_SECRET) production\'da zorunludur.');
        process.exit(1);
    }
    logger.warn('[license-server] UYARI: DEALER_API_SECRET tanımsız — yalnızca development için.');
}
const ADMIN_SECRET_BUF = Buffer.from(adminSecret || 'dev-only-placeholder');

// ============================================================
// Public endpoint listesi (exact match veya prefix '/' ile biten).
// startsWith gevşekliğini önlemek için tam path veya '/<prefix>/' formu.
// ============================================================
const PUBLIC_EXACT = new Set([
    '/healthz', '/health', '/api/health',
    '/api/license/activate',
    '/api/license/validate',
    '/api/license/heartbeat'
]);
const PUBLIC_PREFIXES = [
    '/api/customer-sync/',
    '/api/dealer/auth/',
    // /api/admin/* admin.routes.js kendi adminAuth middleware'iyle korur (ADMIN_PANEL_TOKEN).
    // Global DEALER_API_SECRET kontrolünden hariç tutulur.
    '/api/admin/'
];

function isPublic(p) {
    if (PUBLIC_EXACT.has(p)) return true;
    return PUBLIC_PREFIXES.some((pre) => p === pre.slice(0, -1) || p.startsWith(pre));
}

// Rate limiters (public endpointler için).
const limiters = createRateLimiters();
app.use('/api/license/activate', limiters.activate);
app.use('/api/license/validate', limiters.validate);
app.use('/api/license/heartbeat', limiters.heartbeat);
app.use('/api/customer-sync/', limiters.customerSync);
app.use('/api/dealer/auth/', limiters.auth);

app.use((req, res, next) => {
    const currentPath = req.path || '';
    if (isPublic(currentPath)) return next();
    if (!currentPath.startsWith('/api/')) return next();

    const authHeader = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match) return res.status(401).json({ error: 'unauthorized' });

    const tokenBuf = Buffer.from(match[1]);
    // timingSafeEqual length-check (atılan hatayı log'la, brute-force görünür olsun).
    if (tokenBuf.length !== ADMIN_SECRET_BUF.length) {
        logger.warn(`[license-server] auth fail (length mismatch) from ${req.ip}`);
        return res.status(401).json({ error: 'unauthorized' });
    }
    try {
        if (!crypto.timingSafeEqual(tokenBuf, ADMIN_SECRET_BUF)) {
            logger.warn(`[license-server] auth fail (bad token) from ${req.ip}`);
            return res.status(401).json({ error: 'unauthorized' });
        }
    } catch (_) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    next();
});

app.use('/api', customerSync);
app.use('/api', dealerAuth);
app.use('/api', adminRoutes);   // /api/admin/* — geliştirici paneli
app.use('/api', licenseRoutes);
app.use('/api', centralRoutes);
app.use('/api', policyRoutes);
app.use('/api', listsRoutes.router);
app.use('/api', apiPolicyRoutes.router);

// ============================================================
// Admin Panel statik servis: keygen.html ve asset'leri.
// /admin/* → apps/license-server/public/admin/*
// /admin   → keygen.html
// ============================================================
const ADMIN_PUBLIC_DIR = path.join(__dirname, 'public', 'admin');
app.use('/admin', express.static(ADMIN_PUBLIC_DIR, {
    etag: true, lastModified: true, maxAge: 0,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate')
}));
app.get('/admin', (req, res) => res.sendFile(path.join(ADMIN_PUBLIC_DIR, 'keygen.html')));
app.get('/keygen.html', (req, res) => res.redirect('/admin/'));

app.use('/api', (req, res) => res.status(404).json({ error: `API endpoint bulunamadı: ${req.method} ${req.path}` }));
app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) logger.error('[license-server]', err);
    res.status(status).json({ error: err.message || 'internal' });
});

const port = envInt('PORT', 3200);
let httpSrv = null;

(async () => {
    await ready;
    httpSrv = app.listen(port, () => logger.info(`License-Server @ http://localhost:${port}`));
})().catch((error) => {
    logger.error('[license-server] bootstrap failed:', error);
    process.exit(1);
});

// Graceful shutdown: HTTP server close → DB pool/handle close → exit.
installShutdownHandlers([
    () => new Promise((resolve) => {
        if (!httpSrv) return resolve();
        httpSrv.close(() => { logger.info('[license-server] HTTP server kapandı'); resolve(); });
        // 8 sn sonra zorla kapat
        setTimeout(() => { try { httpSrv.closeAllConnections?.(); } catch (_) {} resolve(); }, 8000).unref();
    }),
    async () => {
        try {
            const dbMod = require('./db');
            if (dbMod.pool && typeof dbMod.pool.end === 'function') {
                await dbMod.pool.end();
                logger.info('[license-server] MariaDB pool kapandı');
            }
            if (dbMod.db && typeof dbMod.db.close === 'function') {
                dbMod.db.close();
                logger.info('[license-server] SQLite kapandı');
            }
        } catch (e) { logger.warn('[license-server] DB shutdown:', e.message); }
    }
]);

// Beklenmeyen hatalar — crash yerine logla.
process.on('unhandledRejection', (reason) => logger.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => {
    logger.error('[uncaughtException]', err);
    // Kritik hata — process'i yenile (orchestrator restart eder).
    process.exit(1);
});
