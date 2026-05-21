const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectFormat, looksLikeEml, assertFileFormat } = require('../../src/utils/fileMagic');

test('detectFormat: PDF magic', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(20)]);
    assert.equal(detectFormat(buf), 'pdf');
});

test('detectFormat: OLE2 (.msg / eski .doc)', () => {
    const buf = Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]), Buffer.alloc(24)]);
    assert.equal(detectFormat(buf), 'ole2');
});

test('detectFormat: ZIP (.docx/.xlsx wrapper)', () => {
    const buf = Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]), Buffer.alloc(28)]);
    assert.equal(detectFormat(buf), 'zip');
});

test('detectFormat: EXE/PE (MZ)', () => {
    const buf = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)]);
    assert.equal(detectFormat(buf), 'exe');
});

test('detectFormat: bilinmeyen format → unknown', () => {
    const buf = Buffer.from('plain text content here');
    assert.equal(detectFormat(buf), 'unknown');
});

test('detectFormat: bos/cok kucuk buffer → unknown', () => {
    assert.equal(detectFormat(Buffer.alloc(0)), 'unknown');
    assert.equal(detectFormat(Buffer.from([0xff])), 'unknown');
});

test('looksLikeEml: gercek RFC 822 basliklari → true', () => {
    const eml = Buffer.from(
        'Received: from mx.example.com\r\n' +
        'From: alice@example.com\r\n' +
        'To: bob@example.com\r\n' +
        'Subject: hello\r\n' +
        'Date: Thu, 01 Jan 2026 12:00:00 +0000\r\n' +
        '\r\nBody'
    );
    assert.equal(looksLikeEml(eml), true);
});

test('looksLikeEml: rasgele text → false', () => {
    assert.equal(looksLikeEml(Buffer.from('Lorem ipsum dolor')), false);
});

test('assertFileFormat: .pdf uzanti + PDF magic → ok', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(20)]);
    const r = assertFileFormat(buf, 'sample.pdf', ['pdf']);
    assert.equal(r.ok, true);
    assert.equal(r.format, 'pdf');
});

test('assertFileFormat: .eml uzanti + magic yok ama header var → ok', () => {
    const eml = Buffer.from('From: a@x\r\nTo: b@y\r\nSubject: t\r\n\r\nbody');
    const r = assertFileFormat(eml, 'msg.eml', ['eml']);
    assert.equal(r.ok, true);
});

test('assertFileFormat: spoof — .eml uzanti ama PE icerigi → reddet', () => {
    const buf = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)]);
    const r = assertFileFormat(buf, 'spoof.eml', ['eml','msg','ole2']);
    assert.equal(r.ok, false);
    assert.match(r.reason, /beklenen formatta degil/);
});
