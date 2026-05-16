// ============================================================
// LICENSE GENERATOR — SADECE license-server / dealer tarafında.
// CUSTOMER DOCKER IMAGE'I BU DOSYAYI İÇERMEZ.
// (apps/customer/Dockerfile build adımında siler;
//  scripts/check-customer-package.js fiziksel varlığı doğrular.)
// ============================================================
const crypto = require('crypto');

let SECRET_KEY = process.env.MSA_LICENSE_SECRET;
if (!SECRET_KEY) {
    if (process.env.NODE_ENV === 'production') {
        console.error('[license-generator] FATAL: MSA_LICENSE_SECRET tanımlı değil.');
        process.exit(1);
    }
    SECRET_KEY = 'MSA_SECRET_2024_K3Y!@#';
}

function _checksum(data) {
    return crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex').substring(0, 8).toUpperCase();
}

function generateLicenseKey(plan, tier, duration, resellerCode = 'DIRECT', startDate = null) {
    if (!['PRO', 'ENT'].includes(plan)) plan = 'PRO';
    const validTiers = ['T1','T2','T3','T4','T5','T6','T7','T8','T9'];
    if (!validTiers.includes(tier)) tier = 'T1';
    if (!['M', 'Y', 'T'].includes(duration)) duration = 'M';
    const start = startDate || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const nonce = crypto.randomBytes(3).toString('hex').toUpperCase();
    const payload = `MSA-${plan}-${tier}-${duration}-${resellerCode}-${start}-${nonce}`;
    return `${payload}-${_checksum(payload)}`;
}

function generateBatchKeys(plan, tier, duration, count, resellerCode = 'DIRECT') {
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(generateLicenseKey(plan, tier, duration, resellerCode));
    return keys;
}

module.exports = { generateLicenseKey, generateBatchKeys };
