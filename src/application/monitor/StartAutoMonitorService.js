// ============================================================
// USE-CASE: WebSocket "start-monitor" mesajı için orchestration
//   • Lisans doğrulaması
//   • IMAP hesabı bulma
//   • monitor instance başlatma (caller tarafından sağlanan factory)
//   • autoMonitor kaydı
//
// WS handler bu fonksiyonu çağırır ve broadcast'i kendisi yapar.
// ============================================================
const { loadCredentials } = require('../../imap/connection');
const { addAutoMonitor } = require('../../storage/autoMonitorState');
const { validateLicenseKey, UNLICENSED_FEATURES } = require('../../license/license');
const { loadLicenseFile } = require('../../license/licenseFile');

let _licenseClient = null;
try { _licenseClient = require('@mailtrustai/license-client'); } catch (_) {}

// checkLicense(req) ile aynı öncelik sırası: cloud cache → .lic → HMAC key
function _resolveLicense(licenseKey) {
    const fallback = { valid: false, features: { ...UNLICENSED_FEATURES } };

    // Öncelik 1: license-client cloud activation cache
    if (_licenseClient) {
        try {
            const snap = _licenseClient.getSnapshot();
            const grace = _licenseClient.graceCheck();
            if (snap && grace && grace.ok) {
                const features = { ...(snap.features || {}) };
                if (snap.plan === 'pro' || snap.plan === 'enterprise') features.scanMailbox = true;
                if (snap.plan === 'enterprise') { features.autoMonitor = true; features.realtimeAlert = true; }
                return { valid: true, plan: snap.plan || 'pro', tier: snap.tier || null, features };
            }
        } catch (_) {}
    }

    // Öncelik 2: .lic dosyası
    const licFile = loadLicenseFile();
    if (licFile && licFile.valid) return licFile;

    // Öncelik 3: eski HMAC key
    if (!licenseKey) return fallback;
    const result = validateLicenseKey(licenseKey);
    if (!result.valid) return fallback;
    return result;
}

/**
 * @param {object} args
 * @param {string} args.email
 * @param {string} args.licenseKey
 * @param {(account:object, license:object) => Promise<any>} args.startMonitorForAccount
 * @returns Promise<{ email:string, license:object }>
 * @throws Error mesajı (WS layer JSON ile gönderir)
 */
async function startAutoMonitor({ email, licenseKey, startMonitorForAccount }) {
    const license = _resolveLicense(licenseKey);
    if (!license.features?.autoMonitor) {
        throw new Error('Otomatik izleme Enterprise lisansı gerektirir');
    }
    if (!email) {
        throw new Error('İzleme için e-posta adresi gerekli');
    }

    const account = loadCredentials().find(entry => entry.email === email);
    if (!account) {
        throw new Error('Kayıtlı IMAP hesabı bulunamadı');
    }

    await startMonitorForAccount(account, license);
    addAutoMonitor(account.email, licenseKey);

    return { email: account.email, license };
}

module.exports = { startAutoMonitor };
