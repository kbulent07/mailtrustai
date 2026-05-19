// ============================================================
// UYGULAMA DURUMU — tek kaynak, tüm modüller bu nesneyi paylaşır
// ============================================================
const { loadScanHistory } = require('../storage/scanHistory');
const { loadSettings } = require('../storage/settingsStore');
const { getDailyCount, incrementDailyCount, todayKey } = require('../storage/dailyScansStore');
const { getMonthlyCount, incrementMonthlyCount } = require('../storage/monthlyCounter');
const { validateLicenseKey, UNLICENSED_FEATURES, UNLICENSED_MONTHLY_LIMIT } = require('../license/license');
const { getCachedStatus } = require('../license/remoteValidator');
const { loadLicenseFile } = require('../license/licenseFile');
const crypto = require('crypto');

// Yeni musteri (3-tier) lisans sistemi: license-server'dan activation ile
// gelen lisans license-client cache'inde tutulur. Eski HMAC key + .lic
// dosyasi sistemini yedek olarak biraktik, ama oncelik cloud activation.
let _licenseClient = null;
try { _licenseClient = require('@mailtrustai/license-client'); } catch (_) { /* paket yok — eski mod */ }

const persistedSettings = loadSettings();

// Değiştirilebilir in-memory state — tüm modüller aynı referansı kullanır
const state = {
    scanHistory:   loadScanHistory(),
    vtApiKey:      persistedSettings.vtApiKey      || '',
    claudeApiKey:  persistedSettings.claudeApiKey  || '',
    openaiApiKey:  persistedSettings.openaiApiKey  || '',
    openaiModel:   persistedSettings.openaiModel   || '',
    otxApiKey:     persistedSettings.otxApiKey     || '',
    customPrices:  persistedSettings.customPrices  || null
};

// ─── LİSANS KONTROL FONKSİYONLARI ───────────────────────
function checkLicense(req) {
    const fallback = {
        valid: false,
        features: { ...UNLICENSED_FEATURES },
        monthlyLimit: UNLICENSED_MONTHLY_LIMIT,
        usageScope: 'unlicensed'
    };

    // ÖNCELİK 1: license-client cache (yeni cloud activation sistemi)
    // Musteri panelinden lisans aktivasyonu yapilinca buraya yazilir.
    if (_licenseClient) {
        try {
            const snap = _licenseClient.getSnapshot();
            const grace = _licenseClient.graceCheck();
            // grace.ok true ise (online dogrulama OK ya da grace icinde) lisans gecerli
            if (snap && grace && grace.ok) {
                const features = snap.features || {};
                // Plan'a göre monthlyLimit cikar
                const monthlyLimit = (snap.limits && typeof snap.limits.monthlyScanCount === 'number')
                    ? (snap.limits.monthlyScanCount >= 9999999 ? Infinity : snap.limits.monthlyScanCount)
                    : UNLICENSED_MONTHLY_LIMIT;
                return {
                    valid: true,
                    plan: snap.plan || 'pro',
                    tier: snap.tier || null,
                    features,
                    monthlyLimit,
                    expiresAt: snap.expiresAt,
                    customerId: snap.customerId,
                    activationId: snap.activationId,
                    fromCache: !!grace.fromCache,
                    usageScope: licenseUsageScope(snap.licenseKeyHash || snap.activationId || 'cloud')
                };
            }
        } catch (e) {
            console.warn('[License] license-client kontrol hatasi:', e.message);
        }
    }

    // ÖNCELİK 2: imzalı + parmak izi bağlı .lic dosyası (eski sistem)
    const licFile = loadLicenseFile();
    if (licFile && licFile.valid) {
        return { ...licFile, usageScope: licenseUsageScope(licFile.serial || 'lic-file') };
    }

    // ÖNCELİK 3: eski HMAC anahtarı (header veya body)
    const key = req.headers['x-license-key'] || req.body?.licenseKey || '';
    if (!key) return fallback;

    const result = validateLicenseKey(key);
    if (!result.valid) return fallback;

    const remote = getCachedStatus(key);
    if (remote && !remote.allowed) {
        console.warn(`[License] Uzak önbellekte iptal/engel kaydı: ${key.slice(0, 24)}...`);
        return fallback;
    }

    return { ...result, licenseKey: key, usageScope: licenseUsageScope(key) };
}

function checkDailyLimit(license) {
    if (license.features?.dailyLimit === Infinity) return true;
    return getDailyCount(todayKey(), license.usageScope || 'unlicensed') < (license.features?.dailyLimit || 3);
}

function checkMonthlyLimit(license) {
    const limit = license.monthlyLimit ?? 30;
    if (limit === Infinity) return true;
    return getMonthlyCount(undefined, license.usageScope || 'unlicensed') < limit;
}

function incrementScanCounts(license = {}) {
    const scope = license.usageScope || 'unlicensed';
    incrementDailyCount(scope);
    incrementMonthlyCount(scope);
}

function licenseUsageScope(key) {
    return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 16);
}

module.exports = { state, checkLicense, checkDailyLimit, checkMonthlyLimit, incrementScanCounts, licenseUsageScope };
