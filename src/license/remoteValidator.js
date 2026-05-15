// ============================================================
// UZAK LİSANS DOĞRULAYICI
// ============================================================
// Müşteri sunucusu bu modülü kullanarak sizin merkezi
// doğrulama sunucunuzu periyodik olarak sorgular.
//
// Güvenlik katmanları:
//  1. Uzak sunucu cevabı → bellek önbelleğine (tamper-proof, process içi)
//  2. Bellek önbelleği → disk önbelleğine (yeniden başlama kalıcılığı)
//  3. Disk önbelleği HMAC imzalı — değiştirilirse yok sayılır
//  4. Uzak sunucu erişilemezse: grace period (varsayılan 72 saat)
//  5. Grace period dolunca lisans engellenir
// ============================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Kullanici sadece host yazarsa otomatik /api/license/check ekle.
// Tam URL yazmis ise (path iceriyorsa) oldugu gibi birak.
function _normalizeRemoteUrl(raw) {
    const v = String(raw || '').trim().replace(/\/+$/, '');
    if (!v) return '';
    try {
        const u = new URL(v);
        if (u.pathname === '/' || u.pathname === '') {
            return u.origin + '/api/license/check';
        }
        return v;
    } catch {
        return v;
    }
}
const REMOTE_URL = _normalizeRemoteUrl(process.env.MSA_LICENSE_REMOTE_URL);
const SHARED_SECRET = process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#';
const CACHE_FILE = path.join(__dirname, '..', '..', 'data', 'license-remote-cache.json');
const GRACE_PERIOD_MS = parseInt(process.env.MSA_LICENSE_GRACE_MS) || 72 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = parseInt(process.env.MSA_LICENSE_REFRESH_MS) || 6 * 60 * 60 * 1000;

// ─── Bellek önbelleği: key → { valid, revokedAt, checkedAt, source } ─────
// process.memory içinde → müşteri tarafından değiştirilemez
const _memMap = new Map();

// ─── İmza ────────────────────────────────────────────────
function sign(obj) {
    const content = JSON.stringify({ key: obj.key, valid: obj.valid, checkedAt: obj.checkedAt });
    return crypto.createHmac('sha256', SHARED_SECRET).update(content).digest('hex').substring(0, 32);
}

// ─── Disk önbelleği ──────────────────────────────────────
function loadDiskCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return {};
        const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        // HMAC doğrulama
        const validated = {};
        for (const [k, v] of Object.entries(raw)) {
            if (v._sig === sign(v)) {
                validated[k] = v;
            } else {
                console.warn(`[RemoteValidator] Disk önbelleği imza hatası, atlanıyor: ${k.slice(0, 20)}...`);
            }
        }
        return validated;
    } catch { return {}; }
}

function saveDiskCache(all) {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const signed = {};
    for (const [k, v] of Object.entries(all)) {
        signed[k] = { ...v, _sig: sign(v) };
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(signed, null, 2), 'utf8');
}

function persistEntry(key, entry) {
    const all = loadDiskCache();
    all[key] = entry;
    saveDiskCache(all);
}

// ─── Bellek önbelleğini disk'ten başlat ──────────────────
(function initFromDisk() {
    const all = loadDiskCache();
    for (const [k, v] of Object.entries(all)) {
        _memMap.set(k, v);
    }
    if (_memMap.size > 0) {
        console.log(`[RemoteValidator] ${_memMap.size} lisans önbelleği yüklendi.`);
    }
})();

// ─── Uzak sunucu sorgusu ─────────────────────────────────
async function fetchRemote(licenseKey) {
    if (!REMOTE_URL) {
        return { success: false, error: 'MSA_LICENSE_REMOTE_URL tanımlanmamış' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(REMOTE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: licenseKey }),
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Beklenen: { valid: bool, revokedAt?: ISO string }
        return { success: true, valid: data.valid !== false, revokedAt: data.revokedAt || null };
    } catch (e) {
        return { success: false, error: e.message };
    } finally {
        clearTimeout(timeout);
    }
}

// ─── Güncelleme ──────────────────────────────────────────
async function refreshKey(licenseKey) {
    const remote = await fetchRemote(licenseKey);
    if (!remote.success) {
        return { refreshed: false, error: remote.error };
    }
    const entry = {
        key: licenseKey,
        valid: remote.valid,
        revokedAt: remote.revokedAt,
        checkedAt: new Date().toISOString()
    };
    _memMap.set(licenseKey, entry);
    persistEntry(licenseKey, entry);
    return { refreshed: true, valid: entry.valid };
}

// ─── Ana kontrol fonksiyonu ──────────────────────────────
/**
 * Lisansın uzak sunucuda geçerli olup olmadığını kontrol eder.
 * REMOTE_URL yoksa her zaman izin verir (self-hosted mode).
 *
 * @returns {{ allowed: boolean, source: string, revokedAt?: string }}
 */
async function checkRemoteLicense(licenseKey) {
    if (!licenseKey) return { allowed: false, source: 'no-key' };

    // Uzak URL tanımlanmamışsa devre dışı — self-hosted kurulumlar için
    if (!REMOTE_URL) {
        return { allowed: true, source: 'disabled' };
    }

    // Uzak sunucuyu sorgula
    const remote = await fetchRemote(licenseKey);
    if (remote.success) {
        const entry = {
            key: licenseKey,
            valid: remote.valid,
            revokedAt: remote.revokedAt,
            checkedAt: new Date().toISOString()
        };
        _memMap.set(licenseKey, entry);
        persistEntry(licenseKey, entry);
        return { allowed: entry.valid, source: 'remote', revokedAt: entry.revokedAt };
    }

    // Uzak sunucu erişilemez — bellek önbelleğine bak
    console.warn('[RemoteValidator] Uzak sunucu erişilemez:', remote.error);
    const cached = _memMap.get(licenseKey);
    if (!cached) {
        // Önbellekte kayıt yok → erişim engellenir
        return { allowed: false, source: 'no-cache' };
    }

    const ageMs = Date.now() - new Date(cached.checkedAt).getTime();
    if (ageMs > GRACE_PERIOD_MS) {
        const hoursAgo = Math.round(ageMs / 3600000);
        console.error(`[RemoteValidator] Grace period aşıldı (${hoursAgo}s önce). Lisans engelleniyor.`);
        return { allowed: false, source: 'grace-expired', cachedAt: cached.checkedAt };
    }

    const graceLeft = Math.round((GRACE_PERIOD_MS - ageMs) / 3600000);
    return { allowed: cached.valid, source: 'cache', graceRemainingHours: graceLeft, revokedAt: cached.revokedAt };
}

/**
 * Bellek önbelleğindeki anlık durumu döndürür (async IO yok, hızlı).
 * Uzak sunucu tanımlı değilse her zaman null döner (devre dışı).
 */
function getCachedStatus(licenseKey) {
    if (!REMOTE_URL || !licenseKey) return null;
    const cached = _memMap.get(licenseKey);
    if (!cached) return { allowed: false, source: 'no-cache' };

    const ageMs = Date.now() - new Date(cached.checkedAt).getTime();
    if (ageMs > GRACE_PERIOD_MS) {
        return { allowed: false, source: 'grace-expired' };
    }
    return { allowed: cached.valid, source: 'cache', revokedAt: cached.revokedAt };
}

// ─── Arka plan yenileme ──────────────────────────────────
let _bgTimer = null;

/**
 * Aktif lisans anahtarlarını periyodik olarak uzak sunucudan yeniler.
 * server.js başlangıcında çağrılır.
 *
 * @param {() => string[]} getActiveKeys — geçerli lisans anahtarlarını döndürür
 */
function startBackgroundRefresh(getActiveKeys) {
    if (_bgTimer || !REMOTE_URL) return;

    async function run() {
        const keys = (getActiveKeys() || []).filter(Boolean);
        for (const key of keys) {
            try {
                const result = await refreshKey(key);
                if (result.refreshed && !result.valid) {
                    console.warn(`[RemoteValidator] İptal tespit edildi: ${key.slice(0, 24)}...`);
                }
            } catch (e) {
                console.error('[RemoteValidator] Yenileme hatası:', e.message);
            }
        }
    }

    // Sunucu açılışından 45 sn sonra ilk kontrol
    setTimeout(run, 45 * 1000);
    _bgTimer = setInterval(run, REFRESH_INTERVAL_MS);
    console.log(`[RemoteValidator] Arka plan yenileme başlatıldı (${REFRESH_INTERVAL_MS / 3600000}s aralık).`);
}

function stopBackgroundRefresh() {
    if (_bgTimer) { clearInterval(_bgTimer); _bgTimer = null; }
}

module.exports = {
    checkRemoteLicense,
    getCachedStatus,
    startBackgroundRefresh,
    stopBackgroundRefresh,
    refreshKey
};
