// ============================================================
// Unit tests: src/middleware/customerAuth.js
// HMAC-SHA256 stateless token doğrulama testleri.
// ============================================================
const test   = require('node:test');
const assert = require('node:assert/strict');

const customerAuth = require('../../src/middleware/customerAuth');

test('createCustomerToken: payload.signature formatında token üretir', () => {
    const token = customerAuth.createCustomerToken();
    assert.equal(typeof token, 'string');
    assert.ok(token.includes('.'));
    const [payloadB64, sig] = token.split('.');
    assert.ok(payloadB64.length > 0);
    assert.ok(/^[a-f0-9]{64}$/.test(sig), 'imza SHA-256 hex (64 char) olmalı');
});

test('verifyCustomerToken: kendi ürettiği token\'ı doğrular', () => {
    const token = customerAuth.createCustomerToken();
    assert.equal(customerAuth.verifyCustomerToken(token), true);
});

test('verifyCustomerToken: değiştirilmiş imza reddedilir', () => {
    const token = customerAuth.createCustomerToken();
    // Son karakteri değiştir
    const tampered = token.slice(0, -1) + (token.slice(-1) === '0' ? '1' : '0');
    assert.equal(customerAuth.verifyCustomerToken(tampered), false);
});

test('verifyCustomerToken: değiştirilmiş payload reddedilir', () => {
    const token = customerAuth.createCustomerToken();
    const [, sig] = token.split('.');
    // Payload'ı bozarsak imza eşleşmez
    const fakePayload = Buffer.from(JSON.stringify({ exp: Date.now() + 999999, r: 'customer' })).toString('base64url');
    const tampered = `${fakePayload}.${sig}`;
    assert.equal(customerAuth.verifyCustomerToken(tampered), false);
});

test('verifyCustomerToken: boş veya geçersiz girdiler reddedilir', () => {
    assert.equal(customerAuth.verifyCustomerToken(''), false);
    assert.equal(customerAuth.verifyCustomerToken(null), false);
    assert.equal(customerAuth.verifyCustomerToken(undefined), false);
    assert.equal(customerAuth.verifyCustomerToken('no-dot-here'), false);
    assert.equal(customerAuth.verifyCustomerToken(123), false);
});

test('verifyCustomerToken: süresi dolmuş token reddedilir', () => {
    // Doğrudan token üreterek expiry'i geçmişe set et
    const crypto = require('node:crypto');
    const secret = (process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#') + '|customer';
    const expired = JSON.stringify({ exp: Date.now() - 1000, r: 'customer' });
    const payloadB64 = Buffer.from(expired).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
    const expiredToken = `${payloadB64}.${sig}`;

    assert.equal(customerAuth.verifyCustomerToken(expiredToken), false);
});

test('verifyCustomerToken: yanlış role reddedilir', () => {
    // role !== 'customer' → reddedilir (admin token customer guard'ından geçemez)
    const crypto = require('node:crypto');
    const secret = (process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#') + '|customer';
    const payload = JSON.stringify({ exp: Date.now() + 60000, r: 'admin' });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
    const adminLikeToken = `${payloadB64}.${sig}`;

    assert.equal(customerAuth.verifyCustomerToken(adminLikeToken), false);
});

test('checkLoginRate: ilk birkaç deneme izin verilir', () => {
    const ip = `test-ip-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
        assert.equal(customerAuth.checkLoginRate(ip).allowed, true,
            `${i + 1}. deneme izin verilmeli`);
    }
});

test('checkLoginRate: 10 üstü deneme bloklanır + clearLoginRate sıfırlar', () => {
    const ip = `test-ip-${Math.random()}`;
    for (let i = 0; i < 10; i++) customerAuth.checkLoginRate(ip);
    const blocked = customerAuth.checkLoginRate(ip);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter > 0);

    customerAuth.clearLoginRate(ip);
    // Reset sonrası tekrar izin verilmeli
    assert.equal(customerAuth.checkLoginRate(ip).allowed, true);
});
