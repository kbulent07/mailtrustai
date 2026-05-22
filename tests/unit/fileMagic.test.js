const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectFormat, looksLikeEml, assertFileFormat } = require('../../src/utils/fileMagic');

test('detectFormat: PDF magic', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(20)]);
    assert.equal(detectFormat(buf), 'pdf');
});

test('detectFormat: OLE2 (.msg)', () => {
    const buf = Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]), Buffer.alloc(24)]);
    assert.equal(detectFormat(buf), 'ole2');
});

test('detectFormat: ZIP wrapper (.docx)', () => {
    const buf = Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]), Buffer.alloc(28)]);
    assert.equal(detectFormat(buf), 'zip');
});

test('detectFormat: PE/MZ (.exe)', () => {
    const buf = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)]);
    assert.equal(detectFormat(buf), 'exe');
});

test('detectFormat: bilinmeyen → unknown', () => {
    assert.equal(detectFormat(Buffer.from('plain text here')), 'unknown');
    assert.equal(detectFormat(Buffer.alloc(0)), 'unknown');
});

test('looksLikeEml: RFC 822 headerlari -> true', () => {
    const eml = Buffer.from(
        'Received: from x\r\nFrom: a@b.c\r\nTo: c@d.e\r\nSubject: t\r\n\r\nBody'
    );
    assert.equal(looksLikeEml(eml), true);
});

test('looksLikeEml: rasgele text → false', () => {
    assert.equal(looksLikeEml(Buffer.from('lorem ipsum')), false);
});

test('assertFileFormat: .pdf + PDF magic → ok', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(20)]);
    const r = assertFileFormat(buf, 'a.pdf', ['pdf']);
    assert.equal(r.ok, true);
});

test('assertFileFormat: .eml uzanti + header → ok', () => {
    const eml = Buffer.from('From: a@x\r\nTo: b@y\r\nSubject: t\r\n\r\nbody');
    const r = assertFileFormat(eml, 'msg.eml', ['eml']);
    assert.equal(r.ok, true);
});

test('assertFileFormat: spoof — .eml ama PE icerigi → reject', () => {
    const buf = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)]);
    const r = assertFileFormat(buf, 'spoof.eml', ['eml','msg','ole2']);
    assert.equal(r.ok, false);
    assert.match(r.reason, /beklenen formatta degil/);
});
