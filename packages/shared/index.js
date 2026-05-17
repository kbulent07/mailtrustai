'use strict';

// Logger — minimum yapı; üretimde pino vb. ile değiştirilebilir.
function ts() { return new Date().toISOString(); }
const logger = {
    info:  (...a) => console.log('[INFO ]', ts(), ...a),
    warn:  (...a) => console.warn('[WARN ]', ts(), ...a),
    error: (...a) => console.error('[ERROR]', ts(), ...a),
    debug: (...a) => process.env.MSA_DEBUG ? console.log('[DEBUG]', ts(), ...a) : null
};

// Config loader — env tabanlı. Customer/dealer/license-server hepsi kullanır.
function env(name, def = undefined) {
    const v = process.env[name];
    if (v === undefined || v === '') return def;
    return v;
}
function envBool(name, def = false) {
    const v = process.env[name];
    if (v === undefined || v === '') return def;
    return String(v).toLowerCase() === 'true' || v === '1';
}
function envInt(name, def) {
    const v = process.env[name];
    if (v === undefined || v === '') return def;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}

// Constants — uygulama paylaşımlı
const APP = {
    NAME: 'MailTrustAI',
    VERSION: require('./package.json').version,
    BUILD: process.env.MSA_BUILD_VERSION || 'dev',
    // Heartbeat eşikleri (saniye)
    HEARTBEAT_ONLINE: 300,
    HEARTBEAT_STALE: 1800
};

// Error helper
class AppError extends Error {
    constructor(message, code = 'APP_ERROR', status = 500) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

// Async route wrapper
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// PII scrubber — central-sync log'larında ve heartbeat payload'larında
// hassas anahtar kelimelerin sızmamasını sağlar.
const PII_KEYS = new Set([
    'mailBody', 'mailSubject', 'subject', 'body', 'html', 'text',
    'sender', 'senderAddress', 'recipient', 'recipientAddress', 'to', 'from', 'cc', 'bcc',
    'attachmentName', 'attachmentContent', 'attachment', 'attachments',
    'rawHeaders', 'headers',
    'imapPassword', 'smtpPassword', 'password', 'passwd',
    'apiKey', 'openaiApiKey', 'claudeApiKey', 'anthropicApiKey', 'virustotalApiKey', 'vtApiKey',
    'credentials', 'credential',
    'aiPrompt', 'aiResponse', 'promptText'
]);
function scrubPII(obj, depth = 0) {
    if (depth > 6 || obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(v => scrubPII(v, depth + 1));
    if (typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (PII_KEYS.has(k)) { out[k] = '[REDACTED]'; continue; }
        out[k] = scrubPII(v, depth + 1);
    }
    return out;
}

// Güvenli JSON parse — DB'de bozuk satır veya cache dosyası 500 patlatmasın.
function safeJSON(text, fallback = null) {
    if (text === null || text === undefined || text === '') return fallback;
    if (typeof text === 'object') return text; // zaten parse edilmiş
    try { return JSON.parse(text); } catch (_) { return fallback; }
}

// Prototype pollution koruyucu reviver — express.json({ reviver }) ile kullan.
// `__proto__`, `constructor`, `prototype` anahtarları gelirse atar.
function safeJSONReviver(key, value) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return undefined;
    return value;
}

// Process-level prototype pollution koruması: tüm built-in prototype'ları dondur.
// Boot sırasında bir kez çağrılır. Idempotent.
let _prototypesFrozen = false;
function hardenPrototypes() {
    if (_prototypesFrozen) return;
    try {
        Object.freeze(Object.prototype);
        Object.freeze(Array.prototype);
        Object.freeze(Function.prototype);
        Object.freeze(Number.prototype);
        Object.freeze(String.prototype);
        Object.freeze(Boolean.prototype);
        _prototypesFrozen = true;
    } catch (e) {
        logger.warn('[shared] prototype freeze başarısız:', e.message);
    }
}

// Graceful shutdown helper'ı: callback'leri sırayla çağırır, timeout sonra exit.
function installShutdownHandlers(handlers = [], { timeoutMs = 15000, signals = ['SIGTERM', 'SIGINT'] } = {}) {
    let shuttingDown = false;
    const handler = async (sig) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`[shutdown] ${sig} alındı, kapatılıyor...`);
        const killer = setTimeout(() => {
            logger.error('[shutdown] timeout aşıldı, force exit.');
            process.exit(1);
        }, timeoutMs);
        try {
            for (const h of handlers) {
                try { await Promise.resolve(h()); } catch (e) { logger.warn('[shutdown] handler hatası:', e.message); }
            }
        } finally {
            clearTimeout(killer);
            process.exit(0);
        }
    };
    for (const sig of signals) process.on(sig, () => handler(sig));
}

module.exports = {
    logger, env, envBool, envInt, APP, AppError, asyncH,
    scrubPII, PII_KEYS, safeJSON, safeJSONReviver, hardenPrototypes,
    installShutdownHandlers
};

// fetchJSON helper — lazy require ile circular dep'i önle.
Object.defineProperty(module.exports, 'fetchJSON', {
    enumerable: true,
    get: () => require('./fetch').fetchJSON
});
Object.defineProperty(module.exports, 'assertSafeUrl', {
    enumerable: true,
    get: () => require('./fetch').assertSafeUrl
});
