const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskSecret, maskEmail, truncate, redact } = require('../../src/utils/logSafe');

test('maskSecret: uzun string -> ilk 4 + son 4 visible', () => {
    const out = maskSecret('sk-ant-api03-abcdef1234567890');
    assert.match(out, /^sk-a.*7890$/);
    assert.ok(out.includes('*'));
});

test('maskSecret: kisa string tamamen maskelenir', () => {
    assert.equal(maskSecret('abc'), '***');
    assert.equal(maskSecret(''), '');
});

test('maskEmail: e-posta tam degil maske', () => {
    assert.equal(maskEmail('alice@example.com'), 'a****@example.com');
});

test('maskEmail: gecersiz e-posta -> ***', () => {
    assert.equal(maskEmail('not-an-email'), '***');
    assert.equal(maskEmail(''), '');
});

test('truncate: limit altinda degismez', () => {
    assert.equal(truncate('hello', 10), 'hello');
});

test('truncate: limit ustu kisaltilir + ek info', () => {
    const out = truncate('a'.repeat(500), 100);
    assert.equal(out.length, 100 + '... [+400 char]'.length);
    assert.match(out, /\[\+400 char\]$/);
});

test('redact: Bearer token gizlenir', () => {
    const s = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc';
    const out = redact(s);
    assert.ok(!out.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc'));
    assert.match(out, /Bearer \*\*\*/);
});

test('redact: e-posta adresleri maskelenir', () => {
    const out = redact('mail to alice@example.com or bob@foo.bar');
    assert.match(out, /a\*\*\*@example\.com/);
    assert.match(out, /b\*\*\*@foo\.bar/);
});

test('redact: API key prefix yakalanir', () => {
    const out = redact('key: sk-abc123def456ghi789jkl');
    assert.ok(!out.includes('abc123def456ghi789jkl'));
    assert.match(out, /sk-\*\*\*/);
});
