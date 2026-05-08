// ============================================================
// UYGULAMA DURUMU — tek kaynak, tüm modüller bu nesneyi paylaşır
// ============================================================
const { loadScanHistory } = require('../storage/scanHistory');
const { loadSettings } = require('../storage/settingsStore');
const { getDailyCount, incrementDailyCount, todayKey } = require('../storage/dailyScansStore');
const { getMonthlyCount, incrementMonthlyCount } = require('../storage/monthlyCounter');
const { validateLicenseKey, UNLICENSED_FEATURES, UNLICENSED_MONTHLY_LIMIT } = require('../license/license');
const { getCachedStatus } = require('../license/remoteValidator');

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
    const key = req.headers['x-license-key'] || req.body?.licenseKey || '';
    const fallback = { valid: false, features: { ...UNLICENSED_FEATURES }, monthlyLimit: UNLICENSED_MONTHLY_LIMIT };
    if (!key) return fallback;

    const result = validateLicenseKey(key);
    if (!result.valid) return fallback;

    const remote = getCachedStatus(key);
    if (remote && !remote.allowed) {
        console.warn(`[License] Uzak önbellekte iptal/engel kaydı: ${key.slice(0, 24)}...`);
        return fallback;
    }

    return result;
}

function checkDailyLimit(license) {
    if (license.features?.dailyLimit === Infinity) return true;
    return getDailyCount(todayKey()) < (license.features?.dailyLimit || 3);
}

function checkMonthlyLimit(license) {
    const limit = license.monthlyLimit ?? 30;
    if (limit === Infinity) return true;
    return getMonthlyCount() < limit;
}

function incrementScanCounts() {
    incrementDailyCount();
    incrementMonthlyCount();
}

module.exports = { state, checkLicense, checkDailyLimit, checkMonthlyLimit, incrementScanCounts };
