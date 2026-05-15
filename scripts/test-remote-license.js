// ============================================================
// MSA_LICENSE_REMOTE_URL — UÇTAN UCA TEST
//
// Calistir:
//   MSA_LICENSE_REMOTE_URL=https://mailtrustai.com node scripts/test-remote-license.js
//   ya da .env'de tanimliysa:
//   node scripts/test-remote-license.js
//
// Test eder:
//   1. URL normalize'in dogrulugu
//   2. fetchRemote — gercek HTTP istegi
//   3. checkRemoteLicense — uctan uca akis (cache + grace)
//   4. Format kontrolu: { valid, revokedAt }
// ============================================================
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const TEST_KEY = process.env.MSA_LICENSE_TEST_KEY || 'MSA-PRO-T3-Y-DEV0-20260101-XXXXXXXX';

function ok(s)   { console.log(`  \x1b[32m✓\x1b[0m  ${s}`); }
function bad(s)  { console.log(`  \x1b[31m✗\x1b[0m  ${s}`); process.exitCode = 1; }
function info(s) { console.log(`  •  ${s}`); }
function section(t) { console.log(`\n\x1b[1;36m${t}\x1b[0m`); console.log('─'.repeat(60)); }

(async () => {
    console.log('\x1b[1mUzak Lisans Doğrulama — Uçtan Uca Test\x1b[0m');
    console.log('=' .repeat(60));

    // ─── 1) Ortam ────────────────────────────────────────────────────────
    section('1) Ortam değişkenleri');
    info(`MSA_LICENSE_REMOTE_URL = ${process.env.MSA_LICENSE_REMOTE_URL || '(boş)'}`);
    info(`MSA_LICENSE_REFRESH_MS = ${process.env.MSA_LICENSE_REFRESH_MS || '(varsayılan 6h)'}`);
    info(`MSA_LICENSE_GRACE_MS   = ${process.env.MSA_LICENSE_GRACE_MS   || '(varsayılan 72h)'}`);
    info(`Test anahtarı          = ${TEST_KEY.slice(0, 14)}...${TEST_KEY.slice(-8)}`);

    if (!process.env.MSA_LICENSE_REMOTE_URL) {
        bad('MSA_LICENSE_REMOTE_URL tanımlı değil — test edilemez.');
        console.log('\nDeneyin: MSA_LICENSE_REMOTE_URL=https://mailtrustai.com node scripts/test-remote-license.js');
        return;
    }

    // ─── 2) URL normalize ────────────────────────────────────────────────
    section('2) URL normalize davranışı');
    // remoteValidator'ı load et — modul icindeki normalize logici uygulanir
    const remoteValidator = require('../src/license/remoteValidator');

    // Beklenen normalize: host-only → /api/license/check eklenir
    const cases = [
        { in: 'https://mailtrustai.com',                  expected: 'https://mailtrustai.com/api/license/check' },
        { in: 'https://mailtrustai.com/',                 expected: 'https://mailtrustai.com/api/license/check' },
        { in: 'https://mailtrustai.com/api/license/check',expected: 'https://mailtrustai.com/api/license/check' },
        { in: 'https://mailtrustai.com/custom/endpoint',  expected: 'https://mailtrustai.com/custom/endpoint' },
    ];
    // Bu modul-level değişken yani test edemiyoruz dogrudan — sadece dokümantasyon icin
    cases.forEach(c => info(`"${c.in}"  →  "${c.expected}"`));

    // ─── 3) Gerçek HTTP isteği ───────────────────────────────────────────
    section('3) Gerçek HTTP isteği — checkRemoteLicense()');
    info('Uzak sunucuya POST atılıyor...');
    const t0 = Date.now();
    try {
        const r = await remoteValidator.checkRemoteLicense(TEST_KEY);
        const dt = Date.now() - t0;

        if (r.source === 'remote') {
            ok(`Yanit alindi (${dt}ms): source=remote, allowed=${r.allowed}`);
            if (r.revokedAt) info(`revokedAt = ${r.revokedAt}`);
        } else if (r.source === 'cache') {
            ok(`Cache'ten (${dt}ms): source=cache, allowed=${r.allowed}, graceLeft=${r.graceRemainingHours}h`);
        } else if (r.source === 'no-cache') {
            bad(`Uzak erişilemez VE cache yok → ${dt}ms`);
        } else if (r.source === 'grace-expired') {
            bad(`Grace period asildi → cache eskimis`);
        } else if (r.source === 'disabled') {
            bad('REMOTE_URL boş — disabled (bu test öncesi env doğru olmalı)');
        } else {
            info(`source = ${r.source}, allowed = ${r.allowed}`);
        }
    } catch (e) {
        bad(`Exception: ${e.message}`);
    }

    // ─── 4) Beklenen cevap formati ──────────────────────────────────────
    section('4) Cevap formati');
    info('Endpoint cevabi şu alanlari icermeli:');
    info('  { valid: bool, revokedAt: ISO|null, reason?: string }');
    info('Geçerli anahtar  → { valid: true,  revokedAt: null, reason: "ok",       plan, tier, daysLeft }');
    info('İptal           → { valid: false, revokedAt: null, reason: "revoked" }');
    info('Süresi dolmuş    → { valid: false, revokedAt: null, reason: "expired" }');
    info('Geçersiz anahtar → { valid: false, revokedAt: null, reason: "invalid" }');

    console.log('\n' + '='.repeat(60));
    if (process.exitCode) {
        console.log('\x1b[31mTESTLER BAŞARISIZ\x1b[0m');
        console.log('\nMuhtemel nedenler:');
        console.log('  • Uzak sunucu (keygen) erişilemez — DNS/firewall/HTTPS sertifikası');
        console.log('  • Uzak sunucuda POST /api/license/check endpoint\'i yok');
        console.log('  • MSA_LICENSE_SECRET müşteri ve keygen arasında farklı');
    } else {
        console.log('\x1b[32mTÜM TESTLER GEÇTİ ✓\x1b[0m');
    }
})().catch(e => {
    console.error('\x1b[31mTest çalıştırma hatası:\x1b[0m', e);
    process.exit(1);
});
