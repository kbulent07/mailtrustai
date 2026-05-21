// ============================================================
// LOG-SAFE HELPERS
// Hata loglarinda PII / API key / mail icerigi sizmasini onler.
// Kullanim:
//   const { maskSecret, redact, truncate } = require('../utils/logSafe');
//   console.error('Claude error:', maskSecret(apiKey), truncate(rawBody, 200));
// ============================================================

/**
 * API anahtari / token / parolayi maskeler.
 * Ilk 4 + son 4 karakter gosterilir, gerisi yildiz.
 * Cok kisa stringler tamamen maskelenir.
 */
function maskSecret(value, opts = {}) {
    const { show = 4 } = opts;
    const s = String(value || '');
    if (!s) return '';
    if (s.length <= show * 2) return '*'.repeat(s.length);
    return `${s.slice(0, show)}${'*'.repeat(Math.max(4, s.length - show * 2))}${s.slice(-show)}`;
}

/**
 * E-posta adreslerini maskeler: alice@example.com -> a***@example.com
 */
function maskEmail(email) {
    const s = String(email || '');
    const m = s.match(/^([^@]+)@(.+)$/);
    if (!m) return s ? '***' : '';
    const [, local, domain] = m;
    const visible = local.slice(0, 1);
    return `${visible}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

/**
 * Bir text'i maks. N karaktere kisaltir; uzunsa "... [N more]" ekler.
 * Logda buyuk payload patlatmayi onler.
 */
function truncate(text, max = 300) {
    const s = String(text || '');
    if (s.length <= max) return s;
    return `${s.slice(0, max)}... [+${s.length - max} char]`;
}

/**
 * Bilinen PII pattern'lerini metinde maskeler (e-posta, API key fragmanlari,
 * Bearer token, Authorization header).
 * AI yanitlarini loglarken kullanin.
 */
function redact(text) {
    let s = String(text || '');
    // Bearer token
    s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]{16,}/gi, '$1***');
    // Authorization: ... header
    s = s.replace(/(authorization["'\s:=]+)[A-Za-z0-9._\-]{16,}/gi, '$1***');
    // sk-, pk-, anthropic key prefix'leri
    s = s.replace(/\b(sk|pk|sk-ant|claude)[-_][A-Za-z0-9]{16,}\b/g, '$1-***');
    // E-posta adresleri
    s = s.replace(/([A-Za-z0-9._%+\-]+)@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g,
        (_, l, d) => `${l.slice(0,1)}***@${d}`);
    return s;
}

module.exports = { maskSecret, maskEmail, truncate, redact };
