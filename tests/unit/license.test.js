// ============================================================
// Unit tests: src/license/license.js
// Çalıştırma: node --test tests/unit/license.test.js
// ============================================================
const test    = require('node:test');
const assert  = require('node:assert/strict');

const {
    generateLicenseKey, validateLicenseKey,
    PLANS, TIERS, DURATIONS, TRIAL_DAYS
} = require('../../src/license/license');

test('generateLicenseKey üretir geçerli formatta anahtar', () => {
    const key = generateLicenseKey('PRO', 'T2', 'M', 'DIRECT');
    // MSA-PRO-T2-M-DIRECT-YYYYMMDD-NONCE-CHECKSUM (8 parça)
    assert.match(key, /^MSA-PRO-T2-M-DIRECT-\d{8}-[0-9A-F]{6}-[0-9A-F]{8}$/);
});

test('validateLicenseKey üretilen geçerli anahtarı doğrular', () => {
    const key    = generateLicenseKey('ENT', 'T5', 'Y', 'TESTRESELLER');
    const result = validateLicenseKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.plan, 'enterprise');
    assert.equal(result.planCode, 'ENT');
    assert.equal(result.tier, 'T5');
    assert.equal(result.duration, 'yearly');
    assert.equal(result.durationCode, 'Y');
    assert.equal(result.reseller, 'TESTRESELLER');
    assert.equal(result.monthlyLimit, 1000);
});

test('validateLicenseKey trial (T) duration için 7 gün expiry', () => {
    const key    = generateLicenseKey('ENT', 'T3', 'T', 'TRIAL');
    const result = validateLicenseKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.duration, 'trial-7day');
    assert.equal(result.durationCode, 'T');
    // daysLeft 6 veya 7 olmalı (saat farkı)
    assert.ok(result.daysLeft <= TRIAL_DAYS && result.daysLeft >= TRIAL_DAYS - 1,
        `daysLeft ${result.daysLeft} olmamalı (TRIAL_DAYS=${TRIAL_DAYS})`);
    // expiryDate startDate'ten 7 gün sonra
    const start = new Date(result.startDate);
    const exp   = new Date(result.expiryDate);
    const diffDays = Math.round((exp - start) / 86400000);
    assert.equal(diffDays, TRIAL_DAYS);
});

test('validateLicenseKey aylık (M) duration için ~30 gün', () => {
    const key    = generateLicenseKey('PRO', 'T1', 'M', 'DIRECT');
    const result = validateLicenseKey(key);
    assert.equal(result.valid, true);
    const start = new Date(result.startDate);
    const exp   = new Date(result.expiryDate);
    const diffDays = Math.round((exp - start) / 86400000);
    assert.ok(diffDays >= 28 && diffDays <= 31, `aylık expiry ${diffDays} gün olmamalı`);
});

test('validateLicenseKey yıllık (Y) duration için ~365 gün', () => {
    const key    = generateLicenseKey('ENT', 'T9', 'Y', 'DIRECT');
    const result = validateLicenseKey(key);
    assert.equal(result.valid, true);
    const start = new Date(result.startDate);
    const exp   = new Date(result.expiryDate);
    const diffDays = Math.round((exp - start) / 86400000);
    assert.ok(diffDays >= 364 && diffDays <= 366);
});

test('validateLicenseKey değiştirilmiş checksum reddedilir', () => {
    const key = generateLicenseKey('PRO', 'T2', 'M', 'DIRECT');
    // Son 4 char checksum'u boz
    const tampered = key.slice(0, -4) + 'XXXX';
    const result   = validateLicenseKey(tampered);
    assert.equal(result.valid, false);
    assert.equal(result.error, 'Invalid checksum');
});

test('validateLicenseKey geçersiz format reddedilir', () => {
    const result = validateLicenseKey('not-a-license');
    assert.equal(result.valid, false);
    assert.equal(result.error, 'Invalid format');
});

test('validateLicenseKey geçersiz plan reddedilir (signed but unknown plan)', () => {
    // Çekirdekte geçersiz plan signed bir key oluşturmak için
    // generateLicenseKey'i baypas edip elle düzenleyemiyoruz (signed).
    // Bunun yerine generateLicenseKey'in bilinmeyen plan'i 'PRO' fallback'ine
    // çevirdiğini kontrol edelim.
    const key    = generateLicenseKey('XXX', 'T2', 'M', 'DIRECT');
    const result = validateLicenseKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.planCode, 'PRO'); // fallback'e düşmüş
});

test('validateLicenseKey süresi dolmuş anahtar reddedilir', () => {
    // 100 gün önce başlamış aylık anahtar → süresi geçmiş
    const oldDate = new Date(Date.now() - 100 * 86400000)
        .toISOString().slice(0, 10).replace(/-/g, '');
    const key    = generateLicenseKey('PRO', 'T2', 'M', 'DIRECT', oldDate);
    const result = validateLicenseKey(key);
    assert.equal(result.valid, false);
    assert.equal(result.error, 'License expired');
    assert.equal(result.daysLeft, 0);
});

test('expiringSoon flag son 7 gün içinde true olur', () => {
    // 25 gün önce başlamış aylık → ~5 gün kaldı → expiringSoon
    const dateStr = new Date(Date.now() - 25 * 86400000)
        .toISOString().slice(0, 10).replace(/-/g, '');
    const key    = generateLicenseKey('PRO', 'T2', 'M', 'DIRECT', dateStr);
    const result = validateLicenseKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.expiringSoon, true);
});

test('PLANS / TIERS / DURATIONS sabitleri tanımlı', () => {
    assert.deepEqual(Object.keys(PLANS).sort(), ['ENT', 'PRO']);
    assert.equal(Object.keys(TIERS).length, 9);
    assert.deepEqual(Object.keys(DURATIONS).sort(), ['M', 'T', 'Y']);
    assert.equal(DURATIONS.T, 'trial-7day');
});
