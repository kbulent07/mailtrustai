// ============================================================
// QUARANTINE LOJIK TESTİ
//   1. credentials.enc'deki hesaplarda moveHighRiskToQuarantine flag durumu
//   2. shouldMoveMessageToQuarantine: high / critical durumları
//   3. isQuarantineMoveEnabled davranışı
//   4. maybeMoveMessageToQuarantine — disabled / not-eligible / connect denemesi
// ============================================================
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { loadCredentials } = require('../src/imap/connection');
const {
    isQuarantineMoveEnabled,
    shouldMoveMessageToQuarantine,
    maybeMoveMessageToQuarantine,
    DEFAULT_QUARANTINE_FOLDER
} = require('../src/imap/quarantineService');

function pass(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗ ${msg}\x1b[0m`); process.exitCode = 1; }
function section(t) { console.log(`\n\x1b[1;36m${t}\x1b[0m`); }

(async () => {
    console.log('\x1b[1mQuarantine taşıma mantığı testi\x1b[0m');
    console.log('=' .repeat(60));
    console.log(`Hedef klasör: ${DEFAULT_QUARANTINE_FOLDER}`);

    // ─── 1. shouldMoveMessageToQuarantine doğruluk testleri ──────────────
    section('1) shouldMoveMessageToQuarantine() seviye testleri');
    const cases = [
        { name: 'level=high',              result: { level:'high',   findings: [] },                       expect: true  },
        { name: 'level=HIGH (case)',       result: { level:'HIGH',   findings: [] },                       expect: true  },
        { name: 'level=medium',            result: { level:'medium', findings: [] },                       expect: false },
        { name: 'level=low',               result: { level:'low',    findings: [] },                       expect: false },
        { name: 'level=safe',              result: { level:'safe',   findings: [] },                       expect: false },
        { name: 'critical finding (medium)', result: { level:'medium', findings:[{severity:'critical'}] }, expect: true  },
        { name: 'critical finding (low)',    result: { level:'low',    findings:[{severity:'critical'}] }, expect: true  },
        { name: 'warning finding only',      result: { level:'medium', findings:[{severity:'warning'}] },  expect: false },
        { name: 'null result',             result: null,                                                    expect: false },
    ];
    cases.forEach(c => {
        const got = shouldMoveMessageToQuarantine(c.result);
        if (got === c.expect) pass(`${c.name} → ${got}`);
        else                  fail(`${c.name}: beklenen=${c.expect}, gelen=${got}`);
    });

    // ─── 2. isQuarantineMoveEnabled testleri ─────────────────────────────
    section('2) isQuarantineMoveEnabled() flag testleri');
    const flagCases = [
        { acc:{ moveHighRiskToQuarantine: true   }, expect: true  },
        { acc:{ moveHighRiskToQuarantine: 'true' }, expect: true  },
        { acc:{ moveHighRiskToQuarantine: false  }, expect: false },
        { acc:{ moveHighRiskToQuarantine: null   }, expect: false },
        { acc:{},                                   expect: false },
        { acc: null,                                expect: false },
    ];
    flagCases.forEach((c,i) => {
        const got = isQuarantineMoveEnabled(c.acc);
        if (got === c.expect) pass(`flag-${i+1} (acc=${JSON.stringify(c.acc)}) → ${got}`);
        else                  fail(`flag-${i+1}: beklenen=${c.expect}, gelen=${got}`);
    });

    // ─── 3. credentials.enc'deki gerçek hesapların durumu ────────────────
    section('3) Kayıtlı IMAP hesaplarının quarantine ayarı');
    let accounts = [];
    try {
        accounts = loadCredentials();
    } catch (e) {
        fail('loadCredentials hata: ' + e.message);
    }
    if (!accounts.length) {
        console.log('  \x1b[33m⚠\x1b[0m  Kayıtlı IMAP hesabı yok.');
    } else {
        accounts.forEach(a => {
            const enabled = isQuarantineMoveEnabled(a);
            const mark    = enabled ? '\x1b[32m✓ aktif\x1b[0m' : '\x1b[90m— pasif\x1b[0m';
            console.log(`  ${mark}  ${a.email}  (host=${a.host}, port=${a.port || 993})`);
        });
    }

    // ─── 4. maybeMoveMessageToQuarantine: disabled / not-eligible ────────
    section('4) maybeMoveMessageToQuarantine() — kısa devre durumları');

    // 4a) disabled hesap
    {
        const r = await maybeMoveMessageToQuarantine({
            account: { email:'test@example.com' /* flag yok */ },
            uid: 999,
            result: { level: 'high', findings: [] }
        });
        if (!r.moved && r.reason === 'disabled') pass(`disabled → reason=${r.reason}`);
        else fail(`disabled bekleniyordu, gelen=${JSON.stringify(r)}`);
    }
    // 4b) uid yok
    {
        const r = await maybeMoveMessageToQuarantine({
            account: { email:'test@example.com', moveHighRiskToQuarantine: true },
            uid: null,
            result: { level: 'high', findings: [] }
        });
        // disabled hala buradan dönmez çünkü credentials.enc'de bu mail yok
        // ama hesabımız test@example.com ise loadCredentials onu bulamaz → fallback acc kullanılır
        // o yüzden flag true sayılır → uid kontrolüne düşer
        if (!r.moved && r.reason === 'missing-uid') pass(`missing-uid → reason=${r.reason}`);
        else fail(`missing-uid bekleniyordu, gelen=${JSON.stringify(r)}`);
    }
    // 4c) not-eligible (low risk)
    {
        const r = await maybeMoveMessageToQuarantine({
            account: { email:'test@example.com', moveHighRiskToQuarantine: true },
            uid: 999,
            result: { level: 'low', findings: [] }
        });
        if (!r.moved && r.reason === 'not-eligible') pass(`not-eligible (low) → reason=${r.reason}`);
        else fail(`not-eligible bekleniyordu, gelen=${JSON.stringify(r)}`);
    }
    // 4d) eligible ama hayali host → bağlantı hatası bekliyoruz
    {
        const r = await maybeMoveMessageToQuarantine({
            account: {
                email:'test@example.com',
                host:'imap.invalid.localhost.test',
                port:993, secure:true, password:'x',
                moveHighRiskToQuarantine: true
            },
            uid: 999,
            result: { level: 'high', findings: [{severity:'critical'}] }
        });
        if (r.attempted && !r.moved && r.error) pass(`eligible + invalid host → attempted=${r.attempted}, error="${r.error.slice(0,60)}..."`);
        else fail(`bağlantı hatası bekleniyordu, gelen=${JSON.stringify(r)}`);
    }

    console.log('\n' + '='.repeat(60));
    if (process.exitCode) console.log('\x1b[31mBAZI TESTLER BAŞARISIZ\x1b[0m');
    else                  console.log('\x1b[32mTÜM TESTLER GEÇTİ ✓\x1b[0m');
})().catch(e => {
    console.error('\x1b[31mTest çalıştırma hatası:\x1b[0m', e);
    process.exit(1);
});
