// ============================================================
// PATTERN STORE — Tehdit kalıpları ve marka domainlerini
// SQLite'tan yükler. Derlenen RegExp'leri in-memory önbellekte
// tutar; admin güncelleme yaptıktan sonra cache temizlenir.
// ============================================================
const db = require('./db');

// ─── IN-MEMORY ÖNBELLEK ──────────────────────────────────────
let _brandCache    = null;   // Array<[domain, alias]>
let _patternCache  = {};     // { category: RegExp[] }

function invalidateCache() {
    _brandCache   = null;
    _patternCache = {};
}

// ─── MARKA DOMAINLER ─────────────────────────────────────────
/**
 * Aktif marka domain listesini [canonicalDomain, alias] çifti
 * dizisi olarak döner. Sonuç önbelleğe alınır.
 */
function getBrandDomains() {
    if (_brandCache) return _brandCache;
    const rows = db.prepare(
        'SELECT domain, alias FROM brand_domains WHERE enabled = 1 ORDER BY domain'
    ).all();
    _brandCache = rows.map(r => [r.domain, r.alias]);
    return _brandCache;
}

// ─── TEHDİT KALIPLARı ────────────────────────────────────────
/**
 * Belirtilen kategorideki etkin kalıpları derlenmiş RegExp dizisi
 * olarak döner. Sonuç önbelleğe alınır.
 * @param {string} category
 * @returns {RegExp[]}
 */
function getPatterns(category) {
    if (_patternCache[category]) return _patternCache[category];
    const rows = db.prepare(
        'SELECT pattern, flags FROM threat_patterns WHERE category = ? AND enabled = 1'
    ).all(category);
    _patternCache[category] = rows.map(r => {
        try   { return new RegExp(r.pattern, r.flags || 'i'); }
        catch { return null; }
    }).filter(Boolean);
    return _patternCache[category];
}

// ─── YÖNETİM API'LERI ────────────────────────────────────────

/** Tüm marka domainlerini listeler (admin paneli için) */
function listBrandDomains() {
    return db.prepare('SELECT * FROM brand_domains ORDER BY domain').all();
}

/** Yeni marka domain ekler */
function addBrandDomain(domain, alias) {
    const d = String(domain || '').trim().toLowerCase().replace(/^www\./, '');
    const a = String(alias  || '').trim().toLowerCase();
    if (!d || !a) throw new Error('Domain ve alias zorunludur');
    db.prepare('INSERT OR REPLACE INTO brand_domains (domain, alias, enabled) VALUES (?,?,1)').run(d, a);
    invalidateCache();
}

/** Marka domain siler */
function removeBrandDomain(domain) {
    db.prepare('DELETE FROM brand_domains WHERE domain = ?').run(domain);
    invalidateCache();
}

/** Marka domain'i etkinleştirir / devre dışı bırakır */
function toggleBrandDomain(domain, enabled) {
    db.prepare('UPDATE brand_domains SET enabled = ? WHERE domain = ?').run(enabled ? 1 : 0, domain);
    invalidateCache();
}

/** Tüm tehdit kalıplarını listeler (admin paneli için) */
function listThreatPatterns(category = null) {
    if (category) {
        return db.prepare('SELECT * FROM threat_patterns WHERE category = ? ORDER BY id').all(category);
    }
    return db.prepare('SELECT * FROM threat_patterns ORDER BY category, id').all();
}

/** Yeni tehdit kalıbı ekler */
function addThreatPattern({ category, pattern, flags = 'i', lang = 'any', severity = 'warning' }) {
    if (!category || !pattern) throw new Error('Kategori ve kalıp zorunludur');
    // Derleme testi
    new RegExp(pattern, flags); // fırlatırsa hatalı regex
    db.prepare(
        'INSERT INTO threat_patterns (category, pattern, flags, lang, severity) VALUES (?,?,?,?,?)'
    ).run(category, pattern, flags, lang, severity);
    invalidateCache();
}

/** Tehdit kalıbını günceller */
function updateThreatPattern(id, patch) {
    const allowed = ['pattern','flags','lang','severity','enabled','category'];
    const fields  = Object.keys(patch).filter(k => allowed.includes(k));
    if (!fields.length) return;
    if (patch.pattern) new RegExp(patch.pattern, patch.flags || 'i'); // derleme testi
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const vals = fields.map(f => patch[f]);
    db.prepare(`UPDATE threat_patterns SET ${sets} WHERE id = ?`).run(...vals, id);
    invalidateCache();
}

/** Tehdit kalıbını siler */
function removeThreatPattern(id) {
    db.prepare('DELETE FROM threat_patterns WHERE id = ?').run(id);
    invalidateCache();
}

module.exports = {
    // Analiz katmanı tarafından kullanılır
    getBrandDomains,
    getPatterns,
    // Admin API'leri
    invalidateCache,
    listBrandDomains, addBrandDomain, removeBrandDomain, toggleBrandDomain,
    listThreatPatterns, addThreatPattern, updateThreatPattern, removeThreatPattern
};
