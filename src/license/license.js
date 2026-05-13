// ============================================================
// LICENSE ENGINE — Pro / Enterprise plans, scan-count tiers
// Format: MSA-[PLAN]-[TIER]-[DURATION]-[RESELLER]-[DATE]-[CHECKSUM]
// ============================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REVOCATION_FILE = path.join(__dirname, '..', '..', 'data', 'revoked-licenses.json');

// İptal listesi bellek önbelleği — sık disk I/O'sunu önler
// Yazma işlemlerinde otomatik temizlenir (TTL: 60s)
let _revocationCache = null;
let _revocationCacheAt = 0;
const REVOCATION_CACHE_TTL_MS = 60 * 1000;

function _invalidateRevocationCache() {
    _revocationCache = null;
    _revocationCacheAt = 0;
}

function loadRevocationList() {
    const now = Date.now();
    if (_revocationCache && (now - _revocationCacheAt) < REVOCATION_CACHE_TTL_MS) {
        return _revocationCache;
    }
    try {
        const raw = fs.existsSync(REVOCATION_FILE)
            ? JSON.parse(fs.readFileSync(REVOCATION_FILE, 'utf8') || '[]')
            : [];
        _revocationCache = raw;
        _revocationCacheAt = now;
        return raw;
    } catch {
        return [];
    }
}

function saveRevocationList(list) {
    const dir = path.dirname(REVOCATION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REVOCATION_FILE, JSON.stringify(list, null, 2), 'utf8');
    // Önbelleği güncelle
    _revocationCache = list;
    _revocationCacheAt = Date.now();
}

function revokeKey(key) {
    if (!key) return false;
    const list = loadRevocationList();
    if (!list.includes(key)) {
        const updated = [...list, key];
        saveRevocationList(updated);
    }
    return true;
}

function unRevokeKey(key) {
    if (!key) return false;
    const updated = loadRevocationList().filter(k => k !== key);
    saveRevocationList(updated);
    return true;
}

function isRevoked(key) {
    return loadRevocationList().includes(key);
}

let SECRET_KEY = process.env.MSA_LICENSE_SECRET;
if (!SECRET_KEY) {
    if (process.env.NODE_ENV === 'production') {
        console.error('\n[License] FATAL: MSA_LICENSE_SECRET ortam değişkeni tanımlı değil.');
        console.error('[License] Üretim ortamında bu değişken zorunludur. .env dosyasına ekleyin.\n');
        process.exit(1);
    }
    console.warn('[License] WARNING: MSA_LICENSE_SECRET tanımlı değil — güvensiz varsayılan kullanılıyor (yalnızca geliştirme).');
    SECRET_KEY = 'MSA_SECRET_2024_K3Y!@#';
}

const PLANS = { PRO: 'pro', ENT: 'enterprise' };
const TIERS = {
    T1: { monthlyLimit: 50,       label: 'T1 (50/ay)' },
    T2: { monthlyLimit: 100,      label: 'T2 (100/ay)' },
    T3: { monthlyLimit: 250,      label: 'T3 (250/ay)' },
    T4: { monthlyLimit: 500,      label: 'T4 (500/ay)' },
    T5: { monthlyLimit: 1000,     label: 'T5 (1.000/ay)' },
    T6: { monthlyLimit: 2000,     label: 'T6 (2.000/ay)' },
    T7: { monthlyLimit: 5000,     label: 'T7 (5.000/ay)' },
    T8: { monthlyLimit: 10000,    label: 'T8 (10.000/ay)' },
    T9: { monthlyLimit: Infinity, label: 'T9 (10.000+ Sınırsız)' }
};
const DURATIONS = { M: 'monthly', Y: 'yearly', T: 'trial-7day' };
const TRIAL_DAYS = 7;

// Default price table (configurable via /api/prices)
const DEFAULT_PRICES = {
    PRO: {
        T1: { M: 9,   Y: 90   },
        T2: { M: 14,  Y: 140  },
        T3: { M: 24,  Y: 240  },
        T4: { M: 39,  Y: 390  },
        T5: { M: 59,  Y: 590  },
        T6: { M: 89,  Y: 890  },
        T7: { M: 149, Y: 1490 },
        T8: { M: 249, Y: 2490 },
        T9: { M: 0,   Y: 0    }
    },
    ENT: {
        T1: { M: 29,  Y: 290  },
        T2: { M: 39,  Y: 390  },
        T3: { M: 59,  Y: 590  },
        T4: { M: 89,  Y: 890  },
        T5: { M: 129, Y: 1290 },
        T6: { M: 199, Y: 1990 },
        T7: { M: 349, Y: 3490 },
        T8: { M: 599, Y: 5990 },
        T9: { M: 0,   Y: 0    }
    }
};

// Feature access matrix
//   pro        → Tarama Posta Kutusu (scanMailbox)
//   enterprise → Pro features + IMAP browsing + real-time alert + batch + API
const FEATURES = {
    pro: {
        manualUpload: true,
        dailyLimit: Infinity,
        headerAnalysis: true,
        contentAnalysis: 'advanced',
        linkLimit: Infinity,
        attachmentScan: true,
        virusTotal: true,
        pdfReport: true,
        jsonReport: false,
        scanMailbox: true,         // ✅ Pro key feature
        imapConnection: false,
        inboxScan: false,
        autoMonitor: false,
        realtimeAlert: false,      // ❌ Enterprise only
        batchScan: false,
        apiAccess: false
    },
    enterprise: {
        manualUpload: true,
        dailyLimit: Infinity,
        headerAnalysis: true,
        contentAnalysis: 'advanced',
        linkLimit: Infinity,
        attachmentScan: true,
        virusTotal: true,
        pdfReport: true,
        jsonReport: true,
        scanMailbox: true,         // inherited
        imapConnection: true,      // ✅ Enterprise key feature
        inboxScan: true,           // ✅ Enterprise
        autoMonitor: true,         // ✅ Enterprise
        realtimeAlert: true,       // ✅ Enterprise — anlık güvenlik raporu
        batchScan: true,
        apiAccess: true
    }
};

// Lisanssız (key yok / geçersiz) erişim için minimal demo modu
const UNLICENSED_FEATURES = {
    manualUpload: true,
    dailyLimit: 3,
    headerAnalysis: true,
    contentAnalysis: 'basic',
    linkLimit: 5,
    attachmentScan: true,
    virusTotal: false,
    pdfReport: false,
    jsonReport: false,
    scanMailbox: false,
    imapConnection: false,
    inboxScan: false,
    autoMonitor: false,
    realtimeAlert: false,
    batchScan: false,
    apiAccess: false
};
const UNLICENSED_MONTHLY_LIMIT = 30;

function generateChecksum(data) {
    return crypto.createHmac('sha256', SECRET_KEY)
        .update(data).digest('hex').substring(0, 8).toUpperCase();
}

function generateLicenseKey(plan, tier, duration, resellerCode = 'DIRECT', startDate = null) {
    if (!['PRO', 'ENT'].includes(plan)) plan = 'PRO';
    if (!TIERS[tier]) tier = 'T1';
    if (!['M', 'Y', 'T'].includes(duration)) duration = 'M';

    const start = startDate || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    // 6-char hex nonce — aynı gün üretilen toplu anahtarların çakışmasını önler
    const nonce = crypto.randomBytes(3).toString('hex').toUpperCase();
    const payload = `MSA-${plan}-${tier}-${duration}-${resellerCode}-${start}-${nonce}`;
    const checksum = generateChecksum(payload);
    return `${payload}-${checksum}`;
}

function validateLicenseKey(key) {
    try {
        const parts = key.split('-');
        if (parts[0] !== 'MSA' || (parts.length !== 7 && parts.length !== 8)) {
            return { valid: false, error: 'Invalid format' };
        }

        // Eski format (7 parça): MSA-PLAN-TIER-DUR-RESELLER-DATE-CHECKSUM
        // Yeni format (8 parça): MSA-PLAN-TIER-DUR-RESELLER-DATE-NONCE-CHECKSUM
        let plan, tier, duration, reseller, date, checksum, payload;
        if (parts.length === 8) {
            [, plan, tier, duration, reseller, date,, checksum] = parts;
            const nonce = parts[6];
            payload = `MSA-${plan}-${tier}-${duration}-${reseller}-${date}-${nonce}`;
        } else {
            [, plan, tier, duration, reseller, date, checksum] = parts;
            payload = `MSA-${plan}-${tier}-${duration}-${reseller}-${date}`;
        }

        const expectedChecksum = generateChecksum(payload);

        // Timing-safe karşılaştırma — `!==` karakter karakter erken çıkar ve
        // response-time fingerprint'i ile checksum'un byte-by-byte tahmini mümkündür.
        if (checksum.length !== expectedChecksum.length ||
            !crypto.timingSafeEqual(Buffer.from(checksum), Buffer.from(expectedChecksum))) {
            return { valid: false, error: 'Invalid checksum' };
        }

        if (!PLANS[plan]) return { valid: false, error: 'Invalid plan' };
        if (!TIERS[tier]) return { valid: false, error: 'Invalid tier' };
        if (!DURATIONS[duration]) return { valid: false, error: 'Invalid duration' };

        // Revocation kontrolü
        if (isRevoked(key)) {
            return { valid: false, error: 'License revoked' };
        }

        const year = parseInt(date.substring(0, 4));
        const month = parseInt(date.substring(4, 6)) - 1;
        const day = parseInt(date.substring(6, 8));
        const startDate = new Date(year, month, day);
        const expiryDate = new Date(startDate);
        if (duration === 'M') {
            expiryDate.setMonth(expiryDate.getMonth() + 1);
        } else if (duration === 'T') {
            expiryDate.setDate(expiryDate.getDate() + TRIAL_DAYS);
        } else {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        }

        const now = new Date();
        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

        if (now > expiryDate) {
            return {
                valid: false, error: 'License expired',
                plan: PLANS[plan], tier, duration: DURATIONS[duration],
                reseller, startDate: startDate.toISOString(), expiryDate: expiryDate.toISOString(),
                daysLeft: 0
            };
        }

        return {
            valid: true,
            plan: PLANS[plan],
            planCode: plan,
            tier,
            tierInfo: TIERS[tier],
            duration: DURATIONS[duration],
            durationCode: duration,
            reseller,
            startDate: startDate.toISOString(),
            expiryDate: expiryDate.toISOString(),
            features: FEATURES[PLANS[plan]],
            monthlyLimit: TIERS[tier]?.monthlyLimit ?? 50,
            daysLeft,
            expiringSoon: daysLeft <= 7
        };
    } catch (e) {
        return { valid: false, error: 'Parse error: ' + e.message };
    }
}

function generateBatchKeys(plan, tier, duration, count, resellerCode = 'DIRECT') {
    const keys = [];
    for (let i = 0; i < count; i++) {
        keys.push(generateLicenseKey(plan, tier, duration, resellerCode));
    }
    return keys;
}

function getPriceTable(customPrices = null) {
    return customPrices || DEFAULT_PRICES;
}

module.exports = {
    generateLicenseKey, validateLicenseKey, generateBatchKeys,
    getPriceTable, PLANS, TIERS, DURATIONS, FEATURES, DEFAULT_PRICES,
    UNLICENSED_FEATURES, UNLICENSED_MONTHLY_LIMIT, TRIAL_DAYS,
    revokeKey, unRevokeKey, isRevoked, loadRevocationList
};
