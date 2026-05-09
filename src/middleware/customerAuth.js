// ============================================================
// MÜŞTERİ YÖNETİM PANELİ AUTH (index.html erişimi)
// Admin auth'tan ayrı, kendi şifresi var.
// ============================================================
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { loadSettings, saveSettings } = require('../storage/settingsStore');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

function _getSecret() {
    return (process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#') + '|customer';
}

function createCustomerToken() {
    const payload    = JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS, r: 'customer' });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig        = crypto.createHmac('sha256', _getSecret()).update(payloadB64).digest('hex');
    return `${payloadB64}.${sig}`;
}

function verifyCustomerToken(token) {
    if (!token || typeof token !== 'string') return false;
    const dot = token.lastIndexOf('.');
    if (dot < 1) return false;
    const payloadB64 = token.slice(0, dot);
    const sig        = token.slice(dot + 1);

    const expectedSig = crypto.createHmac('sha256', _getSecret()).update(payloadB64).digest('hex');
    try {
        const eSigBuf = Buffer.from(expectedSig, 'hex');
        const sSigBuf = Buffer.from(sig,         'hex');
        if (eSigBuf.length !== sSigBuf.length) return false;
        if (!crypto.timingSafeEqual(eSigBuf, sSigBuf)) return false;
    } catch { return false; }

    try {
        const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        return parsed.r === 'customer' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
    } catch { return false; }
}

async function verifyCustomerPassword(provided) {
    const settings = loadSettings();
    const stored   = settings.customerPassword || '';
    if (!stored || !provided) return false;
    const isBcrypt = stored.startsWith('$2b$') || stored.startsWith('$2a$');
    return isBcrypt ? bcrypt.compare(provided, stored) : provided === stored;
}

function isCustomerPasswordSet() {
    return Boolean((loadSettings().customerPassword || '').trim());
}

async function setCustomerPassword(plain) {
    const hash = await bcrypt.hash(String(plain), 10);
    const s = loadSettings();
    saveSettings({ ...s, customerPassword: hash });
    return true;
}

// IP başına ilk kurulum / login için rate limit
const setupAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of setupAttempts.entries()) {
        if (now > rec.resetAt) setupAttempts.delete(ip);
    }
}, 5 * 60 * 1000).unref(); // .unref(): bu interval Node.js event loop'u canlı tutmaz

function checkLoginRate(ip) {
    const now = Date.now();
    const rec = setupAttempts.get(ip);
    if (!rec || now > rec.resetAt) {
        setupAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return { allowed: true };
    }
    rec.count++;
    if (rec.count > MAX_ATTEMPTS) {
        return { allowed: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
    }
    return { allowed: true };
}

function clearLoginRate(ip) {
    setupAttempts.delete(ip);
}

module.exports = {
    createCustomerToken,
    verifyCustomerToken,
    verifyCustomerPassword,
    isCustomerPasswordSet,
    setCustomerPassword,
    checkLoginRate,
    clearLoginRate
};
