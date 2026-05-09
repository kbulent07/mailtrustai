// ============================================================
// TRUSTED DOMAIN STORE — OTX whitelist'i SQLite üzerinden yönetir.
// In-memory Set önbelleği ile her sorguda DB'ye gitmez; admin
// güncelleme yaptığında cache invalidate edilir.
// ============================================================
const db = require('./db');

let _cache = null;  // Set<string> | null

function _loadCache() {
    const rows = db.prepare(
        'SELECT domain FROM trusted_domains WHERE enabled = 1'
    ).all();
    _cache = new Set(rows.map(r => r.domain));
    return _cache;
}

function invalidateCache() { _cache = null; }

/** In-memory Set döner (lazy load + cache) */
function getTrustedDomains() {
    return _cache || _loadCache();
}

function _normalize(domain) {
    return String(domain || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/[/?#].*$/, '')
        .replace(/^@/, '');
}

function _isValidDomain(d) {
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d);
}

/** Adminin bütün liste için ihtiyaç duyduğu detaylı veri */
function listTrustedDomains() {
    return db.prepare(
        'SELECT domain, category, added_by, note, enabled, created_at FROM trusted_domains ORDER BY category, domain'
    ).all();
}

/**
 * Yeni domain ekler veya mevcudunu günceller.
 * @returns {{ ok: true, inserted: boolean }}
 */
function addTrustedDomain({ domain, category = 'custom', addedBy = 'admin', note = '' }) {
    const d = _normalize(domain);
    if (!d) throw new Error('Domain zorunludur');
    if (!_isValidDomain(d)) throw new Error(`Geçersiz domain biçimi: "${d}"`);
    const cat = String(category || 'custom').toLowerCase();
    const result = db.prepare(`
        INSERT INTO trusted_domains (domain, category, added_by, note, enabled)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(domain) DO UPDATE SET
            category = excluded.category,
            note     = excluded.note,
            enabled  = 1
    `).run(d, cat, addedBy, String(note || ''));
    invalidateCache();
    return { ok: true, inserted: result.changes > 0, domain: d };
}

/** Toplu ekleme — invalid olanlar atlanır, başarısız ve eklenenleri döndürür */
function addTrustedDomainsBulk(items, { category = 'custom', addedBy = 'admin' } = {}) {
    const accepted = [];
    const rejected = [];
    db.transaction(() => {
        for (const raw of items) {
            const d = _normalize(raw);
            if (!d || !_isValidDomain(d)) { rejected.push(raw); continue; }
            db.prepare(`
                INSERT INTO trusted_domains (domain, category, added_by, note, enabled)
                VALUES (?, ?, ?, '', 1)
                ON CONFLICT(domain) DO UPDATE SET enabled = 1
            `).run(d, category, addedBy);
            accepted.push(d);
        }
    })();
    invalidateCache();
    return { accepted, rejected };
}

function removeTrustedDomain(domain) {
    const d = _normalize(domain);
    const r = db.prepare('DELETE FROM trusted_domains WHERE domain = ?').run(d);
    invalidateCache();
    return { removed: r.changes > 0 };
}

function setEnabled(domain, enabled) {
    const d = _normalize(domain);
    db.prepare('UPDATE trusted_domains SET enabled = ? WHERE domain = ?').run(enabled ? 1 : 0, d);
    invalidateCache();
}

/**
 * value içindeki domain (veya alt domain'i) trusted listede mi?
 * Subdomain match: x.youtube.com → youtube.com listede ise TRUE
 */
function isTrusted(value) {
    const set = getTrustedDomains();
    const v = _normalize(value);
    if (!v) return false;
    if (set.has(v)) return true;
    const parts = v.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join('.');
        if (set.has(candidate)) return true;
    }
    return false;
}

module.exports = {
    getTrustedDomains,
    invalidateCache,
    listTrustedDomains,
    addTrustedDomain,
    addTrustedDomainsBulk,
    removeTrustedDomain,
    setEnabled,
    isTrusted
};
