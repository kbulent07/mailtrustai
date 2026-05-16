// ============================================================
// AYARLAR STORAGE — hassas alanlar makineye özgü AES-256-GCM ile şifrelenir
// Aynı makinede restart'ta otomatik açılır; başka makinede boş döner.
// ============================================================
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');

// ─── ŞİFRELEME ───────────────────────────────────────────────
const ENC_PREFIX = 'enc:v1:';
const SENSITIVE   = ['vtApiKey', 'claudeApiKey', 'openaiApiKey', 'otxApiKey', 'webhookUrl', 'systemSmtpPassword'];

function _deriveKey() {
    const secret   = process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#';
    const hostname = os.hostname();
    // PBKDF2: hostname + secret → 32 byte key (makineye özgü)
    return crypto.pbkdf2Sync(
        `${hostname}::${secret}`,
        'MSA_SETTINGS_SALT_v1',
        100_000,
        32,
        'sha256'
    );
}

let _cachedKey = null;
function _key() {
    if (!_cachedKey) _cachedKey = _deriveKey();
    return _cachedKey;
}

function encryptValue(plaintext) {
    if (!plaintext) return plaintext;
    const iv         = crypto.randomBytes(12);
    const cipher     = crypto.createCipheriv('aes-256-gcm', _key(), iv);
    const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag    = cipher.getAuthTag();
    const payload    = Buffer.concat([iv, authTag, encrypted]);
    return ENC_PREFIX + payload.toString('base64');
}

function decryptValue(stored) {
    if (!stored || !stored.startsWith(ENC_PREFIX)) return stored;
    try {
        const payload  = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
        const iv       = payload.subarray(0, 12);
        const authTag  = payload.subarray(12, 28);
        const data     = payload.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', _key(), iv);
        decipher.setAuthTag(authTag);
        return decipher.update(data) + decipher.final('utf8');
    } catch {
        // Farklı makine / bozuk kayıt → boş döner
        return '';
    }
}

// ─── LOAD / SAVE ─────────────────────────────────────────────
function ensureDir() {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) return defaultSettings();
        const raw  = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const data = { ...defaultSettings(), ...JSON.parse(raw || '{}') };

        // Şifreli alanları çöz
        for (const field of SENSITIVE) {
            if (data[field]) data[field] = decryptValue(data[field]);
        }
        return data;
    } catch {
        return defaultSettings();
    }
}

// Process-içi mutex: aralarına başka bir yazma sızmasın diye saveSettings
// çağrılarını serileştirir (basit Promise chain).
let _saveChain = Promise.resolve();

function saveSettings(settings) {
    // Senkron arayüzü koruyoruz (mevcut callers .then beklemiyor) ama yazımı
    // mutex altında kuyruğa alıyoruz. Race olursa son çağrı kazanır.
    ensureDir();
    const toSave = { ...settings };

    // Hassas alanlar: kullanıcı girişi ENC_PREFIX taşıyorsa (bypass denemesi)
    // bunu plaintext gibi değerlendirme — düzgünce şifrele.
    for (const field of SENSITIVE) {
        const v = toSave[field];
        if (typeof v !== 'string' || v === '') continue;
        if (v.startsWith(ENC_PREFIX)) {
            // Önce decrypt edip plaintext'i çek, sonra tekrar encrypt et.
            // (Geçerli bir encrypted blob ise decrypt başarılı; değilse — yani
            // saldırgan input'u — boş string döner, alan temizlenir.)
            const plain = decryptValue(v);
            toSave[field] = plain ? encryptValue(plain) : '';
        } else {
            toSave[field] = encryptValue(v);
        }
    }

    // Atomic yazım: tmp dosyaya yaz + rename (POSIX'te atomic; Windows'ta da
    // tek dosya için pratikte güvenli — yarım dosyaya kalma riski elimine).
    const json = JSON.stringify(toSave, null, 2);
    const tmp  = SETTINGS_FILE + '.tmp-' + process.pid + '-' + Date.now();

    _saveChain = _saveChain.then(() => new Promise((resolve) => {
        try {
            fs.writeFileSync(tmp, json, { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(tmp, SETTINGS_FILE);
        } catch (e) {
            console.error('[Settings] saveSettings hatası:', e.message);
            try { fs.unlinkSync(tmp); } catch {}
        }
        resolve();
    })).catch(() => {});

    return settings; // orijinali (plaintext) döndür — in-memory state şifreli olmasın
}

function defaultSettings() {
    return {
        vtApiKey:      '',
        claudeApiKey:  '',
        openaiApiKey:  '',
        openaiModel:   '',
        otxApiKey:     '',
        adminPassword: '',
        companyProfile: { name: '', details: '', contactInfo: '' },
        scanMailboxes: [],
        periodicReports: {
            recipients:       [],
            enabledRecipients: [],
            daily:   true,
            weekly:  true,
            monthly: true,
            lastSent: {}
        },
        webhookEnabled:  false,
        webhookUrl:      '',
        webhookMinLevel: 'low',
        customPrices:    null,
        creditRate:      10,
        systemSmtp: {
            host:     '',
            port:     587,
            secure:   false,
            user:     '',
            fromName: 'MailTrustAI'
        },
        systemSmtpPassword: ''
    };
}

module.exports = { loadSettings, saveSettings, encryptValue, decryptValue };
