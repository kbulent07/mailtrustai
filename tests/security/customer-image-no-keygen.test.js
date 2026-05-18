'use strict';
// Customer image gate testi:
// - Geçici staged tree PRUNE edilmeden check FAIL olmalı.
// - Aynı staged tree customer-image temizliği uygulandıktan sonra check PASS olmalı.
// Böylece repo kökünde legacy dosyalar kalsa da kalmasa da test deterministik kalır.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// `--scope=image` modunda calistiriyoruz (Dockerfile build asamasinda
// kullanilan asil mod). Bu mod FORBIDDEN_PATHS_IMAGE yollarinin
// varligini kontrol eder; staged tree'de bu yollar varsa FAIL beklenir.
function runCheck(cwd) {
    return spawnSync(
        process.execPath,
        [path.resolve(__dirname, '..', '..', 'scripts', 'check-customer-package.js'), '--scope=image'],
        { cwd, encoding: 'utf8', env: { ...process.env, MSA_CUSTOMER_BUILD: '1' } }
    );
}

test('staging prune oncesi FAIL, prune sonrasi PASS', () => {
    const root = path.resolve(__dirname, '..', '..');
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-customer-stage-'));
    // Sadece customer'a gerekli alt ağacı kopyala
    const copy = (src, dst) => {
        if (!fs.existsSync(src)) return;
        const st = fs.statSync(src);
        if (st.isDirectory()) {
            fs.mkdirSync(dst, { recursive: true });
            for (const e of fs.readdirSync(src)) copy(path.join(src, e), path.join(dst, e));
        } else fs.copyFileSync(src, dst);
    };
    copy(path.join(root, 'apps', 'customer'),       path.join(stage, 'apps', 'customer'));
    // Dealer ve license-server'i bilerek STAGE'e KOPYALIYORUZ — gercek build
    // oncesi durumu simule eder (apps/customer/Dockerfile bunlari siler).
    copy(path.join(root, 'apps', 'dealer'),         path.join(stage, 'apps', 'dealer'));
    copy(path.join(root, 'apps', 'license-server'), path.join(stage, 'apps', 'license-server'));
    copy(path.join(root, 'packages'),               path.join(stage, 'packages'));
    copy(path.join(root, 'src'),                    path.join(stage, 'src'));
    copy(path.join(root, 'public'),                 path.join(stage, 'public'));
    copy(path.join(root, 'scripts'),                path.join(stage, 'scripts'));
    copy(path.join(root, 'docs'),                   path.join(stage, 'docs'));

    const before = runCheck(stage);
    assert.notStrictEqual(before.status, 0, 'prune oncesi staged tree FAIL olmali');

    // Customer-only image gibi temizle (Dockerfile ile aynı)
    const rm = (p) => { try { fs.rmSync(path.join(stage, p), { recursive: true, force: true }); } catch (_) {} };
    rm('apps/dealer');
    rm('apps/license-server');
    rm('packages/license-core');
    rm('src/license/keygenTool.js');
    rm('src/license/license-generator.js');
    rm('src/routes/dealerApi.js');
    rm('src/interfaces/http/routes/resellers.routes.js');
    rm('src/interfaces/http/routes/admin.routes.js');
    rm('src/storage/dealerStore.js');
    rm('src/storage/dealerCustomerStore.js');
    rm('src/storage/dealerSales.js');
    rm('src/storage/resellerStore.js');
    rm('src/storage/issuedLicenseStore.js');
    rm('src/storage/creditTransactionStore.js');
    // src/middleware/adminAuth.js KORUNUR (customer.routes.js bagimliligi —
    // /customer/reset endpoint'i); HARD-GATE /api/admin path'lerini zaten 404'ler.
    rm('src/utils/dealerLock.js');
    rm('public/bayi.html');
    rm('public/keygen.html');
    rm('public/js/bayi-app.js');

    const r = runCheck(stage);
    assert.strictEqual(r.status, 0, `temizlenmiş stage'de PASS olmalı; çıktı:\n${r.stdout}\n${r.stderr}`);
});
