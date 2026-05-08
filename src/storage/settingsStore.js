// ============================================================
// SETTINGS STORE — at-rest encryption ile API anahtarları
//
// Hassas alanlar (API anahtarları, IMAP rapor şifresi vb.) otomatik
// olarak AES-256-CBC ile şifrelenir. Eski (düz) değerler ilk kayıtta
// transparent olarak şifrelenir; encrypt('') = '' (boş kalır).
// ============================================================
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('../imap/connection');

const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');

// Diskte şifreli saklanan alanlar (kök seviye)
const SECRET_FIELDS = ['vtApiKey', 'claudeApiKey', 'openaiApiKey', 'otxApiKey', 'activeLicenseKey'];

// Şifreli string formatı: "iv_hex:ciphertext_hex"
function isEncrypted(v) {
    return typeof v === 'string' && /^[0-9a-f]{32}:[0-9a-f]+$/i.test(v);
}

function safeEncrypt(plain) {
    const s = String(plain || '');
    if (!s) return '';
    if (isEncrypted(s)) return s;
    try { return encrypt(s); } catch { return s; }
}

function safeDecrypt(maybeCipher) {
    const s = String(maybeCipher || '');
    if (!s) return '';
    if (!isEncrypted(s)) return s; // eski/düz değer
    try { return decrypt(s); } catch { return ''; }
}

function ensureDir() {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Diske yazılırken hassas alanları şifrele
function encryptForDisk(settings) {
    const out = { ...settings };
    for (const k of SECRET_FIELDS) {
        if (out[k] !== undefined && out[k] !== null) {
            out[k] = safeEncrypt(out[k]);
        }
    }
    // scanMailboxes içindeki imapPassword/smtpPassword zaten ayrı encrypt ile saklanıyor; dokunma
    return out;
}

// Diskten okunurken hassas alanları çöz
function decryptFromDisk(settings) {
    const out = { ...settings };
    for (const k of SECRET_FIELDS) {
        if (out[k] !== undefined && out[k] !== null) {
            out[k] = safeDecrypt(out[k]);
        }
    }
    return out;
}

function loadSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) {
            return defaultSettings();
        }

        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        return {
            ...defaultSettings(),
            ...decryptFromDisk(parsed)
        };
    } catch {
        return defaultSettings();
    }
}

function saveSettings(settings) {
    ensureDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(encryptForDisk(settings), null, 2), 'utf8');
    return settings;
}

// İlk açılışta düz metin API anahtarlarını şifreli formata yükselt
function migrateToEncrypted() {
    if (!fs.existsSync(SETTINGS_FILE)) return;
    try {
        const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8') || '{}');
        let dirty = false;
        for (const k of SECRET_FIELDS) {
            const v = raw[k];
            if (typeof v === 'string' && v.length > 0 && !isEncrypted(v)) {
                dirty = true;
                break;
            }
        }
        if (dirty) {
            const decrypted = decryptFromDisk(raw); // güvenli — düz metinleri olduğu gibi alır
            saveSettings({ ...defaultSettings(), ...decrypted });
            console.log('[Settings] API anahtarları şifreli formata yükseltildi.');
        }
    } catch { /* sessiz */ }
}

function defaultSettings() {
    return {
        vtApiKey: '',
        claudeApiKey: '',
        openaiApiKey: '',
        openaiModel: '',
        otxApiKey: '',
        activeLicenseKey: '',           // Sunucu tarafında kalıcı saklanan aktif lisans (şifreli)
        activeLicenseSetAt: '',         // ISO tarih
        adminPassword: '',
        customerPassword: '',
        companyProfile: {
            name: '',
            details: '',
            contactInfo: ''
        },
        scanMailboxes: [],
        periodicReports: {
            recipients: [],
            enabledRecipients: [],
            daily: true,
            weekly: true,
            monthly: true,
            lastSent: {}
        },
        webhookEnabled: false,
        webhookUrl: '',
        webhookMinLevel: 'low',
        customPrices: null
    };
}

module.exports = {
    loadSettings,
    saveSettings,
    migrateToEncrypted
};
