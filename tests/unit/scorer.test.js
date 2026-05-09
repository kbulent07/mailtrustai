// ============================================================
// Unit tests: src/analysis/scorer.js
// Saf fonksiyonlar — yan etkisiz.
// ============================================================
const test   = require('node:test');
const assert = require('node:assert/strict');

const { calculateScore, resolveLevel, scoreToLevel, levelMeta } =
    require('../../src/analysis/scorer');

test('scoreToLevel: 0..100 araligini dogru bantlara boler', () => {
    assert.equal(scoreToLevel(0),   'safe');
    assert.equal(scoreToLevel(25),  'safe');
    assert.equal(scoreToLevel(26),  'low');
    assert.equal(scoreToLevel(50),  'low');
    assert.equal(scoreToLevel(51),  'medium');
    assert.equal(scoreToLevel(75),  'medium');
    assert.equal(scoreToLevel(76),  'high');
    assert.equal(scoreToLevel(100), 'high');
});

test('levelMeta: her seviye için renk + TR/EN etiket döner', () => {
    assert.deepEqual(levelMeta('safe'),   { color: '#00e676', labelTR: 'Güvenli',     labelEN: 'Safe' });
    assert.deepEqual(levelMeta('low'),    { color: '#ffea00', labelTR: 'Düşük Risk',  labelEN: 'Low Risk' });
    assert.deepEqual(levelMeta('medium'), { color: '#ff9100', labelTR: 'Orta Risk',   labelEN: 'Medium Risk' });
    assert.deepEqual(levelMeta('high'),   { color: '#ff1744', labelTR: 'Yüksek Risk', labelEN: 'High Risk' });
});

test('levelMeta: bilinmeyen seviye için safe fallback', () => {
    const meta = levelMeta('unknown');
    assert.equal(meta.labelTR, 'Güvenli');
});

test('resolveLevel: VirusTotal critical → high', () => {
    const lvl = resolveLevel(20, [
        { category: 'virusTotal', severity: 'critical', message: 'malicious file' }
    ]);
    assert.equal(lvl, 'high');
});

test('resolveLevel: VirusTotal warning → low (skor düşük olsa bile)', () => {
    const lvl = resolveLevel(10, [
        { category: 'virusTotal', severity: 'warning', message: 'suspicious file' }
    ]);
    assert.equal(lvl, 'low');
});

test('resolveLevel: OTX malicious → high', () => {
    const lvl = resolveLevel(15, [
        { category: 'otx', severity: 'critical', message: 'OTX: malicious indicator' }
    ]);
    assert.equal(lvl, 'high');
});

test('resolveLevel: critical attachment → medium', () => {
    const lvl = resolveLevel(20, [
        { category: 'attachment', severity: 'critical', message: 'Şüpheli ek' }
    ]);
    assert.equal(lvl, 'medium');
});

test('resolveLevel: gateway-quarantined attachment → high', () => {
    const lvl = resolveLevel(0, [
        { category: 'attachment', severity: 'critical', message: 'zararlı olarak karantinaya alındı' }
    ]);
    assert.equal(lvl, 'high');
});

test('resolveLevel: AI verdict critical+high confidence → high', () => {
    const lvl = resolveLevel(10, [
        { category: 'ai', severity: 'critical', message: 'AI verdict: phishing / high (85% confidence)' }
    ]);
    assert.equal(lvl, 'high');
});

test('resolveLevel: AI verdict medium fraud + 2 red flags → medium', () => {
    const lvl = resolveLevel(10, [
        { category: 'ai', severity: 'warning', message: 'AI verdict: bec / medium (80% confidence)' },
        { category: 'ai', severity: 'warning', message: 'AI uyarı: Şüpheli IBAN değişikliği' },
        { category: 'ai', severity: 'warning', message: 'AI uyarı: Aciliyet dili kullanılmış' }
    ]);
    assert.equal(lvl, 'medium');
});

test('resolveLevel: hiçbir finding yoksa skora göre belirlenir', () => {
    assert.equal(resolveLevel(15, []), 'safe');
    assert.equal(resolveLevel(40, []), 'low');
    assert.equal(resolveLevel(60, []), 'medium');
    assert.equal(resolveLevel(90, []), 'high');
});

test('calculateScore: skor toplamı 100 ile sınırlandırılır', () => {
    const result = calculateScore(
        { findings: [], score: 40 },
        { findings: [], score: 30 },
        { findings: [], score: 30 },
        { findings: [], score: 30 }
    );
    assert.equal(result.score, 100); // 130 → 100
});

test('calculateScore: findings birleştirir + summary üretir', () => {
    const result = calculateScore(
        { findings: [{ severity: 'critical', category: 'header', message: 'x' }], score: 10 },
        { findings: [{ severity: 'warning',  category: 'content', message: 'y' }], score: 5 },
        { findings: [{ severity: 'safe',     category: 'link',    message: 'z' }], score: 0 },
        { findings: [], score: 0 }
    );
    assert.equal(result.findings.length, 3);
    assert.equal(result.summary.critical, 1);
    assert.equal(result.summary.warning, 1);
    assert.equal(result.summary.safe, 1);
    assert.equal(result.summary.total, 3);
});

test('calculateScore: breakdown her kaynaktan skor verir', () => {
    const result = calculateScore(
        { findings: [], score: 12 },
        { findings: [], score: 8 },
        { findings: [], score: 4 },
        { findings: [], score: 2 }
    );
    assert.deepEqual(result.breakdown, { header: 12, content: 8, link: 4, attachment: 2 });
    assert.equal(result.score, 26);
});
