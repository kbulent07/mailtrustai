// ============================================================
// Unit tests: src/integrations/otx.js — whitelist davranışı
// AlienVault OTX'in popüler domain'ler için ürettiği false-positive'leri
// engelleyen filtrenin doğru çalıştığını doğrular.
// ============================================================
const test    = require('node:test');
const assert  = require('node:assert/strict');

const { isOtxWhitelisted, extractIndicators, OTX_DOMAIN_WHITELIST } =
    require('../../src/integrations/otx');

test('isOtxWhitelisted: tipik popüler domain\'ler whitelist\'te', () => {
    const cases = [
        'youtube.com', 'youtu.be', 'google.com', 'gmail.com',
        'microsoft.com', 'outlook.com', 'github.com', 'apple.com'
    ];
    for (const d of cases) {
        assert.equal(isOtxWhitelisted(d), true, `${d} whitelist'te olmalı`);
    }
});

test('isOtxWhitelisted: alt domain otomatik eşleşir (x.youtube.com)', () => {
    assert.equal(isOtxWhitelisted('m.youtube.com'), true);
    assert.equal(isOtxWhitelisted('docs.google.com'), true);
    assert.equal(isOtxWhitelisted('login.microsoftonline.com'), true);
    assert.equal(isOtxWhitelisted('cdn.facebook.com'), true);
});

test('isOtxWhitelisted: www prefix\'i de tanır', () => {
    assert.equal(isOtxWhitelisted('www.youtube.com'), true);
});

test('isOtxWhitelisted: bilinmeyen / tehlikeli domain reddedilir', () => {
    assert.equal(isOtxWhitelisted('phish.tk'), false);
    assert.equal(isOtxWhitelisted('paypa1.com'), false);
    assert.equal(isOtxWhitelisted('youtube.attacker.com'), false); // suffix tek başına yetmez
    assert.equal(isOtxWhitelisted(''), false);
    assert.equal(isOtxWhitelisted(null), false);
});

test('extractIndicators: youtube.com gönderici domain\'i OTX sorgusuna eklenmiyor', () => {
    const parsed = {
        from: [{ address: 'noreply@youtube.com' }],
        receivedHeaders: []
    };
    const result = extractIndicators(parsed, []);
    const domains = result.filter(r => r.type === 'domain').map(r => r.value);
    assert.ok(!domains.includes('youtube.com'), 'youtube.com indicator listesinde olmamalı');
});

test('extractIndicators: link\'lerdeki youtube/youtu.be URL\'leri OTX sorgusuna eklenmiyor', () => {
    const parsed = {
        from: [{ address: 'sender@example.com' }],
        receivedHeaders: []
    };
    const result = extractIndicators(parsed, [
        'https://www.youtube.com/watch?v=abc',
        'https://youtu.be/xyz',
        'https://docs.google.com/document/123',
        'https://phish.tk/login'
    ]);
    const values = result.map(r => r.value);
    assert.ok(!values.some(v => v.includes('youtube.com') || v.includes('youtu.be') || v.includes('google.com')),
        'whitelist domain\'lerin URL\'leri/domain\'leri eklenmemeli');
    assert.ok(values.some(v => v.includes('phish.tk')), 'phish.tk whitelist\'te değil, sorgulanmalı');
});

test('extractIndicators: receivedHeaders\'taki gerçek public IP yine sorgulanır', () => {
    const parsed = {
        from: [{ address: 'a@b.com' }],
        receivedHeaders: ['from mail.b.com [203.0.113.42]']
    };
    const result = extractIndicators(parsed, []);
    const ips = result.filter(r => r.type === 'IPv4').map(r => r.value);
    assert.ok(ips.includes('203.0.113.42'), 'IP whitelist filtresinden etkilenmemeli');
});

test('OTX_DOMAIN_WHITELIST içeriği temel kontrol', () => {
    assert.ok(OTX_DOMAIN_WHITELIST.has('youtube.com'));
    assert.ok(OTX_DOMAIN_WHITELIST.has('youtu.be'));
    assert.ok(OTX_DOMAIN_WHITELIST.size > 50, 'whitelist makul büyüklükte olmalı');
});
