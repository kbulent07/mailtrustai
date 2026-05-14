// ============================================================
// MÜŞTERİ KULLANICI AUTH — email + şifre, rol bazlı (admin | user)
//
// Token payload (HMAC-SHA256 imzalı, base64url):
//   { e: email, r: 'admin'|'user', i: imapEmail|null, exp: <ms> }
//
// req.customerUser:
//   { email, role, imapEmail } — verifyCustomerToken'dan dolar
// ============================================================
const crypto = require('crypto');
const customerUserStore = require('../storage/customerUserStore');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

function _getSecret() {
    return (process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#') + '|customer';
}

/**
 * @param {{email:string, role:'admin'|'user', imapEmail?:string|null}} u
 */
function createCustomerToken(u) {
    if (!u || !u.email || !u.role) throw new Error('createCustomerToken: email + role zorunlu');
    const payload = JSON.stringify({
        e: String(u.email).toLowerCase(),
        r: u.role,
        i: u.imapEmail || null,
        exp: Date.now() + TOKEN_TTL_MS
    });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', _getSecret()).update(payloadB64).digest('hex');
    return `${payloadB64}.${sig}`;
}

/**
 * @returns {null|{email, role, imapEmail, exp}} doğrulanmış payload veya null
 */
function parseCustomerToken(token) {
    if (!token || typeof token !== 'string') return null;
    const dot = token.lastIndexOf('.');
    if (dot < 1) return null;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const expectedSig = crypto.createHmac('sha256', _getSecret()).update(payloadB64).digest('hex');
    try {
        const eBuf = Buffer.from(expectedSig, 'hex');
        const sBuf = Buffer.from(sig, 'hex');
        if (eBuf.length !== sBuf.length) return null;
        if (!crypto.timingSafeEqual(eBuf, sBuf)) return null;
    } catch { return null; }

    try {
        const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        if (!parsed || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return null;
        if (!parsed.e || !['admin', 'user'].includes(parsed.r)) return null;
        return { email: parsed.e, role: parsed.r, imapEmail: parsed.i || null, exp: parsed.exp };
    } catch { return null; }
}

/**
 * Geriye uyumlu boolean — eski caller'lar için
 * @returns {boolean}
 */
function verifyCustomerToken(token) {
    return parseCustomerToken(token) !== null;
}

/**
 * @returns {null|{email, role, imapEmail, ...}} eşleşen aktif kullanıcı veya null
 */
async function verifyCustomerCredentials(email, password) {
    return customerUserStore.verifyPassword(email, password);
}

/**
 * Müşteri kullanıcı oluştur / ilk admin'i kur.
 * @returns {{email, role, imapEmail}}
 */
async function createCustomerUser(opts) {
    return customerUserStore.createUser(opts);
}

function hasAnyAdmin() {
    return customerUserStore.countActiveAdmins() > 0;
}

function isCustomerInitialized() {
    return customerUserStore.isInitialized();
}

// ─── Middleware: req.customerUser yükle ─────────────────────────────────────
function loadCustomerUser(req) {
    if (req.customerUser) return req.customerUser;
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    const payload = parseCustomerToken(token);
    if (!payload) return null;
    // DB'de hâlâ aktif mi kontrol et
    const u = customerUserStore.findByEmail(payload.email);
    if (!u || !u.active) return null;
    // Rol DB'de değişmişse token'a güvenme
    req.customerUser = { email: u.email, role: u.role, imapEmail: u.imapEmail };
    return req.customerUser;
}

function requireCustomerAdmin(req, res, next) {
    const u = loadCustomerUser(req);
    if (!u) return res.status(401).json({ error: 'Müşteri admin oturumu gerekli.' });
    if (u.role !== 'admin') return res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekli.' });
    next();
}

function requireCustomerUser(req, res, next) {
    const u = loadCustomerUser(req);
    if (!u) return res.status(401).json({ error: 'Müşteri oturumu gerekli.' });
    next();
}

// ─── IP başına login rate limit (mevcut) ─────────────────────────────────────
const setupAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of setupAttempts.entries()) {
        if (now > rec.resetAt) setupAttempts.delete(ip);
    }
}, 5 * 60 * 1000).unref();

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
    parseCustomerToken,
    verifyCustomerToken,
    verifyCustomerCredentials,
    createCustomerUser,
    hasAnyAdmin,
    isCustomerInitialized,
    loadCustomerUser,
    requireCustomerAdmin,
    requireCustomerUser,
    checkLoginRate,
    clearLoginRate
};
