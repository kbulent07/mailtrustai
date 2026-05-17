'use strict';
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// AES-256-GCM local encrypted storage (customer-side API key/lisans cache için).
// Anahtar MSA_LOCAL_ENCRYPTION_KEY env'inden; yoksa stable dosyaya türetilir.
function _key() {
    const fromEnv = process.env.MSA_LOCAL_ENCRYPTION_KEY;
    if (fromEnv && fromEnv.length >= 32) return crypto.createHash('sha256').update(fromEnv).digest();
    const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const keyPath = path.join(dir, '.local-enc.key');
    if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
    const k = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, k, { mode: 0o600 });
    return k;
}
function encryptJSON(obj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', _key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, data]).toString('base64');
}
function decryptJSON(b64) {
    const raw = Buffer.from(b64, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const dec = crypto.createDecipheriv('aes-256-gcm', _key(), iv);
    dec.setAuthTag(tag);
    const out = Buffer.concat([dec.update(data), dec.final()]);
    return JSON.parse(out.toString('utf8'));
}

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function hmac(secret, payload) {
    return crypto.createHmac('sha256', secret).update(typeof payload === 'string' ? payload : JSON.stringify(payload)).digest('hex');
}

// Bearer token auth — dealer ↔ license-server arası ve customer ↔ license-server arası.
// timingSafeEqual farklı uzunlukta throw eder; uzunluk eşitliği önce kontrol edilir.
function bearerAuth(expectedSecret) {
    const expected = expectedSecret ? Buffer.from(expectedSecret) : null;
    return (req, res, next) => {
        const h = req.headers['authorization'] || '';
        const m = /^Bearer\s+(.+)$/i.exec(h);
        if (!m || !expected) return res.status(401).json({ error: 'unauthorized' });
        const got = Buffer.from(m[1]);
        if (got.length !== expected.length) return res.status(401).json({ error: 'unauthorized' });
        try {
            if (!crypto.timingSafeEqual(got, expected)) return res.status(401).json({ error: 'unauthorized' });
        } catch (_) {
            return res.status(401).json({ error: 'unauthorized' });
        }
        next();
    };
}

module.exports = { encryptJSON, decryptJSON, sha256, hmac, bearerAuth };
