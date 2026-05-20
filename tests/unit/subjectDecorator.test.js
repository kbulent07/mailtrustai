// ============================================================
// Unit tests: subjectDecoratorService
//   • prefixForLevel: high → 🔴, medium → 🟣, diğer → null
//   • isAlreadyDecorated: header / emoji önek tespiti
//   • rewriteSubjectInRaw + extractOriginalSubject: round-trip
// ============================================================
const test   = require('node:test');
const assert = require('node:assert/strict');

const {
    PREFIX_HIGH,
    PREFIX_MEDIUM,
    HEADER_DECORATED,
    HEADER_ORIGINAL_SUBJECT,
    prefixForLevel,
    isAlreadyDecorated,
    extractOriginalSubject
} = require('../../src/imap/subjectDecoratorService');

test('prefixForLevel: high/critical → 🔴, medium → 🟣, diğer → null', () => {
    assert.equal(prefixForLevel('high'),     PREFIX_HIGH);
    assert.equal(prefixForLevel('HIGH'),     PREFIX_HIGH);
    assert.equal(prefixForLevel('critical'), PREFIX_HIGH);
    assert.equal(prefixForLevel('medium'),   PREFIX_MEDIUM);
    assert.equal(prefixForLevel('low'),      null);
    assert.equal(prefixForLevel('safe'),     null);
    assert.equal(prefixForLevel(''),         null);
    assert.equal(prefixForLevel(undefined),  null);
});

test('isAlreadyDecorated: X-MailTrustAI-Decorated header (Map) tespit edilir', () => {
    const hdrs = new Map();
    hdrs.set(HEADER_DECORATED.toLowerCase(), '1');
    assert.equal(isAlreadyDecorated({ headers: hdrs, subject: 'normal konu' }), true);
});

test('isAlreadyDecorated: header (object) tespit edilir', () => {
    const email = { headers: { [HEADER_DECORATED.toLowerCase()]: '1' }, subject: 'x' };
    assert.equal(isAlreadyDecorated(email), true);
});

test('isAlreadyDecorated: emoji önekli subject yedek olarak tespit edilir', () => {
    assert.equal(isAlreadyDecorated({ subject: PREFIX_HIGH + 'Tehlike' }), true);
    assert.equal(isAlreadyDecorated({ subject: PREFIX_MEDIUM + 'Şüpheli' }), true);
});

test('isAlreadyDecorated: temiz mail false döner', () => {
    assert.equal(isAlreadyDecorated({ subject: 'Sıradan bir mail', headers: new Map() }), false);
    assert.equal(isAlreadyDecorated(null), false);
});

test('extractOriginalSubject: base64 header decode edilir', () => {
    const orig = 'Faturanız hazır 🧾';
    const b64  = Buffer.from(orig, 'utf8').toString('base64');
    const hdrs = new Map();
    hdrs.set(HEADER_ORIGINAL_SUBJECT.toLowerCase(), b64);
    assert.equal(extractOriginalSubject({ headers: hdrs }), orig);
});

test('extractOriginalSubject: header yoksa null', () => {
    assert.equal(extractOriginalSubject({ headers: new Map() }), null);
    assert.equal(extractOriginalSubject(null), null);
});
