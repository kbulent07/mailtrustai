'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Bu test: license-generator.js dosyası VAR ve generateLicenseKey çalışır.
// Customer image'de bu dosya silinir → lazy-require başarısız olur.
test('license-generator.js generateLicenseKey + generateBatchKeys döner', () => {
    const gen = require(path.resolve(__dirname, '..', '..', 'src', 'license', 'license-generator'));
    const key = gen.generateLicenseKey('PRO', 'T3', 'M', 'ACME');
    assert.match(key, /^MSA-PRO-T3-M-ACME-\d{8}-[A-F0-9]{6}-[A-F0-9]{8}$/);
    const batch = gen.generateBatchKeys('ENT', 'T5', 'Y', 3, 'BIG');
    assert.strictEqual(batch.length, 3);
    batch.forEach(k => assert.match(k, /^MSA-ENT-T5-Y-BIG-\d{8}-[A-F0-9]{6}-[A-F0-9]{8}$/));
});

test('license.js shim generator yokken çağrılırsa MODULE_NOT_FOUND', () => {
    // Bu davranış customer image'de gerçekleşir. Burada simüle edemiyoruz
    // çünkü gerçek dosya mevcut. Sadece shim'in lazy-require yaptığını doğrula:
    const src = require('fs').readFileSync(
        path.resolve(__dirname, '..', '..', 'src', 'license', 'license.js'), 'utf8');
    assert.ok(/require\(['"]\.\/license-generator['"]\)/.test(src),
        'license.js generator için lazy-require shim içermeli');
});
