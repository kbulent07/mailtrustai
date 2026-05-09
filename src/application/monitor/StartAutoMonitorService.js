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

function _resolveLicense(licenseKey) {
    if (!licenseKey) return { valid: false, features: { ...UNLICENSED_FEATURES } };
    const result = validateLicenseKey(licenseKey);
    if (!result.valid) return { valid: false, features: { ...UNLICENSED_FEATURES } };
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
