'use strict';
// 3'lu test:
// (1) license-client encrypted cache roundtrip
// (2) central-sync state corrupted dosya → sessiz fallback
// (3) Migration runner idempotent (0001 + 0002 iki kez calistirilir, bozulmaz)

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Her test kendi DATA_DIR'inde calismali — paketler env'i import sirasinda okur,
// bu yuzden global env'i once set ederiz.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-cs-'));
process.env.DATA_DIR = TMP_ROOT;

test('license-client: writeCache → readCache (AES-256-GCM roundtrip)', () => {
    const lc = require('@mailtrustai/license-client');
    const payload = {
        instanceId: 'inst-rt',
        licenseKeyHash: 'abc'.repeat(21) + 'a', // 64 char fake hex
        customerId: 'cust-rt',
        dealerId: 'dlr-rt',
        plan: 'pro',
        tier: 'pro',
        features: { imapMonitor: true, deepAi: true },
        limits: { monthlyScanCount: 5000 },
        expiresAt: Date.now() + 86400000,
        graceDays: 3,
        licenseStatus: 'active',
        lastValidatedAt: Date.now()
    };
    lc.writeCache(payload);

    const read = lc.readCache();
    assert.ok(read, 'cache okunamadi');
    assert.strictEqual(read.instanceId, payload.instanceId);
    assert.strictEqual(read.plan, payload.plan);
    assert.deepStrictEqual(read.features, payload.features);
    assert.strictEqual(read.licenseKeyHash, payload.licenseKeyHash);

    // Disk uzerindeki dosyanin sifrelenmis oldugunu kontrol et (plaintext sizmamali).
    const cachePath = path.join(TMP_ROOT, 'license-cache.enc');
    const raw = fs.readFileSync(cachePath, 'utf8');
    assert.ok(!raw.includes('cust-rt'), 'plaintext customerId disk\'te gozukmemeli');
    assert.ok(!raw.includes('imapMonitor'), 'plaintext feature gozukmemeli');
});

test('license-client: bozuk cache dosyasi → null (silent fallback)', () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-corrupt-'));
    process.env.DATA_DIR = tmp2;
    // Modulu fresh import et (require cache cleanup)
    delete require.cache[require.resolve('@mailtrustai/license-client')];
    const lc = require('@mailtrustai/license-client');
    fs.writeFileSync(path.join(tmp2, 'license-cache.enc'), 'this-is-not-encrypted-json');
    const read = lc.readCache();
    assert.strictEqual(read, null, 'bozuk cache null donmeli, throw etmemeli');
    // Eski TMP_ROOT'a geri don (digerlerini etkilememek icin)
    process.env.DATA_DIR = TMP_ROOT;
});

test('central-sync: bozuk state dosyasi → default state (silent recovery)', () => {
    const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-state-'));
    process.env.DATA_DIR = tmp3;
    delete require.cache[require.resolve('@mailtrustai/central-sync')];
    const cs = require('@mailtrustai/central-sync');

    // Bozuk state dosyasi yaz
    fs.writeFileSync(path.join(tmp3, 'central-sync-state.enc'), 'garbage-not-aes-gcm');

    const state = cs.getState();
    assert.ok(state, 'state objesi donmeli');
    assert.strictEqual(state.localPolicyVersion, 0);
    assert.strictEqual(state.localWhitelistVersion, 0);
    assert.strictEqual(state.localBlacklistVersion, 0);

    const lists = cs.getLists();
    assert.ok(lists.whitelist);
    assert.ok(Array.isArray(lists.whitelist.domains));

    process.env.DATA_DIR = TMP_ROOT;
});

test('migration runner: 0001+0002 idempotent (ikinci boot crash etmez)', async () => {
    const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-mig-'));
    process.env.DATA_DIR = tmp4;
    process.env.LICENSE_DB_CLIENT = 'sqlite';
    process.env.LICENSE_DB_PATH = path.join(tmp4, 'idem.sqlite');

    // 1. boot
    delete require.cache[require.resolve(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'))];
    let db1 = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
    await db1.ready;
    const migs1 = await db1.all('SELECT id FROM _migrations ORDER BY id');
    assert.ok(migs1.length >= 2, `iki migration uygulanmali: ${JSON.stringify(migs1)}`);

    // Index'ler eklendi mi?
    const idx1 = await db1.all(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    );
    assert.ok(idx1.length >= 8, `8 index olmali: ${idx1.map(i => i.name).join(',')}`);

    // DB'yi kapatip yeniden ac
    db1.db && db1.db.close && db1.db.close();
    delete require.cache[require.resolve(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'))];

    // 2. boot (ayni dosya, ayni migration'lar) - skip etmeli
    let db2 = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
    await db2.ready;
    const migs2 = await db2.all('SELECT id FROM _migrations ORDER BY id');
    assert.deepStrictEqual(
        migs1.map(m => m.id),
        migs2.map(m => m.id),
        'migration listesi degismemeli'
    );

    db2.db && db2.db.close && db2.db.close();
    process.env.DATA_DIR = TMP_ROOT;
});

test('security/bearerAuth: farkli uzunlukta token 401 (throw etmez)', () => {
    const { bearerAuth } = require('@mailtrustai/security');
    const mw = bearerAuth('expected-32-character-secret-xxx');

    let status = null;
    const res = { status: (s) => ({ json: () => { status = s; } }) };
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    // Farkli uzunluk
    mw({ headers: { authorization: 'Bearer short' } }, res, next);
    assert.strictEqual(status, 401);
    assert.strictEqual(nextCalled, false);

    // Header yok
    status = null; nextCalled = false;
    mw({ headers: {} }, res, next);
    assert.strictEqual(status, 401);

    // Dogru token
    status = null; nextCalled = false;
    mw({ headers: { authorization: 'Bearer expected-32-character-secret-xxx' } }, res, next);
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(status, null);
});
