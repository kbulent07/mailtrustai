'use strict';
// Hafif rate-limiter. express-rate-limit varsa onu, yoksa in-memory
// fallback'i kullanır. Dağıtık deploy için Redis-store önerilir.

const { envInt, logger } = require('@mailtrustai/shared');

let externalLimiter = null;
try {
    externalLimiter = require('express-rate-limit');
} catch (_) {
    logger.warn('[license-server] express-rate-limit kurulu değil, fallback limiter kullanılıyor.');
}

function fallbackLimiter({ windowMs, max, label }) {
    const buckets = new Map(); // ip → { count, resetAt }
    return (req, res, next) => {
        const key = (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString();
        const now = Date.now();
        const b = buckets.get(key);
        if (!b || b.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        b.count += 1;
        if (b.count > max) {
            logger.warn(`[rate-limit] ${label} bloklandı: ${key} (${b.count}/${max})`);
            res.setHeader('Retry-After', Math.ceil((b.resetAt - now) / 1000));
            return res.status(429).json({ error: 'too many requests' });
        }
        next();
    };
}

function make(label, defaults) {
    const windowMs = envInt(`RATE_${label.toUpperCase()}_WINDOW_MS`, defaults.windowMs);
    const max      = envInt(`RATE_${label.toUpperCase()}_MAX`,        defaults.max);

    if (externalLimiter) {
        return externalLimiter({
            windowMs, max,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: 'too many requests' }
        });
    }
    return fallbackLimiter({ windowMs, max, label });
}

function createRateLimiters() {
    return {
        // /api/license/activate — 1 dakikada 20 istek
        activate:     make('activate',      { windowMs: 60_000,  max: 20 }),
        // /api/license/validate — 1 dakikada 60 istek
        validate:     make('validate',      { windowMs: 60_000,  max: 60 }),
        // /api/license/heartbeat — 5 dakikada 30 istek (300 sn aralıklı normalde)
        heartbeat:    make('heartbeat',     { windowMs: 300_000, max: 30 }),
        // /api/customer-sync/* — 1 dakikada 30 istek
        customerSync: make('customer_sync', { windowMs: 60_000,  max: 30 }),
        // /api/dealer/auth/* — 1 dakikada 10 (brute-force koruması)
        auth:         make('auth',          { windowMs: 60_000,  max: 10 })
    };
}

module.exports = { createRateLimiters };
