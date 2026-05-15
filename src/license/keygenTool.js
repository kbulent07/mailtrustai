#!/usr/bin/env node
// ============================================================
// KEYGEN TOOL — ECDSA P-256 anahtar çifti üretici + lisans üretici
//
// Kullanım:
//   node src/license/keygenTool.js keypair          → Anahtar çifti üret
//   node src/license/keygenTool.js generate [opts]  → .lic dosyası üret
//   node src/license/keygenTool.js verify <file>    → .lic dosyası doğrula
//   node src/license/keygenTool.js fingerprint       → Bu sunucunun parmak izini göster
//
// Üretilen özel anahtar (private key) GİZLİ tutulmalı, repoya eklenmemeli.
// Genel anahtar (public key) src/license/licenseFile.js içine gömülür.
// ============================================================
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// Parmak izi modülü — bu dosya hem üretici hem de doğrulayıcı olarak çalışır.
// licenseFile.js'e dairesel bağımlılık olmadan kullanmak için doğrudan import edilir.
let fingerprintModule;
try { fingerprintModule = require('./fingerprint'); } catch { fingerprintModule = null; }

// ── ECDSA Anahtar Çifti Üretimi ──────────────────────────────
function generateKeyPair() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    });
    return { privateKey, publicKey };
}

// ── Lisans Üretimi ────────────────────────────────────────────
function buildPayload(opts) {
    const now     = new Date();
    const issued  = opts.issued || now.toISOString().slice(0, 10);
    const expires = opts.expires || (() => {
        const d = new Date(now);
        if (opts.duration === 'Y') d.setFullYear(d.getFullYear() + 1);
        else if (opts.duration === 'T') d.setDate(d.getDate() + 7);
        else d.setMonth(d.getMonth() + 1);
        return d.toISOString().slice(0, 10);
    })();

    const serial = opts.serial || `MSA-${issued.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    return {
        serial,
        company:      opts.company      || '',
        domain:       opts.domain       || '',
        contact:      opts.contact      || '',
        plan:         (opts.plan        || 'ENT').toUpperCase(),
        tier:         (opts.tier        || 'T3').toUpperCase(),
        duration:     (opts.duration    || 'Y').toUpperCase(),
        issued,
        expires,
        fingerprint: opts.fingerprint || null,  // { machineId, installId, hostname }
        monthlyLimit: opts.monthlyLimit ?? null, // null → tier'dan türetilir
        notes:        opts.notes        || '',
    };
}

function signPayload(payload, privateKeyPem) {
    const data = JSON.stringify(payload, null, 0);
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privateKeyPem, 'base64url');
}

function generateLicenseFile(opts, privateKeyPem) {
    const payload   = buildPayload(opts);
    const signature = signPayload(payload, privateKeyPem);
    return { payload, signature };
}

// ── CLI ───────────────────────────────────────────────────────
function printHelp() {
    console.log(`
MailTrustAI Lisans Araçları
===========================

  node keygenTool.js keypair
      Yeni ECDSA P-256 anahtar çifti üretir.
      Private key → stdout (güvenli bir yerde saklayın, repoya EKLEMEYİN)
      Public key  → licenseFile.js'e gömülmek üzere stdout'a yazdırılır.

  node keygenTool.js fingerprint
      Bu sunucunun parmak izini gösterir.
      Müşteriden bu çıktıyı alın, lisans üretirken kullanın.

  node keygenTool.js generate \\
    --company "Firma Adı A.Ş." \\
    --domain  "firma.com" \\
    --contact "it@firma.com" \\
    --plan ENT --tier T3 --duration Y \\
    --machine-id <machine_id> \\
    --install-id <install_id> \\
    --hostname   <hostname> \\
    --private-key /path/to/private.pem \\
    --out /path/to/license.lic

  node keygenTool.js verify /path/to/license.lic
      Lisans dosyasını doğrular (parmak izi kontrolü dahil).
`);
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
        }
    }
    return args;
}

async function main() {
    const [,, command, ...rest] = process.argv;
    const args = parseArgs(rest);

    if (!command || command === 'help') { printHelp(); return; }

    // ── keypair ──────────────────────────────────────────────
    if (command === 'keypair') {
        const { privateKey, publicKey } = generateKeyPair();
        console.log('\n=== ÖZEL ANAHTAR (PRIVATE KEY) — GİZLİ TUTUN ===');
        console.log(privateKey);
        console.log('=== GENEL ANAHTAR (PUBLIC KEY) — licenseFile.js içine göm ===');
        console.log(publicKey);
        console.log('\nÖzel anahtarı güvenli bir konuma kaydedin:');
        console.log('  echo "<private_key>" > /secure/msa-private.pem');
        console.log('\n.env dosyasına public key\'i ekleyin:');
        console.log('  MSA_LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\\n..."');
        return;
    }

    // ── fingerprint ──────────────────────────────────────────
    if (command === 'fingerprint') {
        if (!fingerprintModule) {
            console.error('fingerprint.js yüklenemedi.'); process.exit(1);
        }
        const factors = fingerprintModule.collectFactors();
        const fp      = fingerprintModule.computeFingerprint(factors);
        console.log('\n=== SUNUCU PARMAK İZİ ===');
        console.log(JSON.stringify({ fingerprint: fp, factors }, null, 2));
        console.log('\nBu bilgileri lisans üretimi için satıcınıza iletin.');
        return;
    }

    // ── generate ─────────────────────────────────────────────
    if (command === 'generate') {
        const privateKeyPath = args.privateKey;
        if (!privateKeyPath) { console.error('--private-key zorunlu'); process.exit(1); }
        if (!fs.existsSync(privateKeyPath)) { console.error('Özel anahtar dosyası bulunamadı:', privateKeyPath); process.exit(1); }

        const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');

        const fingerprintFactors = (args.machineId || args.installId || args.hostname)
            ? { machineId: args.machineId || '', installId: args.installId || '', hostname: args.hostname || '' }
            : null;

        const lic = generateLicenseFile({
            company:      args.company,
            domain:       args.domain,
            contact:      args.contact,
            plan:         args.plan,
            tier:         args.tier,
            duration:     args.duration,
            issued:       args.issued,
            expires:      args.expires,
            serial:       args.serial,
            fingerprint:  fingerprintFactors,
            notes:        args.notes,
        }, privateKeyPem);

        const outPath = args.out || `license-${lic.payload.serial}.lic`;
        fs.writeFileSync(outPath, JSON.stringify(lic, null, 2), 'utf8');
        console.log(`\n✅ Lisans üretildi: ${outPath}`);
        console.log(`   Seri No  : ${lic.payload.serial}`);
        console.log(`   Firma    : ${lic.payload.company}`);
        console.log(`   Plan     : ${lic.payload.plan} / ${lic.payload.tier}`);
        console.log(`   Geçerlik : ${lic.payload.issued} → ${lic.payload.expires}`);
        if (lic.payload.fingerprint) {
            console.log(`   Bağlı    : machine-id=${lic.payload.fingerprint.machineId?.slice(0, 8)}... install-id=${lic.payload.fingerprint.installId?.slice(0, 8)}...`);
        }
        return;
    }

    // ── verify ───────────────────────────────────────────────
    if (command === 'verify') {
        const filePath = rest[0] || args.file;
        if (!filePath) { console.error('Dosya yolu belirtin: verify <file>'); process.exit(1); }
        if (!fs.existsSync(filePath)) { console.error('Dosya bulunamadı:', filePath); process.exit(1); }

        // licenseFile modülü yoksa inline doğrula
        let licenseFile;
        try { licenseFile = require('./licenseFile'); } catch { licenseFile = null; }

        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!licenseFile) {
            console.log('Payload:', JSON.stringify(raw.payload, null, 2));
            console.log('(licenseFile.js yüklenemedi — imza doğrulaması atlandı)');
            return;
        }
        const result = licenseFile.validateLicenseFile(raw);
        console.log('\n=== LİSANS DOĞRULAMA ===');
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    console.error('Bilinmeyen komut:', command);
    printHelp();
    process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });

module.exports = { generateKeyPair, generateLicenseFile, buildPayload, signPayload };
