// ============================================================
// VIRUSTOTAL HASH ÖNBELLEK DEPOSU
// SHA-256 hash → VT sonucu eşlemesini 24 saat bellekte +
// disk üzerinde (data/vt-hash-cache.json) saklar.
//
// Avantajlar:
//   • Aynı dosya tekrar geldiğinde API çağrısı yapılmaz
//   • 16s bekleme atlanır → analiz hızlanır
//   • Ücretsiz VT kotası (4 istek/dk) korunur
// ============================================================
const fs   = require('fs');
const path = require('path');

const CACHE_FILE   = path.join(__dirname, '..', '..', 'data', 'vt-hash-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat — VT sonuçları bu sürede değişmez

// In-memory harita: hash → { result, cachedAt }
let _cache = null;
let _dirty = false;   // disk'e yazılmamış değişiklik var mı?

// ─── YÜKLEME ────────────────────────────────────────────────
function _loadCache() {
    if (_cache) return _cache;
    _cache = new Map();
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8') || '{}');
            const now = Date.now();
            for (const [hash, entry] of Object.entries(raw)) {
                if (now - (entry.cachedAt || 0) <= CACHE_TTL_MS) {
                    _cache.set(hash, entry);
                }
            }
        }
    } catch {
        _cache = new Map(); // bozuk dosyayı sessizce yoksay
    }
    return _cache;
}

// ─── KAYDETME (flush) ────────────────────────────────────────
function flushCache() {
    if (!_cache || !_dirty) return;
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj = Object.fromEntries(_cache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf8');
        _dirty = false;
    } catch (err) {
        console.warn('[VTCache] Önbellek diske yazılamadı:', err.message);
    }
}

// Uygulama kapanırken otomatik flush
process.on('exit',    flushCache);
process.on('SIGTERM', () => { flushCache(); process.exit(0); });
process.on('SIGINT',  () => { flushCache(); process.exit(0); });

// ─── OKUMA ──────────────────────────────────────────────────
/**
 * Hash için önbelleğe alınmış VT sonucunu döner.
 * TTL geçmişse null döner (cache miss).
 * @param {string} hash  SHA-256 hex
 * @returns {object|null}
 */
function getCachedResult(hash) {
    if (!hash) return null;
    const cache = _loadCache();
    const entry = cache.get(hash);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        cache.delete(hash);
        _dirty = true;
        return null; // süresi dolmuş
    }
    return entry.result;
}

// ─── YAZMA ──────────────────────────────────────────────────
/**
 * VT sonucunu önbelleğe yazar.
 * Hatalı veya belirsiz sonuçlar önbelleğe alınmaz.
 * @param {string} hash
 * @param {object} result  virustotal.js'den dönen normalize sonuç
 */
function setCachedResult(hash, result) {
    if (!hash || !result) return;

    // Hata, rate-limit veya "henüz analiz yok" durumlarını önbelleğe alma
    if (result.error)         return;
    if (!result.checked)      return;
    // "found: false" (VT'de kayıt yok) — kısa süre önbelleğe alınabilir
    // ama temiz "found: true" önceliğimiz
    const _cache = _loadCache();
    _cache.set(hash, { result, cachedAt: Date.now() });
    _dirty = true;

    // Her 20 yazımda bir disk'e kaydet
    if (_cache.size % 20 === 0) flushCache();
}

// ─── ÖNBELLEK İSTATİSTİKLERİ ────────────────────────────────
function getCacheStats() {
    const cache = _loadCache();
    const now   = Date.now();
    let alive = 0, expired = 0;
    for (const entry of cache.values()) {
        if (now - entry.cachedAt <= CACHE_TTL_MS) alive++;
        else expired++;
    }
    return { total: cache.size, alive, expired, file: CACHE_FILE };
}

// ─── TEMİZLEME ──────────────────────────────────────────────
function clearExpired() {
    const cache = _loadCache();
    const now   = Date.now();
    let removed = 0;
    for (const [hash, entry] of cache.entries()) {
        if (now - entry.cachedAt > CACHE_TTL_MS) {
            cache.delete(hash);
            removed++;
        }
    }
    if (removed) { _dirty = true; flushCache(); }
    return removed;
}

module.exports = { getCachedResult, setCachedResult, flushCache, getCacheStats, clearExpired };
