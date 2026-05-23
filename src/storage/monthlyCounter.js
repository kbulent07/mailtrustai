// ============================================================
// MONTHLY SCAN COUNTER — HMAC korumalı (tamper-resistant)
//
// HMAC imzalı JSON dosyası. Doğrulama başarısız olursa (örn. secret değişikliği,
// kod güncellemesi sonrası stableStringify değişimi, harici tamper):
//   • Eski veriyi KAYBETME — yedekle ve mevcut sayaçları koru
//   • Yeni HMAC ile yeniden imzala (idempotent recovery)
//   • Audit log'a + 1 kez warn (boot spam yok)
//   • Module-level cache: aynı process içinde tekrar tekrar dosya okumaz
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { requireSecret } = require('@mailtrustai/shared');

const COUNTER_FILE = path.join(__dirname, '..', '..', 'data', 'monthly-counts.json');
const HMAC_SECRET = requireSecret('MSA_LICENSE_SECRET', { devFallback: 'MSA_SECRET_2024_K3Y!@#' });

// In-memory cache — dosyayı her çağrıda re-read etmez. saveCounts() günceller.
// Process restart'ında sıfırlanır (ilk load disk'ten yapılır).
let _cache = null;
let _hmacFailWarned = false;  // boot spam koruması

function computeHmac(dataObj) {
    // Yalnızca sayım verilerini (underscore ile başlamayan anahtarlar) imzala
    const filtered = Object.fromEntries(
        Object.entries(dataObj).filter(([k]) => !k.startsWith('_'))
    );
    const content = stableStringify(filtered);
    return crypto.createHmac('sha256', HMAC_SECRET).update(content).digest('hex').substring(0, 24);
}

function stableStringify(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function getCurrentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * HMAC mismatch durumunda:
 *   1) Eski dosyayı yedekle (forensic — tampering veya secret rotation tespiti)
 *   2) Veriyi koru (mali risk: kullanıcı kotasını sıfırlama!)
 *   3) Yeni HMAC ile yeniden yaz (idempotent — bir daha tetiklenmez)
 *   4) Audit log + warn 1 kez
 */
function _recoverTamperedCounter(raw, dataWithoutMeta) {
    if (!_hmacFailWarned) {
        console.warn(
            '[Counter] HMAC uyumsuzluğu tespit edildi — veri KORUNUYOR, yeni imza ile yeniden yazılıyor. ' +
            'Olası sebep: secret rotasyonu, kod güncellemesi (stableStringify değişimi), veya harici dosya değişikliği. ' +
            'Yedek: monthly-counts.tampered-<timestamp>.json'
        );
        _hmacFailWarned = true;
    }

    // Yedekle (her çağrı için değil; sadece dosya hâlâ tampered durumdaysa)
    try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = COUNTER_FILE.replace(/\.json$/, `.tampered-${ts}.json`);
        if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, JSON.stringify(raw, null, 2), 'utf8');
        }
    } catch (_) { /* yedek başarısız olursa pas geç — asıl veri koruma kritik */ }

    // Audit (best-effort — auditLog modülü import dairesi yaratmasın)
    try {
        const { recordAudit } = require('./auditLog');
        if (typeof recordAudit === 'function') {
            recordAudit({
                actorType: 'system',
                actorId:   'monthly-counter',
                action:    'counter.hmac.mismatch.recovered',
                details:   {
                    file:       COUNTER_FILE,
                    monthCount: Object.keys(dataWithoutMeta).length,
                    storedHmac: raw._hmac ? String(raw._hmac).slice(0, 8) + '…' : null
                }
            });
        }
    } catch (_) { /* audit yoksa pas geç */ }

    // Veriyi koru — yeni HMAC ile yeniden imzala
    try {
        const withHmac = {
            ...dataWithoutMeta,
            _hmac:      computeHmac(dataWithoutMeta),
            _savedAt:   new Date().toISOString(),
            _recovered: true,
            _recoveredAt: new Date().toISOString()
        };
        fs.writeFileSync(COUNTER_FILE, JSON.stringify(withHmac, null, 2), 'utf8');
    } catch (e) {
        console.error('[Counter] Recovery yazımı başarısız:', e.message);
    }

    return dataWithoutMeta;
}

function loadCounts() {
    // In-memory cache hit — disk'i tekrar okuma (boot spam ortadan kalkar)
    if (_cache !== null) return _cache;

    try {
        if (!fs.existsSync(COUNTER_FILE)) {
            _cache = {};
            return _cache;
        }
        const raw = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8') || '{}');

        const storedHmac = raw._hmac;
        const dataWithoutMeta = Object.fromEntries(
            Object.entries(raw).filter(([k]) => !k.startsWith('_'))
        );

        if (storedHmac) {
            const expectedHmac = computeHmac(dataWithoutMeta);
            if (storedHmac !== expectedHmac) {
                // ESKİ DAVRANIŞ: return {} — sayacı sıfırlardı (VERİ KAYBI!)
                // YENİ DAVRANIŞ: veriyi koru + yedek + yeniden imzala
                _cache = _recoverTamperedCounter(raw, dataWithoutMeta);
                return _cache;
            }
        }

        _cache = dataWithoutMeta;
        return _cache;
    } catch (e) {
        // JSON parse hatası vb. — tamamen bozuk dosya. Sıfırlamadan önce yedekle.
        try {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = COUNTER_FILE.replace(/\.json$/, `.corrupt-${ts}.json`);
            if (fs.existsSync(COUNTER_FILE) && !fs.existsSync(backupPath)) {
                fs.copyFileSync(COUNTER_FILE, backupPath);
            }
        } catch (_) {}
        console.error('[Counter] Sayaç dosyası bozuk, yedeklendi ve sıfırlanıyor:', e.message);
        _cache = {};
        return _cache;
    }
}

function saveCounts(data) {
    const dir = path.dirname(COUNTER_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const withHmac = { ...data, _hmac: computeHmac(data), _savedAt: new Date().toISOString() };
    fs.writeFileSync(COUNTER_FILE, JSON.stringify(withHmac, null, 2), 'utf8');
    // Cache güncelle — sonraki load disk'e gitmez
    _cache = { ...data };
}

/**
 * Test/debug için cache'i temizle. Production kodu kullanmaz.
 */
function _resetCache() {
    _cache = null;
    _hmacFailWarned = false;
}

function getMonthlyCount(monthKey, scope = 'global') {
    const key = monthKey || getCurrentMonthKey();
    const value = loadCounts()[key];
    if (typeof value === 'number') return scope === 'global' ? value : 0;
    if (scope === 'global') return Object.values(value || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    return value?.[scope] || 0;
}

function incrementMonthlyCount(scope = 'global') {
    const counts = loadCounts();
    const key = getCurrentMonthKey();
    const current = typeof counts[key] === 'object' && counts[key] !== null ? counts[key] : {};
    current[scope] = (current[scope] || 0) + 1;
    counts[key] = current;

    // 13 aydan eski kayıtları temizle
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 13);
    for (const k of Object.keys(counts)) {
        const [y, m] = k.split('-').map(Number);
        if (new Date(y, m - 1) < cutoff) delete counts[k];
    }

    saveCounts(counts);
    return current[scope];
}

function resetMonthlyCount(monthKey) {
    const counts = loadCounts();
    const key = monthKey || getCurrentMonthKey();
    counts[key] = 0;
    saveCounts(counts);
}

module.exports = {
    getCurrentMonthKey, getMonthlyCount, incrementMonthlyCount, resetMonthlyCount,
    // Test-only
    _resetCache, _COUNTER_FILE: COUNTER_FILE
};
