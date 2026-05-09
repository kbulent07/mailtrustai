// ============================================================
// Unit tests: src/analysis/linkAnalyzer.js
// Yeni davranış: image-anchor trap, brand mismatch, typosquat,
// sender-domain whitelist, dedup, cap.
// ============================================================
const test    = require('node:test');
const assert  = require('node:assert/strict');

const {
    analyzeLinks, detectTyposquat,
    findImageAnchorTraps, findBrandTextMismatch, levenshtein
} = require('../../src/analysis/linkAnalyzer');

test('levenshtein: temel durumlar', () => {
    assert.equal(levenshtein('paypal', 'paypal'), 0);
    assert.equal(levenshtein('paypal', 'paypa1'), 1);   // a → 1
    assert.equal(levenshtein('paypal', 'payppal'), 1);  // ekleme
    assert.equal(levenshtein('paypal', 'aypal'), 1);    // silme
    // uzunluk farki > 3 → erken cikis (99 sentinel)
    assert.equal(levenshtein('paypal', 'wayoffmark'), 99);
});

test('detectTyposquat: paypa1.com paypal.com a yakin (mesafe 1)', () => {
    const brands = [['paypal.com', 'paypal'], ['microsoft.com', 'microsoft']];
    const r = detectTyposquat('paypa1.com', brands);
    assert.ok(r);
    assert.equal(r.fakeDomain, 'paypa1.com');
    assert.equal(r.realDomain, 'paypal.com');
    assert.equal(r.distance, 1);
});

test('detectTyposquat: gercek paypal.com bilinen → null', () => {
    const brands = [['paypal.com', 'paypal']];
    assert.equal(detectTyposquat('paypal.com', brands), null);
    assert.equal(detectTyposquat('account.paypal.com', brands), null); // subdomain OK
});

test('detectTyposquat: cok kisa label (≤3 char) ignore edilir', () => {
    const brands = [['ax.com', 'ax']];
    assert.equal(detectTyposquat('xx.com', brands), null);
});

test('findImageAnchorTraps: img src farkli + href suspicious TLD = trap', () => {
    const html = `<a href="http://phish.tk/login"><img src="http://cdn.legit.com/logo.png" /></a>`;
    const traps = findImageAnchorTraps(html, '');
    assert.equal(traps.length, 1);
    assert.equal(traps[0].hrefDomain, 'phish.tk');
});

test('findImageAnchorTraps: ayni domain → trap degil', () => {
    const html = `<a href="https://example.com/page"><img src="https://example.com/logo.png" /></a>`;
    const traps = findImageAnchorTraps(html, '');
    assert.equal(traps.length, 0);
});

test('findImageAnchorTraps: sender domaine giden link → trap degil', () => {
    const html = `<a href="https://acme.com/profile"><img src="https://cdn.imgix.net/avatar.png" /></a>`;
    const traps = findImageAnchorTraps(html, 'acme.com');
    // Same as sender → ignored even if img is different
    assert.equal(traps.length, 0);
});

test('findImageAnchorTraps: href IP-tabanli + farkli img domain = trap', () => {
    const html = `<a href="http://192.168.1.1/admin"><img src="https://cdn.example.com/icon.png" /></a>`;
    const traps = findImageAnchorTraps(html, '');
    assert.equal(traps.length, 1);
});

test('analyzeLinks: sender domain ile ayni linkler notr (puan eklemez)', () => {
    const result = analyzeLinks({
        from: [{ address: 'noreply@example.com' }],
        text: 'https://example.com/page1 https://example.com/page2',
        html: '<a href="https://example.com/page1">Link1</a><a href="https://example.com/page2">Link2</a>'
    });
    assert.equal(result.score, 0);
    // safe finding olmali
    assert.ok(result.findings.some(f => f.severity === 'safe'));
});

test('analyzeLinks: TLD cezasi cap=2 (ayni email cok suspect TLD link)', () => {
    const text = 'http://a.tk http://b.ml http://c.xyz http://d.click http://e.top';
    const result = analyzeLinks({
        from: [{ address: 'attacker@phish.com' }],
        text, html: ''
    });
    // Her biri farkli TLD bir kez eklenmeli ama cap=2 → en fazla 2 tld findings
    const tldFindings = result.findings.filter(f => f.message.includes('TLD'));
    assert.ok(tldFindings.length <= 2, `cap=2 calismali, gercek=${tldFindings.length}`);
});

test('analyzeLinks: shortener cap=2', () => {
    const text = 'http://bit.ly/a http://t.co/b http://tinyurl.com/c http://goo.gl/d';
    const result = analyzeLinks({
        from: [{ address: 'a@b.com' }],
        text, html: ''
    });
    const sf = result.findings.filter(f => f.message.includes('kisaltici') || f.message.includes('kısaltıcı'));
    assert.ok(sf.length <= 2);
});

test('analyzeLinks: IP URL her zaman critical (cap yok)', () => {
    const result = analyzeLinks({
        from: [{ address: 'a@b.com' }],
        text: 'http://1.2.3.4/a http://5.6.7.8/b',
        html: ''
    });
    const ipFindings = result.findings.filter(f => f.message.includes('IP tabanli') || f.message.includes('IP tabanlı'));
    assert.equal(ipFindings.length, 2);
});

test('analyzeLinks: ayni domain icin ayni uyari iki kere puanlanmaz (dedup)', () => {
    const result = analyzeLinks({
        from: [{ address: 'a@b.com' }],
        text: 'http://bad.tk/path1 http://bad.tk/path2 http://bad.tk/path3',
        html: ''
    });
    const tldFindings = result.findings.filter(f => f.message.includes('TLD'));
    assert.equal(tldFindings.length, 1, 'ayni domain icin tek finding');
});
