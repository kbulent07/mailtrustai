const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');

function ensureDir() {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) {
            return defaultSettings();
        }

        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        return {
            ...defaultSettings(),
            ...JSON.parse(raw || '{}')
        };
    } catch {
        return defaultSettings();
    }
}

function saveSettings(settings) {
    ensureDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return settings;
}

function defaultSettings() {
    return {
        vtApiKey: '',
        claudeApiKey: '',
        openaiApiKey: '',
        openaiModel: '',   // boşsa openai.js'teki OPENAI_MODEL sabiti kullanılır
        adminPassword: '',
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
        // Webhook / SIEM entegrasyonu
        webhookEnabled: false,
        webhookUrl: '',
        webhookMinLevel: 'low', // safe|low|medium|high — bu seviyeden düşük sonuçlar gönderilmez

        // Lisans fiyat tablosu özelleştirmesi (null = varsayılan fiyatlar)
        customPrices: null
    };
}

module.exports = {
    loadSettings,
    saveSettings
};
