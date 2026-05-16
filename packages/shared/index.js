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

module.exports = { logger, env, envBool, envInt, APP, AppError, asyncH, scrubPII, PII_KEYS };
