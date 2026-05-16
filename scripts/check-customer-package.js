#!/usr/bin/env node
'use strict';
/**
 * Customer paketinde olmaması gereken dosya ve kelimeleri tarar.
 * - Dockerfile build adımının sonunda çalıştırılır → build başarısız olur.
 * - npm run check:customer-package ile lokal repoda da çalıştırılabilir
 *   (lokal repoda yasak dosyalar VARDIR; --scope=image flag'i ile sadece
 *   image içeriğini taramaya zorlayın veya FORBIDDEN_PATHS'i ayarlayın).
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

// 1) Fiziksel olarak BULUNMAMASI gereken dosya ve klasörler
const FORBIDDEN_PATHS = [
    'apps/dealer',
    'apps/license-server',
    'packages/license-core',
    'src/license/keygenTool.js',
    'src/routes/dealerApi.js',
    'src/interfaces/http/routes/license.routes.js',
    'src/interfaces/http/routes/resellers.routes.js',
    'src/interfaces/http/routes/admin.routes.js',
    'src/storage/dealerStore.js',
    'src/storage/dealerCustomerStore.js',
    'src/storage/dealerSales.js',
    'src/storage/resellerStore.js',
    'src/storage/issuedLicenseStore.js',
    'src/storage/creditTransactionStore.js',
    'src/middleware/adminAuth.js',
    'src/utils/dealerLock.js',
    'public/keygen.html',
    'public/bayi.html'
];

// 2) İçerikte aranan yasak desenler (taranan dizinler)
const SCAN_DIRS = ['apps/customer', 'packages', 'src', 'public'];
const FORBIDDEN_PATTERNS = [
    { rx: /generateLicenseKey\s*\(/, msg: 'license key generator çağrısı' },
    { rx: /signActivation\s*\(/,     msg: 'lisans imzalama (license-core) çağrısı' },
    { rx: /batch.{0,12}license/i,    msg: 'batch license' },
    { rx: /trial.{0,12}license/i,    msg: 'trial license' },
    { rx: /dealer.{0,8}credit/i,     msg: 'dealer credit' },
    { rx: /customer\s*list\s*admin/i,msg: 'customer list admin' }
];

// 3) Allowlist — yanlış pozitif olmaması için
//
// - apps/customer/server.js: BLOCKED listesinde '/api/license/batch' string'i geçer.
// - src/storage/db.js: 'dealer_credit' kolon adı; dealer-credit business logic değil.
// - src/license/license.js: customer için validateLicenseKey gerekli; generateLicenseKey
//   export edilir ama runtime'da customer kodundan çağrılmaz. TODO v2.1: license.js'i
//   license-validate.js + license-generator.js olarak böl (license-generator
//   yalnızca license-server'da kalır).
const ALLOWLIST_FILES = new Set([
    'scripts/check-customer-package.js',
    'docs/SECURITY-MODEL.md',
    'docs/RELEASE.md',
    'docs/CUSTOMER-INSTALL.md',
    'docs/ARCHITECTURE.md',
    'docs/CENTRAL-SERVER-INSTALL.md',
    'docs/LICENSE-FLOW.md',
    'docs/CENTRAL-LISTS.md',
    'docs/CENTRAL-SYNC-FLOW.md',
    'docs/API-POLICY.md',
    'apps/customer/server.js',
    'src/storage/db.js',
    'src/license/license.js'
]);

const errors = [];

// Faz 1: yasak path'ler
for (const p of FORBIDDEN_PATHS) {
    const abs = path.join(ROOT, p);
    if (fs.existsSync(abs)) errors.push(`[FORBIDDEN-PATH] ${p} customer image içinde olmamalı`);
}

// Faz 2: içerik tarama
function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (['node_modules', '.git', 'data', 'logs'].includes(ent.name)) continue;
            walk(full, out);
        } else if (/\.(js|mjs|cjs|json|html|md)$/.test(ent.name)) {
            out.push(full);
        }
    }
    return out;
}

for (const d of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, d))) {
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        if (ALLOWLIST_FILES.has(rel)) continue;
        const text = fs.readFileSync(file, 'utf8');
        for (const { rx, msg } of FORBIDDEN_PATTERNS) {
            if (rx.test(text)) errors.push(`[FORBIDDEN-PATTERN] ${rel}: ${msg}`);
        }
    }
}

if (errors.length) {
    console.error('\nCUSTOMER PACKAGE GÜVENLİK KONTROLÜ BAŞARISIZ:\n');
    for (const e of errors) console.error('  ✗', e);
    console.error(`\n${errors.length} ihlal bulundu. Build durdurulmalı.\n`);
    process.exit(1);
}
console.log('✓ Customer package güvenlik kontrolü başarılı (yasak dosya/desen yok).');
