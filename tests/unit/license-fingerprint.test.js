// ============================================================
// Lisans + Fingerprint Entegrasyon Testleri
// ============================================================
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

// Test izolasyonu: geçici data dizini kullan
const TEST_DATA_DIR = path.join(os.tmpdir(), 'msa-test-' + crypto.randomBytes(4).toString('hex'));
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

// Modüller require edilmeden önce env'i ayarla
process.env.HOST_HOSTNAME    = 'test-host-001';
process.env.HOST_MACHINE_ID  = 'fake-host-machine-id-12345';
process.env.HOST_SYSTEM_UUID = 'fake-system-uuid-67890';

// Modülleri yükle (require önbelleğini temizleyebilmek için absolute path)
const FP_PATH      = require.resolve('../../src/license/fingerprint');
const LF_PATH      = require.resolve('../../src/license/licenseFile');
const KT_PATH      = require.resolve('../../src/license/keygenTool');

// Test sayacı
let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (e) {
        console.error(`❌ ${name}\n   ${e.message}`);
        if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
        failed++;
    }
}
function assert(cond, msg = 'assertion failed') {
    if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
    if (a !== b) throw new Error(`${msg || 'eşit değil'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

// ── Test setup ───────────────────────────────────────────────
const fingerprint = require(FP_PATH);
const licenseFile = require(LF_PATH);
const keygenTool  = require(KT_PATH);

// ── 1. ECDSA anahtar çifti üretimi ──────────────────────────
test('ECDSA P-256 anahtar çifti üretilir', () => {
    const { privateKey, publicKey } = keygenTool.generateKeyPair();
    assert(privateKey.includes('BEGIN PRIVATE KEY'), 'private key PEM formatında değil');
    assert(publicKey.includes('BEGIN PUBLIC KEY'), 'public key PEM formatında değil');
});

const { privateKey, publicKey } = keygenTool.generateKeyPair();
process.env.MSA_LICENSE_PUBLIC_KEY = publicKey;

// Modül cache'ini temizle, licenseFile yeniden yüklensin (yeni public key ile)
delete require.cache[LF_PATH];
const licenseFile2 = require(LF_PATH);

// ── 2. Fingerprint toplama ──────────────────────────────────
test('buildFingerprintJson standart formatı üretir', () => {
    const fp = fingerprint.buildFingerprintJson();
    eq(fp.fingerprint_version, 1, 'fingerprint_version yanlış');
    eq(fp.type, 'docker-host', 'type yanlış');
    assert(['linux', 'windows'].includes(fp.platform), 'platform geçersiz');
    assert(fp.generated_at, 'generated_at yok');
    assert(fp.signals, 'signals yok');
    assert(fp.signals.install_id_hash?.startsWith('sha256:'), 'install_id_hash formatı yanlış');
    assert(fp.signals.os_machine_id_hash?.startsWith('sha256:'), 'os_machine_id_hash formatı yanlış');
});

// ── 3. Skor modeli — tüm sinyaller eşleşir ──────────────────
test('Tüm sinyaller eşleşir → skor 11, geçerli', () => {
    const fp1 = fingerprint.buildFingerprintJson();
    const fp2 = fingerprint.buildFingerprintJson();
    const result = fingerprint.scoreMatch(fp1, fp2);
    eq(result.valid, true, 'geçerli olmalıydı');
    eq(result.score, 11, 'skor 11 olmalıydı (4+4+3)');
});

// ── 4. Skor modeli — hostname değişti (skor değişmez, sadece bayrak) ──
test('Sadece hostname değişti → hâlâ geçerli (0 puan etkisi)', () => {
    const fp1 = fingerprint.buildFingerprintJson();
    const fp2 = JSON.parse(JSON.stringify(fp1));
    fp2.signals.hostname_hash = 'sha256:degisik-hostname-hash';
    const result = fingerprint.scoreMatch(fp1, fp2);
    eq(result.valid, true, 'hostname değişikliği lisansı bozmamalı');
    eq(result.score, 11, 'skor değişmemeli');
    eq(result.hostnameChanged, true, 'hostnameChanged true olmalıydı');
});

// ── 5. Skor modeli — system_uuid yok (opsiyonel) ────────────
test('system_uuid eşleşmiyor → skor 8, hâlâ geçerli', () => {
    const fp1 = fingerprint.buildFingerprintJson();
    const fp2 = JSON.parse(JSON.stringify(fp1));
    fp2.signals.system_uuid_hash = 'sha256:farkli-uuid';
    const result = fingerprint.scoreMatch(fp1, fp2);
    eq(result.valid, true, 'system_uuid opsiyonel olmalı');
    eq(result.score, 8, 'skor 4+4=8 olmalıydı');
});

// ── 6. Skor modeli — install_id eşleşmedi (zorunlu) ─────────
test('install_id eşleşmedi → geçersiz (zorunlu)', () => {
    const fp1 = fingerprint.buildFingerprintJson();
    const fp2 = JSON.parse(JSON.stringify(fp1));
    fp2.signals.install_id_hash = 'sha256:farkli-install';
    const result = fingerprint.scoreMatch(fp1, fp2);
    eq(result.valid, false, 'install_id zorunlu olmalı');
    assert(result.missing.includes('install_id'), 'missing içinde install_id olmalı');
});

// ── 7. Skor modeli — os_machine_id eşleşmedi (zorunlu) ──────
test('os_machine_id eşleşmedi → geçersiz (zorunlu)', () => {
    const fp1 = fingerprint.buildFingerprintJson();
    const fp2 = JSON.parse(JSON.stringify(fp1));
    fp2.signals.os_machine_id_hash = 'sha256:farkli-machine';
    const result = fingerprint.scoreMatch(fp1, fp2);
    eq(result.valid, false, 'os_machine_id zorunlu olmalı');
    assert(result.missing.includes('os_machine_id'), 'missing içinde os_machine_id olmalı');
});

// ── 8. Lisans üretimi ve doğrulama (happy path) ─────────────
test('Lisans üretilir, imza + fingerprint doğrulanır', () => {
    const fp = fingerprint.buildFingerprintJson();
    const lic = keygenTool.generateLicenseFile({
        company: 'Test Firma A.Ş.',
        domain: 'test.com',
        plan: 'ENT', tier: 'T3', duration: 'Y',
        fingerprint: fp,
    }, privateKey);

    assert(lic.payload.serial, 'serial yok');
    eq(lic.payload.company, 'Test Firma A.Ş.', 'company yanlış');
    eq(lic.payload.plan, 'ENT', 'plan yanlış');
    assert(lic.signature, 'signature yok');

    const result = licenseFile2.validateLicenseFile(lic);
    eq(result.valid, true, 'geçerli olmalıydı: ' + result.error);
    eq(result.company, 'Test Firma A.Ş.', 'company doğru taşınmadı');
    eq(result.tierInfo.monthlyLimit, 250, 'T3 limiti 250 olmalı');
    assert(result.features.imapConnection, 'ENT planı IMAP içermeli');
});

// ── 9. İmza kurcalandı → geçersiz ───────────────────────────
test('Payload kurcalandı → imza geçersiz', () => {
    const fp = fingerprint.buildFingerprintJson();
    const lic = keygenTool.generateLicenseFile({
        company: 'X', plan: 'ENT', tier: 'T3', duration: 'Y', fingerprint: fp,
    }, privateKey);
    // Tier'ı kurcala (sınırı artırmaya çalış)
    lic.payload.tier = 'T9';
    const result = licenseFile2.validateLicenseFile(lic);
    eq(result.valid, false, 'kurcalanmış payload geçersiz olmalı');
    assert(/imza/i.test(result.error), 'hata mesajı imza ile ilgili olmalı');
});

// ── 10. Farklı makinenin fingerprint'i → geçersiz ───────────
test('Başka makinenin fingerprint\'i ile lisans → parmak izi reddi', () => {
    const otherFp = {
        fingerprint_version: 1,
        type: 'docker-host',
        platform: 'linux',
        generated_at: new Date().toISOString(),
        signals: {
            install_id_hash:    'sha256:baska-makinenin-install-id',
            os_machine_id_hash: 'sha256:baska-makinenin-machine-id',
            system_uuid_hash:   null,
            hostname_hash:      'sha256:baska-hostname',
        },
    };
    const lic = keygenTool.generateLicenseFile({
        company: 'X', plan: 'ENT', tier: 'T3', duration: 'Y', fingerprint: otherFp,
    }, privateKey);

    const result = licenseFile2.validateLicenseFile(lic);
    eq(result.valid, false, 'farklı makineye üretilmiş lisans geçersiz olmalı');
    assert(/parmak|zorunlu/i.test(result.error), 'hata parmak izi ile ilgili olmalı');
});

// ── 11. Süresi dolmuş lisans → geçersiz ─────────────────────
test('Süresi dolmuş lisans → geçersiz', () => {
    const fp = fingerprint.buildFingerprintJson();
    const lic = keygenTool.generateLicenseFile({
        company: 'X', plan: 'ENT', tier: 'T3', duration: 'Y',
        issued: '2020-01-01', expires: '2021-01-01',
        fingerprint: fp,
    }, privateKey);

    const result = licenseFile2.validateLicenseFile(lic);
    eq(result.valid, false, 'süresi dolmuş lisans geçersiz olmalı');
    assert(/süre/i.test(result.error), 'hata süre ile ilgili olmalı');
});

// ── 12. Fingerprint'siz lisans (skipFingerprint=true) ───────
test('skipFingerprint ile fingerprint kontrolü atlanır', () => {
    const lic = keygenTool.generateLicenseFile({
        company: 'X', plan: 'PRO', tier: 'T1', duration: 'M',
        fingerprint: null,
    }, privateKey);
    const result = licenseFile2.validateLicenseFile(lic, { skipFingerprint: true });
    eq(result.valid, true, 'fingerprint\'siz lisans skip ile geçerli olmalı');
    eq(result.planCode, 'PRO', 'plan PRO olmalı');
});

// ── Cleanup ──────────────────────────────────────────────────
fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });

console.log(`\n${passed} başarılı, ${failed} başarısız.`);
process.exit(failed > 0 ? 1 : 0);
