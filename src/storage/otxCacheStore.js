// ============================================================
// OTX CACHE STORE
// AlienVault OTX itibar sorgusu sonuçlarını önbellekte tutar.
// Anahtar: indicator (IP veya domain string)
// TTL: 24 saat — OTX tehdit verileri nadiren değişir
// ============================================================
const fs   = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', '..', 'data', 'otx-cache.json');
const TTL_MS     = 24 * 60 * 60 * 1000; // 24 saat

// { indicator → { result, cachedAt } }
const _cache = new Map();
let _dirty   = 0;           // son kayıttan bu yana yapılan değişiklik sayısı
const FLUSH_EVERY = 20;     // Her 20 yazıda diske flush et

// ─── BAŞLANGIÇ YÜKLEME ──────────────────────────────────────
(function loadFromDisk() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return;
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const obj = JSON.parse(raw || '{}');
        const now = Date.now();
        let loaded = 0;
        for (const [key, entry] of Object.entries(obj)) {
            if (entry?.cachedAt && (now - entry.cachedAt) < TTL_MS) {
                _cache.set(key, entry);
                loaded++;
            }
        }
        if (loaded > 0) console.log(`[OTX Cache] ${loaded} kayıt yüklendi`);
    } catch { /* Önbellek bozuksa yeni başla */ }
})();

// ─── SORGU ──────────────────────────────────────────────────
function getCachedResult(indicator) {
    const entry = _cache.get(String(indicator).toLowerCase());
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > TTL_MS) {
        _cache.delete(String(indicator).toLowerCase());
        return null;
    }
    return entry.result;
}

// ─── KAYIT ───────────────────────────────────────────────────
// Hatalı / rate-limit sonuçlarını önbelleğe alma
function setCachedResult(indicator, result) {
    if (!result || result.error) return;
    _cache.set(String(indicator).toLowerCase(), { result, cachedAt: Date.now() });
    _dirty++;
    if (_dirty >= FLUSH_EVERY) flushCache();
}

// ─── DİSKE YAZ ───────────────────────────────────────────────
function flushCache() {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj = Object.fromEntries(_cache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf8');
        _dirty = 0;
    } catch (e) {
        console.error('[OTX Cache] Disk yazma hatası:', e.message);
    }
}

function getCacheStats() {
    return { size: _cache.size, dirty: _dirty };
}

function clearExpired() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of _cache) {
        if ((now - entry.cachedAt) >= TTL_MS) { _cache.delete(key); removed++; }
    }
    if (removed > 0) flushCache();
    return removed;
}

// Uygulama kapanışında diske yaz
process.on('exit',    flushCache);
process.on('SIGINT',  () => { flushCache(); process.exit(0); });
process.on('SIGTERM', () => { flushCache(); process.exit(0); });

module.exports = { getCachedResult, setCachedResult, flushCache, getCacheStats, clearExpired };
