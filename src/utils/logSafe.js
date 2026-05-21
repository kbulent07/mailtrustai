// ============================================================
// LOG-SAFE HELPERS
// Hata loglarinda PII / API key / mail icerigi sizmasini onler.
//   const { redact, truncate, maskSecret, maskEmail } = require('../utils/logSafe');
// ============================================================

function maskSecret(value, opts = {}) {
    const { show = 4 } = opts;
    const s = String(value || '');
    if (!s) return '';
    if (s.length <= show * 2) return '*'.repeat(s.length);
    return `${s.slice(0, show)}${'*'.repeat(Math.max(4, s.length - show * 2))}${s.slice(-show)}`;
}

function maskEmail(email) {
    const s = String(email || '');
    const m = s.match(/^([^@]+)@(.+)$/);
    if (!m) return s ? '***' : '';
    const [, local, domain] = m;
    return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

function truncate(text, max = 300) {
    const s = String(text || '');
    if (s.length <= max) return s;
    return `${s.slice(0, max)}... [+${s.length - max} char]`;
}

function redact(text) {
    let s = String(text || '');
    s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]{16,}/gi, '$1***');
    s = s.replace(/(authorization["'\s:=]+)[A-Za-z0-9._\-]{16,}/gi, '$1***');
    s = s.replace(/\b(sk|pk|sk-ant|claude)[-_][A-Za-z0-9]{16,}\b/g, '$1-***');
    s = s.replace(/([A-Za-z0-9._%+\-]+)@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g,
        (_, l, d) => `${l.slice(0,1)}***@${d}`);
    return s;
}

module.exports = { maskSecret, maskEmail, truncate, redact };
