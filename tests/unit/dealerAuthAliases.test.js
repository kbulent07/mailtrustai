const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

const dealerApi = require('../../src/routes/dealerApi');
const { upsertDealer, deleteDealer } = require('../../src/storage/dealerStore');

test('normalizeDealerLoginInput normalizes email login without uppercasing it', () => {
    const login = dealerApi._test.normalizeDealerLoginInput({
        username: 'Bayi@Firma.com',
        password: 'secret123'
    });

    assert.deepEqual(login, {
        username: 'Bayi@Firma.com',
        normalizedUsername: 'bayi@firma.com',
        password: 'secret123'
    });
});

test('normalizeDealerLoginInput keeps old code/pin payload working', () => {
    const login = dealerApi._test.normalizeDealerLoginInput({
        code: 'bay002',
        pin: '4567'
    });

    assert.deepEqual(login, {
        username: 'bay002',
        normalizedUsername: 'BAY002',
        password: '4567'
    });
});

test('normalizeDealerAdminInput supports username/password and returns normalized dealer payload', () => {
    const payload = dealerApi._test.normalizeDealerAdminInput({
        username: 'bay003',
        password: 'new-pass',
        name: 'Ornek Bayi',
        contactPerson: 'Ali',
        email: 'ali@example.com',
        discountPct: '15',
        active: false
    });

    assert.equal(payload.username, 'BAY003');
    assert.equal(payload.password, 'new-pass');
    assert.equal(payload.name, 'Ornek Bayi');
    assert.equal(payload.contactPerson, 'Ali');
    assert.equal(payload.email, 'ali@example.com');
    assert.equal(payload.discountPct, 15);
    assert.equal(payload.active, false);
});

test('toSafeDealerSummary exposes username alias without password hash', () => {
    const safe = dealerApi._test.toSafeDealerSummary({
        code: 'BAY004',
        name: 'Demo'
    });

    assert.equal(safe.username, 'BAY004');
    assert.equal(safe.code, 'BAY004');
    assert.equal(safe.name, 'Demo');
});

test('authenticateDealerLogin rejects founder proxy login when env vars are not set', async () => {
    // Güvenlik regresyon testi: founder proxy artık env-tabanlı.
    // MSA_FOUNDER_PROXY_EMAIL / MSA_FOUNDER_PROXY_PASSWORD_HASH set edilmeden
    // hiçbir credential founder bypass'ına izin vermemeli — eski hardcoded
    // şifre (System01.) artık tanınmamalı.
    const code = 'FOUNDERTEST';
    const pinHash = await bcrypt.hash('demo-pass', 10);
    upsertDealer({
        code,
        name: 'Founder Proxy Dealer',
        email: 'founder-proxy@example.com',
        pinHash,
        active: true
    });

    try {
        const auth = await dealerApi._test.authenticateDealerLogin({
            username: 'kbulent07@gmail.com',
            normalizedUsername: 'kbulent07@gmail.com',
            password: 'System01.'
        });

        // Eski hardcoded backdoor → reddedilmeli
        assert.equal(auth.ok, false);
        assert.equal(auth.founderProxy, undefined);
    } finally {
        deleteDealer(code);
    }
});
