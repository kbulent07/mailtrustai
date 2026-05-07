// ============================================================
// OTP (Tek Kullanımlık Şifre) DEPOSU — bellek içi, TTL'li
// ============================================================
const crypto = require('crypto');

const OTP_TTL_MS         = 10 * 60 * 1000;   // 10 dakika geçerlilik
const MAX_ATTEMPTS       = 5;                  // bu kadar hatalı girişten sonra kod geçersiz
const MIN_RESEND_MS      = 2 * 60 * 1000;     // 2 dakikadan önce yeni kod istenemez

// key → { code, expiresAt, attempts, createdAt }
const _store = new Map();

// Süresi dolmuş kayıtları periyodik temizle
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _store.entries()) {
        if (now > v.expiresAt) _store.delete(k);
    }
}, 5 * 60 * 1000);

/**
 * Belirli bir anahtar (ör. 'admin-reset') için OTP oluşturur.
 * @returns {{ code: string, cooldown: boolean, cooldownMs: number }}
 */
function generateOtp(key) {
    const existing = _store.get(key);
    const now = Date.now();

    // Henüz geçerli bir kod varsa ve cooldown dolmadıysa yeni kod üretme
    if (existing && now < existing.expiresAt && (now - existing.createdAt) < MIN_RESEND_MS) {
        return {
            code: null,
            cooldown: true,
            cooldownMs: MIN_RESEND_MS - (now - existing.createdAt)
        };
    }

    // 6 haneli sayısal kod (kriptografik)
    const code = String(crypto.randomInt(100000, 999999));
    _store.set(key, {
        code,
        expiresAt: now + OTP_TTL_MS,
        createdAt: now,
        attempts:  0
    });

    return { code, cooldown: false, cooldownMs: 0 };
}

/**
 * Kodu doğrular.
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyOtp(key, inputCode) {
    const entry = _store.get(key);
    const now = Date.now();

    if (!entry)              return { valid: false, reason: 'no-code' };
    if (now > entry.expiresAt) { _store.delete(key); return { valid: false, reason: 'expired' }; }

    entry.attempts += 1;

    if (entry.attempts > MAX_ATTEMPTS) {
        _store.delete(key);
        return { valid: false, reason: 'too-many-attempts' };
    }

    if (entry.code !== String(inputCode || '').trim()) {
        return { valid: false, reason: 'wrong-code', attemptsLeft: MAX_ATTEMPTS - entry.attempts };
    }

    // Başarılı → tek kullanımlık; hemen sil
    _store.delete(key);
    return { valid: true };
}

/** Kodu iptal et (ör. fazladan güvenlik) */
function invalidateOtp(key) {
    _store.delete(key);
}

module.exports = { generateOtp, verifyOtp, invalidateOtp };
