const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskSecret, maskEmail, truncate, redact } = require('../../src/utils/logSafe');

test('maskSecret: uzun -> ilk 4 + son 4', () => {
    const out = maskSecret('sk-ant-api03-abcdef1234567890');
    assert.match(out, /^sk-a.*7890$/);
});

test('maskSecret: kisa tamamen yildiz', () => {
    assert.equal(maskSecret('abc'), '***');
    assert.equal(maskSecret(''), '');
});

test('maskEmail: yarim maske', () => {
    assert.equal(maskEmail('alice@example.com'), 'a****@example.com');
    assert.equal(maskEmail('not-an-email'), '***');
});

test('truncate: kisaltma + ek info', () => {
    const out = truncate('a'.repeat(500), 100);
    assert.match(out, /\[\+400 char\]$/);
});

test('redact: Bearer gizlenir', () => {
    const out = redact('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCJ9.abc.def');
    assert.match(out, /Bearer \*\*\*/);
});

test('redact: e-posta + API key prefix', () => {
    const out = redact('mail a@b.co key sk-abc123def456ghi789');
    assert.match(out, /a\*\*\*@b\.co/);
    assert.match(out, /sk-\*\*\*/);
});
