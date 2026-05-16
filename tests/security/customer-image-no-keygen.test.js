'use strict';
// Kaynak repo (mainpaketler branch'i) içinde DEĞİL, ama customer Dockerfile
// build adımının yasak dosyaları sildiğini doğrularız: scripts/check-customer-package.js
// çıktısının repo kökünde (silinmemiş) BAŞARISIZ döndüğünü, ardından
// gerekli dosyaları geçici bir staging'e taşıyıp tekrar çalıştırdığımızda
// BAŞARILI döndüğünü test ederiz.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function runCheck(cwd) {
    return spawnSync(process.execPath, [path.resolve(__dirname, '..', '..', 'scripts', 'check-customer-package.js')], { cwd, encoding: 'utf8' });
}

test('repo kökünde check-customer-package FAIL döner (yasak dosyalar mevcut)', () => {
    const r = runCheck(path.resolve(__dirname, '..', '..'));
    assert.notStrictEqual(r.status, 0, 'kök repoda yasak dosyalar olduğundan exit 0 OLMAMALI');
});

test('temizlenmiş staging\'de check-customer-package PASS döner', () => {
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
    copy(path.join(root, 'apps', 'customer'), path.join(stage, 'apps', 'customer'));
    copy(path.join(root, 'packages'),         path.join(stage, 'packages'));
    copy(path.join(root, 'src'),              path.join(stage, 'src'));
    copy(path.join(root, 'public'),           path.join(stage, 'public'));
    copy(path.join(root, 'scripts'),          path.join(stage, 'scripts'));
    copy(path.join(root, 'docs'),             path.join(stage, 'docs'));

    // Customer-only image gibi temizle (Dockerfile ile aynı)
    const rm = (p) => { try { fs.rmSync(path.join(stage, p), { recursive: true, force: true }); } catch (_) {} };
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
    rm('src/middleware/adminAuth.js');
    rm('src/utils/dealerLock.js');
    rm('public/bayi.html');
    rm('public/keygen.html');
    rm('public/js/bayi-app.js');

    const r = runCheck(stage);
    assert.strictEqual(r.status, 0, `temizlenmiş stage'de PASS olmalı; çıktı:\n${r.stdout}\n${r.stderr}`);
});
