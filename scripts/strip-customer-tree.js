#!/usr/bin/env node
'use strict';

// ============================================================
// MailTrustAI — Müşteri (customer) ağacı temizleyici
//
// NATIVE (Docker'sız) müşteri kurulumunda kullanılır. Docker
// build'inde apps/customer/Dockerfile bu silmeyi `RUN rm -rf ...`
// adımlarıyla yapıyordu; native kurulumda aynı işi bu script yapar
// ki keygen / lisans-üretici / bayi (dealer) / license-server kodu
// müşteri diskine HİÇ inmesin (CRITICAL güvenlik).
//
// Silinen yollar, scripts/check-customer-package.js içindeki
// FORBIDDEN_PATHS_IMAGE listesiyle birebir aynıdır; ek olarak
// Dockerfile'ın temizlediği public/js/bayi-app.js de kaldırılır.
//
// Çalıştırma (repo kökünden):
//   node scripts/strip-customer-tree.js
// Ardından doğrulama:
//   MSA_CUSTOMER_BUILD=1 node scripts/check-customer-package.js --scope=image
//
// Idempotent'tir: olmayan yolu sessiz geçer, tekrar tekrar çalışır.
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

// scripts/check-customer-package.js → FORBIDDEN_PATHS_IMAGE ile senkron tutun.
const FORBIDDEN_PATHS = [
    // App'ler — bayi paneli ve lisans/keygen sunucusu müşteride OLMAMALI
    'apps/dealer',
    'apps/license-server',
    // Lisans üretici/imzalayıcı çekirdek paket
    'packages/license-core',
    // src/ içindeki müşteri-dışı dosyalar
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
    'src/utils/dealerLock.js',
    // public/ → keygen + bayi sayfaları ve bayi JS'i
    'public/keygen.html',
    'public/bayi.html',
    'public/reseller.html',     // savunma amaçlı — varsa kaldır
    'public/js/bayi-app.js'
];

// NOT: src/middleware/adminAuth.js KORUNUR — customer.routes.js /customer/reset
// rotası için gerekli. HARD-GATE /api/admin path'lerini zaten 404'ler.

function rmrf(rel) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return false;
    fs.rmSync(abs, { recursive: true, force: true });
    return true;
}

function main() {
    // Repo kökünde miyiz? package.json + apps/customer beklenir.
    if (!fs.existsSync(path.join(ROOT, 'package.json')) ||
        !fs.existsSync(path.join(ROOT, 'apps', 'customer'))) {
        console.error('[strip] HATA: repo kökünden çalıştırın (package.json + apps/customer bulunamadı).');
        console.error(`        Geçerli dizin: ${ROOT}`);
        process.exit(2);
    }

    let removed = 0;
    let skipped = 0;
    for (const rel of FORBIDDEN_PATHS) {
        if (rmrf(rel)) {
            console.log(`[strip] kaldırıldı: ${rel}`);
            removed++;
        } else {
            skipped++;
        }
    }

    console.log(`\n[strip] Tamam — ${removed} yol kaldırıldı, ${skipped} yol zaten yoktu.`);
    console.log('[strip] Doğrulama için: MSA_CUSTOMER_BUILD=1 node scripts/check-customer-package.js --scope=image');
}

main();
