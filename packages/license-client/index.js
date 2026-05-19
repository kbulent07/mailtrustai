'use strict';
// Customer-side license istemcisi. license-core'a (key generator/imzalama)
// HİÇBİR şekilde dependency yoktur — customer image içine sızmamalıdır.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { logger, env, envInt, APP, scrubPII, fetchJSON } = require('@mailtrustai/shared');
const { encryptJSON, decryptJSON, sha256 } = require('@mailtrustai/security');

const DATA_DIR = env('DATA_DIR', path.join(process.cwd(), 'data'));
const CACHE_PATH = path.join(DATA_DIR, 'license-cache.enc');

function _ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {} }

// ============================================================
// DEBUG LOG BUFFER — license-server iletişim sorunlarını teşhis için.
// Müşteri UI'daki "Loglar" butonu /api/customer/license/logs uçundan
// bunu çekip kullanıcıya gösterir. PII scrub'lanır, secret asla yazılmaz.
// ============================================================
const LOG_BUFFER_SIZE = envInt('MSA_LICENSE_LOG_BUFFER', 200);
const _logBuffer = [];

function _safeMeta(meta) {
    if (!meta || typeof meta !== 'object') return meta;
    try {
        // licenseKey/secret içeren alanları maskele
        const clone = JSON.parse(JSON.stringify(meta));
        const SECRET_KEYS = ['licenseKey', 'token', 'password', 'secret', 'apiKey', 'apiToken'];
        const visit = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            for (const k of Object.keys(obj)) {
                if (SECRET_KEYS.some(s => k.toLowerCase().includes(s.toLowerCase()))) {
                    if (typeof obj[k] === 'string' && obj[k].length > 8) {
                        obj[k] = obj[k].slice(0, 6) + '...' + obj[k].slice(-4);
                    } else {
                        obj[k] = '[MASKED]';
                    }
                } else if (typeof obj[k] === 'object') {
                    visit(obj[k]);
                }
            }
        };
        visit(clone);
        return scrubPII(clone);
    } catch (_) {
        return { _meta_unserializable: true };
    }
}

function _log(level, message, meta) {
    const entry = {
        ts: Date.now(),
        level,
        message: String(message),
        meta: meta !== undefined ? _safeMeta(meta) : undefined
    };
    _logBuffer.push(entry);
    while (_logBuffer.length > LOG_BUFFER_SIZE) _logBuffer.shift();

    // Server log'una da ilet (production troubleshooting için)
    const fn = logger[level] || logger.info;
    if (meta !== undefined) {
        fn(`[license-client] ${message}`, JSON.stringify(_safeMeta(meta)));
    } else {
        fn(`[license-client] ${message}`);
    }
}

function getLogs({ since = 0, level = null } = {}) {
    let out = _logBuffer.filter(e => e.ts > since);
    if (level) out = out.filter(e => e.level === level);
    return out;
}

function clearLogs() {
    const n = _logBuffer.length;
    _logBuffer.length = 0;
    _log('info', `Log buffer temizlendi (${n} kayit silindi)`);
    return n;
}

// ============================================================

function readCache() {
    try {
        if (!fs.existsSync(CACHE_PATH)) return null;
        return decryptJSON(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch (e) {
        logger.warn('license cache okunamadı:', e.message);
        _log('warn', 'Lisans cache dosyasi okunamadi', { error: e.message, path: CACHE_PATH });
        return null;
    }
}
function writeCache(obj) {
    _ensureDir();
    fs.writeFileSync(CACHE_PATH, encryptJSON(obj), { mode: 0o600 });
    _log('debug', 'Lisans cache yazildi', { customerId: obj.customerId, plan: obj.plan, tier: obj.tier });
}

function instanceFingerprint() {
    const fromEnv = env('MSA_INSTANCE_ID');
    if (fromEnv) return fromEnv;
    const cache = readCache();
    if (cache && cache.instanceId) return cache.instanceId;
    const seed = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model || '', String(os.totalmem())].join('|');
    return 'inst_' + sha256(seed).slice(0, 24);
}

async function _post(remoteUrl, pathPart, body) {
    const url = `${remoteUrl.replace(/\/+$/, '')}${pathPart}`;
    const t0 = Date.now();
    const timeoutMs = envInt('MSA_LICENSE_REMOTE_TIMEOUT_MS', 15000);

    _log('info', `POST → ${url}`, {
        url,
        timeoutMs,
        bodyKeys: body ? Object.keys(body) : []
    });

    try {
        const result = await fetchJSON(url, { method: 'POST', body, timeoutMs });
        const elapsed = Date.now() - t0;
        _log('info', `POST ← ${url} OK (${elapsed}ms)`, {
            elapsed,
            responseKeys: result && typeof result === 'object' ? Object.keys(result) : [],
            licenseStatus: result?.licenseStatus,
            plan: result?.plan,
            tier: result?.tier
        });
        return result;
    } catch (e) {
        const elapsed = Date.now() - t0;
        const errMeta = {
            url,
            elapsed,
            errorMessage: e.message,
            errorCode: e.code,
            httpStatus: e.status,
            responseBody: e.body ? (typeof e.body === 'object' ? JSON.stringify(e.body).slice(0, 500) : String(e.body).slice(0, 500)) : null
        };
        // Hata türünü insan dilinde açıkla
        let humanHint = 'Bilinmeyen hata';
        if (e.code === 'TIMEOUT') {
            humanHint = `Sunucu ${timeoutMs}ms icinde cevap vermedi (network gecikmesi / sunucu dusuk)`;
        } else if (e.code === 'BAD_URL' || e.code === 'BAD_PROTO') {
            humanHint = 'MSA_LICENSE_REMOTE_URL gecersiz veya yasak protokol (http/https olmali)';
        } else if (e.message?.includes('ENOTFOUND') || e.message?.includes('getaddrinfo')) {
            humanHint = 'DNS cozumlemesi basarisiz - URL hatali veya internet yok';
        } else if (e.message?.includes('ECONNREFUSED')) {
            humanHint = 'Baglanti reddedildi - sunucu durdurulmus veya port yanlis';
        } else if (e.message?.includes('ECONNRESET')) {
            humanHint = 'Baglanti koparildi (firewall / proxy / sunucu reset)';
        } else if (e.message?.includes('certificate') || e.message?.includes('SSL')) {
            humanHint = 'SSL/TLS sertifika hatasi - sunucu sertifikasi gecersiz';
        } else if (e.status === 401) {
            humanHint = 'Lisans anahtari sunucuda kayitli degil veya gecersiz';
        } else if (e.status === 403) {
            humanHint = 'Lisans iptal edilmis (revoked)';
        } else if (e.status === 404) {
            humanHint = `Endpoint bulunamadi (${pathPart}) - license-server surumu eski olabilir`;
        } else if (e.status === 409) {
            humanHint = 'Bu lisans baska bir cihaza kayitli - transfer onayi gerekiyor';
        } else if (e.status === 429) {
            humanHint = 'Cok fazla istek - rate limit asildi, biraz sonra deneyin';
        } else if (e.status >= 500) {
            humanHint = `Sunucu hatasi (HTTP ${e.status}) - license-server log'larini kontrol edin`;
        }
        errMeta.humanHint = humanHint;

        _log('error', `POST ✗ ${url} FAIL (${elapsed}ms): ${humanHint}`, errMeta);
        throw e;
    }
}

async function activate({ remoteUrl, licenseKey }) {
    _log('info', 'activate() basladi', {
        remoteUrlSet: !!remoteUrl,
        licenseKeyLength: licenseKey?.length,
        remoteHost: (() => { try { return new URL(remoteUrl).host; } catch (_) { return null; } })()
    });

    if (!remoteUrl) {
        _log('error', 'activate() iptal: MSA_LICENSE_REMOTE_URL tanimli degil');
        throw new Error('MSA_LICENSE_REMOTE_URL tanimli degil');
    }
    if (!licenseKey) {
        _log('error', 'activate() iptal: licenseKey eksik');
        throw new Error('licenseKey gerekli');
    }

    const instanceId = instanceFingerprint();
    _log('debug', 'Instance fingerprint hesaplandi', { instanceId });

    const r = await _post(remoteUrl, '/api/license/activate', {
        licenseKey,
        instanceId,
        appVersion: APP.VERSION,
        buildVersion: APP.BUILD,
        nodeVersion: process.versions.node,
        environment: env('NODE_ENV', 'production'),
        hostnameHash: sha256(os.hostname())
    });
    const cache = {
        instanceId,
        licenseKeyHash: sha256(licenseKey),
        activationId: r.activationId,
        customerId: r.customerId,
        dealerId: r.dealerId,
        plan: r.plan,
        tier: r.tier,
        features: r.features || {},
        limits: r.limits || {},
        expiresAt: r.expiresAt,
        graceDays: r.graceDays || 1,
        // Sunucu admin'i tarafından set edilmiş offline çalışma izni (gün).
        // graceCheck() bu varsa graceDays yerine kullanır → uzun süre offline çalışabilir.
        offlineGraceDaysOverride: (typeof r.offlineGraceDaysOverride === 'number' && r.offlineGraceDaysOverride >= 0)
            ? r.offlineGraceDaysOverride : null,
        licenseStatus: r.licenseStatus || 'active',
        lastValidatedAt: Date.now(),
        lastValidationOk: true
    };
    writeCache(cache);
    _log('info', 'activate() basarili — lisans aktif', {
        customerId: cache.customerId,
        plan: cache.plan,
        tier: cache.tier,
        status: cache.licenseStatus,
        expiresAt: cache.expiresAt
    });
    return cache;
}

async function validate({ remoteUrl, licenseKey }) {
    _log('info', 'validate() basladi', {
        remoteUrlSet: !!remoteUrl,
        licenseKeySet: !!licenseKey
    });
    try {
        const r = await _post(remoteUrl, '/api/license/validate', {
            licenseKeyHash: sha256(licenseKey),
            instanceId: instanceFingerprint()
        });
        const prev = readCache() || {};
        const next = { ...prev, ...r, lastValidatedAt: Date.now(), lastValidationOk: true };
        writeCache(next);
        _log('info', 'validate() basarili', { status: r.licenseStatus });
        return { ok: true, status: r.licenseStatus, fromCache: false };
    } catch (e) {
        logger.warn('validate başarısız, grace kontrolüne düşülüyor:', e.message);
        _log('warn', 'validate() basarisiz — grace kontrolune dusuyor', { error: e.message });
        return graceCheck();
    }
}

function graceCheck() {
    const cache = readCache();
    if (!cache) {
        _log('warn', 'graceCheck: cache yok (henuz hic aktivasyon yapilmamis)');
        return { ok: false, status: 'unlicensed', fromCache: false };
    }
    // Sunucu admin override'ı varsa graceDays yerine onu kullan (uzun offline mod).
    const days = (typeof cache.offlineGraceDaysOverride === 'number' && cache.offlineGraceDaysOverride >= 0)
        ? cache.offlineGraceDaysOverride
        : (cache.graceDays || 1);
    const ageMs = Date.now() - (cache.lastValidatedAt || 0);
    const limitMs = days * 24 * 60 * 60 * 1000;
    if (ageMs <= limitMs) {
        _log('info', `graceCheck: cache gecerli (kalan ${Math.floor((limitMs - ageMs) / 86400000)} gun)`, {
            graceDays: days,
            ageMinutes: Math.floor(ageMs / 60000)
        });
        return {
            ok: true,
            status: cache.licenseStatus || 'active',
            fromCache: true,
            graceRemainingMs: limitMs - ageMs,
            // Hangi grace kullanılıyor görünür olsun (debug / panel feedback)
            graceSource: (cache.offlineGraceDaysOverride != null) ? 'admin-override' : 'plan-default'
        };
    }
    _log('error', `graceCheck: cache eski (${Math.floor(ageMs / 86400000)} gun) — grace doldu`);
    return { ok: false, status: 'grace_expired', fromCache: true };
}

function featureEnabled(feature) {
    const c = readCache();
    if (!c || !c.features) return false;
    return !!c.features[feature];
}

function getSnapshot() {
    const c = readCache();
    if (!c) return null;
    // Sızıntıya karşı PII scrub'lı snapshot
    return scrubPII({
        licenseStatus: c.licenseStatus, plan: c.plan, tier: c.tier,
        features: c.features, limits: c.limits || {},
        expiresAt: c.expiresAt,
        customerId: c.customerId, dealerId: c.dealerId,
        instanceId: c.instanceId, activationId: c.activationId,
        licenseKeyHash: c.licenseKeyHash
    });
}

// İlk yüklemede çevresel bilgi dökümü — sunucu ayarları yanlış girilmişse
// görmek için. URL'den sadece host kısmı loglanır (path/query gizli kalır).
(function _bootLog() {
    let host = null;
    const url = env('MSA_LICENSE_REMOTE_URL');
    if (url) { try { host = new URL(url).host; } catch (_) { host = '[invalid-url]'; } }
    _log('info', 'license-client modulu yuklendi', {
        remoteUrlSet: !!url,
        remoteHost: host,
        centralSyncUrl: !!env('MSA_CENTRAL_SYNC_URL'),
        timeoutMs: envInt('MSA_LICENSE_REMOTE_TIMEOUT_MS', 15000),
        instanceId: instanceFingerprint(),
        hostname: os.hostname()
    });
})();

module.exports = {
    activate, validate, graceCheck, featureEnabled, instanceFingerprint,
    getSnapshot, readCache, writeCache,
    // Yeni: log buffer API
    getLogs, clearLogs
};
