// ============================================================
// Unit tests: src/analysis/attachmentAnalyzer.js
// Image false-positive davranışı + skor cap'i.
// ============================================================
const test    = require('node:test');
const assert  = require('node:assert/strict');

const { analyzeAttachments } = require('../../src/analysis/attachmentAnalyzer');

// Yardımcı: minimal geçerli PNG buffer (8-byte signature + IHDR + IEND)
function makePng({ trailing = null, idatBytes = null } = {}) {
    const sig  = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
    const ihdr = Buffer.from([
        0,0,0,13, 0x49,0x48,0x44,0x52,
        0,0,0,1, 0,0,0,1, 8, 6, 0, 0, 0, 0x1F,0x15,0xC4,0x89
    ]);
    const idat = idatBytes
        ? Buffer.concat([Buffer.from([0,0,0,idatBytes.length]), Buffer.from('IDAT'), idatBytes, Buffer.from([0,0,0,0])])
        : Buffer.from([0,0,0,12, 0x49,0x44,0x41,0x54, 0x78,0x9c,0x62,0x00,0x00,0x00,0x00,0x05,0x00,0x01, 0x0d,0x0a,0x2d,0xb4]);
    const iend = Buffer.from([0,0,0,0, 0x49,0x45,0x4E,0x44, 0xAE,0x42,0x60,0x82]);
    const parts = [sig, ihdr, idat, iend];
    if (trailing) parts.push(Buffer.from(trailing));
    return Buffer.concat(parts);
}

test('PNG IDAT içinde rastgele "MZ" / "PK" bytes false-positive üretmez', () => {
    // IDAT'a kasten suspicious-looking bytes koyalım
    const badIdat = Buffer.from('MZ\x90\x00\x03 PK\x03\x04 javascript <script', 'latin1');
    const png = makePng({ idatBytes: badIdat });
    const result = analyzeAttachments([{
        filename: 'logo.png', contentType: 'image/png',
        size: png.length, content: png, contentDisposition: 'inline'
    }]);
    // Inline + image markers içeride değil — finding olmamalı
    const markerFinding = result.findings.find(f => f.message.includes('belirteç tespit edildi'));
    assert.equal(markerFinding, undefined, 'IDAT içinde marker arama YAPILMAMALI (false-positive)');
});

test('PNG trailing payload (IEND sonrası) gerçek tehdit olarak işaretlenir', () => {
    const png = makePng({ trailing: 'PK\x03\x04 ZIP polyglot malicious payload' });
    const result = analyzeAttachments([{
        filename: 'image.png', contentType: 'image/png',
        size: png.length, content: png, contentDisposition: 'attachment'
    }]);
    const trailing = result.findings.find(f => f.message.includes('gizli yük'));
    assert.ok(trailing, 'IEND sonrası payload bulunmalı');
    assert.equal(trailing.severity, 'critical');
});

test('Inline image (cid set) için signature-mismatch info severity ile loglanır, skor düşük', () => {
    const broken = Buffer.from('not-a-real-png', 'utf-8');
    const result = analyzeAttachments([{
        filename: 'logo.png', contentType: 'image/png',
        size: broken.length, content: broken,
        cid: 'logo@signature', contentDisposition: 'inline'
    }]);
    const finding = result.findings.find(f => f.message.includes('imzası uyuşmuyor'));
    assert.ok(finding);
    assert.equal(finding.severity, 'info', 'inline image için severity info olmalı');
    // Skor inline factor (0.25) ile çarpılır → 6 * 0.25 = 1.5 → ~2
    assert.ok(result.score <= 5, `inline image skoru düşük olmalı (got ${result.score})`);
});

test('Çoklu inline image varsa toplam skor cap (IMAGE_FINDING_SCORE_CAP=18) aşılmaz', () => {
    // 10 adet bozuk inline PNG
    const broken = Buffer.from('not-a-png');
    const attachments = Array.from({ length: 10 }, (_, i) => ({
        filename: `icon${i}.png`, contentType: 'image/png',
        size: broken.length, content: broken,
        cid: `icon${i}@sig`, contentDisposition: 'inline'
    }));
    const result = analyzeAttachments(attachments);
    // 10 image × 6 * 0.25 = 15 → cap'in altında
    // ama eğer cap olmasaydı 60 puana ulaşırdı
    assert.ok(result.score <= 18, `image kaynaklı skor cap'i aşmamalı (got ${result.score})`);
});

test('Attachment (inline OLMAYAN) image için skor tam ağırlıkla işlenir', () => {
    const broken = Buffer.from('not-a-png');
    const result = analyzeAttachments([{
        filename: 'photo.png', contentType: 'image/png',
        size: broken.length, content: broken,
        contentDisposition: 'attachment'
    }]);
    const finding = result.findings.find(f => f.message.includes('imzası uyuşmuyor'));
    assert.equal(finding.severity, 'warning', 'gerçek attachment için warning olmalı');
});

test('Logo/icon filename pattern + kucuk boyut inline olarak degerlendirilir', () => {
    const broken = Buffer.from('not-a-png');
    const result = analyzeAttachments([{
        filename: 'company_logo.png', contentType: 'image/png',
        size: broken.length, content: broken,
        contentDisposition: 'attachment'  // explicit inline değil
    }]);
    const finding = result.findings.find(f => f.message.includes('imzası uyuşmuyor'));
    assert.equal(finding.severity, 'info', 'küçük + "logo" filename inline olarak değerlendirilmeli');
});

test('JPEG için marker arama YAPILMAZ (entropy-coded false-positive önleme)', () => {
    // Geçerli JPEG SOI + EOI
    const jpeg = Buffer.concat([
        Buffer.from([0xFF, 0xD8]),                 // SOI
        Buffer.from('MZ\x00 PK\x03\x04 random'),   // entropy-coded mock
        Buffer.from([0xFF, 0xD9])                  // EOI
    ]);
    const result = analyzeAttachments([{
        filename: 'photo.jpg', contentType: 'image/jpeg',
        size: jpeg.length, content: jpeg
    }]);
    const marker = result.findings.find(f => f.message.includes('belirteç'));
    assert.equal(marker, undefined, 'JPEG için marker tarama yapılmamalı');
});
