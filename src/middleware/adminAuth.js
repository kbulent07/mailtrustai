const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { loadSettings } = require('../storage/settingsStore');

// ─── SESSION TOKEN (hafif JWT benzeri, dış paket gerektirmez) ─
// Format: base64url(payload) + '.' + HMAC-SHA256(payload, secret)
// Payload: { exp: unix_ms, r: 'admin' }
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 saat

function _getSecret() {
    return process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#';
}

function createAdminToken() {
    const payload    = JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS, r: 'admin' });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig        = crypto.createHmac('sha256', _getSecret()).update(payloadB64).digest('hex');
    return `${payloadB64}.${sig}`;
}

function verifyAdminToken(token) {
    if (!token || typeof token !== 'string') return false;
    const dot = token.lastIndexOf('.');
    if (dot < 1) return false;
    const payloadB64 = token.slice(0, dot);
    const sig        = token.slice(dot + 1);

    // HMAC doğrulaması (zamanlama saldırısına karşı güvenli)
    const expectedSig = crypto.createHmac('sha256', _getSecret()).update(payloadB64).digest('hex');
    try {
        const eSigBuf = Buffer.from(expectedSig, 'hex');
        const sSigBuf = Buffer.from(sig,         'hex');
        if (eSigBuf.length !== sSigBuf.length) return false;
        if (!crypto.timingSafeEqual(eSigBuf, sSigBuf)) return false;
    } catch { return false; }

    // Payload kontrolü
    try {
        const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        return parsed.r === 'admin' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
    } catch { return false; }
}

// ─── ŞIFRE DOĞRULAMA ─────────────────────────────────────────
async function verifyAdminPassword(provided) {
    const settings = loadSettings();
    const stored   = settings.adminPassword || '';
    if (!stored || !provided) return false;
    const isBcrypt = stored.startsWith('$2b$') || stored.startsWith('$2a$');
    return isBcrypt ? bcrypt.compare(provided, stored) : provided === stored;
}

// ─── MIDDLEWARE ───────────────────────────────────────────────
// Hem eski x-admin-password header hem de yeni Bearer token desteklenir.
async function requireAdminAuth(req, res, next) {
    // 1) Bearer token kontrolü (keygen.html ve modern istemciler)
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (verifyAdminToken(token)) return next();
        return res.status(403).json({ error: 'Geçersiz veya süresi dolmuş oturum. Lütfen tekrar giriş yapın.' });
    }

    // 2) Eski yöntem: x-admin-password header (geriye dönük uyum)
    const provided = req.headers['x-admin-password'] || req.body?.adminPassword || '';
    if (!provided) {
        return res.status(403).json({ error: 'Admin kimlik doğrulaması gerekli' });
    }
    const match = await verifyAdminPassword(provided);
    if (!match) return res.status(403).json({ error: 'Admin kimlik doğrulaması gerekli' });
    next();
}

module.exports = { requireAdminAuth, createAdminToken, verifyAdminToken, verifyAdminPassword };
