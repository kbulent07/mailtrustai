#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SCOPE_IMAGE = process.argv.includes('--scope=image');

const FORBIDDEN_PATHS_IMAGE = [
    'apps/dealer',
    'apps/license-server',
    'packages/license-core',
    'src/license/keygenTool.js',
    'src/license/license-generator.js',
    'src/routes/dealerApi.js',
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

const SCAN_DIRS = ['apps/customer', 'packages', 'src', 'public'];
const FORBIDDEN_NAME_TOKENS = [
    'keygen',
    'reseller',
    'license/generate',
    'batch-license',
    'trial-license',
    'bayi.html',
    'keygen.html',
    'customer-list-admin',
    'dealer-credit'
];
const FORBIDDEN_PATTERNS = [
    { rx: /generateLicenseKey\s*\(/, msg: 'license generate' },
    { rx: /\/api\/license\/revoke\b/i, msg: 'revoke endpoint' },
    { rx: /signActivation\s*\(/, msg: 'license sign' },
    { rx: /batch.{0,12}license/i, msg: 'batch license' },
    { rx: /trial.{0,12}license/i, msg: 'trial license' },
    { rx: /dealer.{0,8}credit/i, msg: 'dealer credit' },
    { rx: /customer\s*list\s*admin/i, msg: 'customer list admin' }
];

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
    'src/license/license.js',
    'src/interfaces/http/routes/license.routes.js',
    'apps/dealer/server.js',
    'apps/dealer/routes/dealer.routes.js',
    'apps/license-server/routes/license.routes.js',
    'apps/license-server/routes/central.routes.js',
    'apps/license-server/routes/customerSync.routes.js'
]);

const errors = [];

if (SCOPE_IMAGE) {
    for (const rel of FORBIDDEN_PATHS_IMAGE) {
        if (fs.existsSync(path.join(ROOT, rel))) {
            errors.push(`[FORBIDDEN-PATH] ${rel} customer image icinde olmamali`);
        }
    }
}

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
        const relLower = rel.toLowerCase();
        for (const token of FORBIDDEN_NAME_TOKENS) {
            if (relLower.includes(token)) {
                errors.push(`[FORBIDDEN-NAME] ${rel}: ${token}`);
            }
        }
        const text = fs.readFileSync(file, 'utf8');
        for (const { rx, msg } of FORBIDDEN_PATTERNS) {
            if (rx.test(text)) errors.push(`[FORBIDDEN-PATTERN] ${rel}: ${msg}`);
        }
    }
}

if (errors.length) {
    console.error('\nCUSTOMER PACKAGE GUVENLIK KONTROLU BASARISIZ:\n');
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\n${errors.length} ihlal bulundu.\n`);
    process.exit(1);
}

console.log(`OK: Customer package guvenlik kontrolu basarili (${SCOPE_IMAGE ? 'scope=image' : 'scope=repo'}).`);
