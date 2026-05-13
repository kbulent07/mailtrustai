const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { loadSettings, saveSettings } = require('../storage/settingsStore');

// Bu dosya hassas bilgileri (ilk şifreleri) içerir ve ilk girişten sonra silinecektir.
const CREDS_FILE = path.join(__dirname, '..', '..', 'data', 'initial_creds.json');

/**
 * Sunucu her başladığında çalışır.
 * Eğer settings.json içinde şifreler boşsa ve initial_creds.json varsa şifreleri yükler.
 */
async function checkAndSeedInitialPasswords() {
    try {
        if (!fs.existsSync(CREDS_FILE)) return;

        const raw = fs.readFileSync(CREDS_FILE, 'utf8');
        const creds = JSON.parse(raw);
        const settings = loadSettings();
        let updated = false;

        // Admin şifresi ayarlanmamışsa ve dosyada varsa
        if (!settings.adminPassword && creds.adminPassword) {
            console.log('[Setup] İlk Admin şifresi dosyadan yükleniyor...');
            settings.adminPassword = await bcrypt.hash(String(creds.adminPassword), 10);
            updated = true;
        }

        // Müşteri şifresi ayarlanmamışsa ve dosyada varsa
        if (!settings.customerPassword && creds.customerPassword) {
            console.log('[Setup] İlk Müşteri şifresi dosyadan yükleniyor...');
            settings.customerPassword = await bcrypt.hash(String(creds.customerPassword), 10);
            updated = true;
        }

        if (updated) {
            saveSettings(settings);
            console.log('[Setup] İlk şifreler başarıyla tanımlandı.');
        }
    } catch (error) {
        console.error('[Setup] Şifre yükleme hatası:', error.message);
    }
}

/**
 * İlk başarılı girişten sonra bu dosyayı siler.
 */
function cleanupInitialCredsFile() {
    try {
        if (fs.existsSync(CREDS_FILE)) {
            fs.unlinkSync(CREDS_FILE);
            console.log('[Setup] İlk giriş yapıldı, hassas şifre dosyası (initial_creds.json) silindi.');
        }
    } catch (error) {
        console.error('[Setup] Dosya silme hatası:', error.message);
    }
}

module.exports = {
    checkAndSeedInitialPasswords,
    cleanupInitialCredsFile
};
