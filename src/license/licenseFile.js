// ============================================================
// LICENSE FILE — ECDSA P-256 imzalı JSON lisans dosyası motoru
//
// Dosya formatı (license.lic):
//   {
//     "payload": { serial, company, domain, plan, tier, expires,
//                  fingerprint: { machineId, installId, hostname } },
//     "signature": "<base64url ECDSA-SHA256 imzası>"
//   }
//
// Public key öncelik sırası:
//   1. process.env.MSA_LICENSE_PUBLIC_KEY
//   2. data/license-public.pem
//   3. Uygulama içi varsayılan (keygenTool.js keypair çıktısıyla değiştirilmeli)
// ============================================================
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const { verifyFingerprint } = require('./fingerprint');

const DATA_DIR        = path.join(__dirname, '..', '..', 'data');
const LICENSE_FILE    = path.join(DATA_DIR, 'license.lic');
const PUBLIC_KEY_FILE = path.join(DATA_DIR, 'license-public.pem');

// Varsayılan public key — keygenTool.js ile üretilen gerçek anahtarla değiştirilmeli.
// MSA_LICENSE_PUBLIC_KEY env değişkeni veya data/license-public.pem ile override edilir.
const BUILTIN_PUBLIC_KEY = process.env.MSA_LICENSE_PUBLIC_KEY || (() => {
    if (fs.existsSync(PUBLIC_KEY_FILE)) return fs.readFileSync(PUBLIC_KEY_FILE, 'utf8');
    return null;
})();

// Tier → aylık limit eşlemesi (license.js'deki TIERS ile senkron olmalı)
const TIER_LIMITS = {
    T1: 50, T2: 100, T3: 250, T4: 500,
    T5: 1000, T6: 2000, T7: 5000, T8: 10000, T9: Infinity
};

const PLAN_FEATURES = {
    PRO: {
        manualUpload: true, dailyLimit: Infinity, headerAnalysis: true,
        contentAnalysis: 'advanced', linkLimit: Infinity, attachmentScan: true,
        virusTotal: true, pdfReport: true, jsonReport: false,
        scanMailbox: true, imapConnection: false, inboxScan: false,
        autoMonitor: false, realtimeAlert: false, batchScan: false, apiAccess: false
    },
    ENT: {
        manualUpload: true, dailyLimit: Infinity, headerAnalysis: true,
        contentAnalysis: 'advanced', linkLimit: Infinity, attachmentScan: true,
        virusTotal: true, pdfReport: true, jsonReport: true,
        scanMailbox: true, imapConnection: true, inboxScan: true,
        autoMonitor: true, realtimeAlert: true, batchScan: true, apiAccess: true
    }
};

// ── İmza Doğrulama ────────────────────────────────────────────
function verifySignature(payload, signatureB64url, publicKeyPem) {
    try {
        const data   = JSON.stringify(payload, null, 0);
        const verify = crypto.createVerify('SHA256');
        verify.update(data);
        verify.end();
        return verify.verify(publicKeyPem, signatureB64url, 'base64url');
    } catch {
        return false;
    }
}

// ── Süre Kontrolü ─────────────────────────────────────────────
function checkExpiry(payload) {
    if (!payload.expires) return { expired: false, daysLeft: Infinity };
    const expiry   = new Date(payload.expires + 'T23:59:59Z');
    const now      = new Date();
    const daysLeft = Math.ceil((expiry - now) / 86400000);
    return { expired: now > expiry, daysLeft, expiringSoon: daysLeft <= 7 };
}

// ── Ana Doğrulama ─────────────────────────────────────────────
function validateLicenseFile(licObj, opts = {}) {
    const { skipFingerprint = false } = opts;

    if (!licObj || !licObj.payload || !licObj.signature) {
        return { valid: false, error: 'Geçersiz lisans dosyası formatı' };
    }

    const { payload, signature } = licObj;

    // 1. Public key varlık kontrolü
    const pubKey = BUILTIN_PUBLIC_KEY;
    if (!pubKey) {
        return { valid: false, error: 'Public key yapılandırılmamış (MSA_LICENSE_PUBLIC_KEY veya data/license-public.pem)' };
    }

    // 2. ECDSA imza doğrulama
    if (!verifySignature(payload, signature, pubKey)) {
        return { valid: false, error: 'Lisans imzası geçersiz' };
    }

    // 3. Süre kontrolü
    const { expired, daysLeft, expiringSoon } = checkExpiry(payload);
    if (expired) {
        return { valid: false, error: 'Lisans süresi dolmuş', payload, daysLeft: 0 };
    }

    // 4. Parmak izi doğrulama
    let fingerprintResult = null;
    if (!skipFingerprint && payload.fingerprint) {
        fingerprintResult = verifyFingerprint(payload.fingerprint);
        if (!fingerprintResult.valid) {
            return {
                valid: false,
                error: `Parmak izi eşleşmedi (skor: ${fingerprintResult.score}/${fingerprintResult.threshold})`,
                fingerprintResult,
                payload
            };
        }
    }

    // 5. Plan / özellik matrisi
    const planCode = (payload.plan || 'ENT').toUpperCase();
    const features = PLAN_FEATURES[planCode] || PLAN_FEATURES.ENT;
    const tierCode = (payload.tier || 'T3').toUpperCase();
    const monthlyLimit = payload.monthlyLimit ?? TIER_LIMITS[tierCode] ?? 250;

    return {
        valid: true,
        type: 'lic-file',
        serial:       payload.serial,
        company:      payload.company,
        domain:       payload.domain,
        contact:      payload.contact,
        plan:         planCode === 'ENT' ? 'enterprise' : 'pro',
        planCode,
        tier:         tierCode,
        tierInfo:     { monthlyLimit, label: `${tierCode} (${monthlyLimit}/ay)` },
        duration:     payload.duration === 'Y' ? 'yearly' : payload.duration === 'T' ? 'trial-7day' : 'monthly',
        durationCode: payload.duration || 'Y',
        issued:       payload.issued,
        expires:      payload.expires,
        daysLeft,
        expiringSoon,
        features,
        monthlyLimit,
        fingerprintResult,
        notes: payload.notes || '',
    };
}

// ── Dosyadan Yükleme (önbellekli) ────────────────────────────
let _cache     = null;
let _cacheAt   = 0;
const CACHE_TTL = 60 * 1000; // 60 saniye

function loadLicenseFile(filePath = LICENSE_FILE, opts = {}) {
    const now = Date.now();
    if (_cache && (now - _cacheAt) < CACHE_TTL && !opts.force) return _cache;

    if (!fs.existsSync(filePath)) {
        _cache   = null;
        _cacheAt = now;
        return null;
    }

    try {
        const raw    = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const result = validateLicenseFile(raw, opts);
        _cache   = result;
        _cacheAt = now;
        return result;
    } catch (e) {
        console.error('[LicenseFile] Okuma hatası:', e.message);
        _cache   = { valid: false, error: 'Dosya okunamadı: ' + e.message };
        _cacheAt = now;
        return _cache;
    }
}

function invalidateCache() {
    _cache   = null;
    _cacheAt = 0;
}

module.exports = {
    validateLicenseFile,
    loadLicenseFile,
    invalidateCache,
    PLAN_FEATURES,
    TIER_LIMITS,
    LICENSE_FILE,
};
