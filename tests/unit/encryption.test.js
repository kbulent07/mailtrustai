// ============================================================
// Unit tests: src/imap/connection.js — encrypt/decrypt
// AES-256-CBC round-trip ve format kontrolleri.
// ============================================================
const test   = require('node:test');
const assert = require('node:assert/strict');

const { encrypt, decrypt } = require('../../src/imap/connection');

test('encrypt: çıktı "iv_hex:ciphertext_hex" formatında', () => {
    const out = encrypt('hello-world');
    assert.match(out, /^[0-9a-f]{32}:[0-9a-f]+$/);
});

test('encrypt → decrypt round-trip: değer aynı geri gelir', () => {
    const samples = [
        'simple',
        'P@ssw0rd_!#$%',
        'türkçe karakter çñ',
        'long string '.repeat(100),
        '{"json":"value","n":42}',
        'sk-proj-pqOVZ2PjJ_KirqihDKbHYuPVqqDxuXk4PQsF2mJve-aL9hJtMJvAecTE'
    ];
    for (const original of samples) {
        const cipher = encrypt(original);
        const back   = decrypt(cipher);
        assert.equal(back, original, `round-trip başarısız: ${original.slice(0, 30)}...`);
    }
});

test('encrypt: aynı düz metin için her seferinde farklı çıktı (IV randomized)', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    assert.notEqual(a, b, 'IV her çağrıda farklı olmalı');
    // Ama her ikisi de aynı düz metne çözülmeli
    assert.equal(decrypt(a), 'same-input');
    assert.equal(decrypt(b), 'same-input');
});

test('decrypt: geçersiz format çağrısı throw eder', () => {
    assert.throws(() => decrypt('not-a-cipher-text'), /.*/, 'geçersiz format throw etmeli');
});

test('decrypt: bozuk hex throw eder', () => {
    assert.throws(() => decrypt('aaaa:zzzz'), /.*/);
});
