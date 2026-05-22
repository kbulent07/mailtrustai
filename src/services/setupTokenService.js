'use strict';
// ============================================================
// İLK KURULUM TOKEN GARANTÖRÜ
//
// Müşteri uygulaması ilk admin kullanıcısını oluştururken, localhost
// dışından erişimde MSA_SETUP_TOKEN gerektirir (customer.routes.js
// /customer/setup hijack koruması). Install scriptleri bu token'ı .env'e
// otomatik yazar; ancak manuel docker-compose yolunda (.env.docker boş
// MSA_SETUP_TOKEN ile) token olmadan kalan kurulumlar 403 alır.
//
// Bu servis boot'ta şu garantiyi verir:
//   1) Admin zaten varsa → kurulum bitmiş, token gereksiz (no-op).
//   2) MSA_SETUP_TOKEN env'den geldiyse → onu kullan (kalıcı yazma).
//   3) Aksi halde → data/setup-token'dan oku; yoksa kriptografik üret + yaz.
// process.env.MSA_SETUP_TOKEN her durumda set edilir ki request anında
// customer.routes.js doğrulayabilsin. Setup URL'i log'a basılır.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const customerUserStore = require('../storage/customerUserStore');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'setup-token');

function _log(logger, level, ...args) {
    const fn = (logger && typeof logger[level] === 'function') ? logger[level] : console.log;
    fn(...args);
}

function _logSetupUrl(logger, port, token, source) {
    const p = port || process.env.PORT || 3000;
    _log(logger, 'info', '============================================================');
    _log(logger, 'info', '🔑 İLK KURULUM — admin kullanıcısı oluşturmak için bu URL\'i açın:');
    _log(logger, 'info', `   http://localhost:${p}/?setup_token=${token}`);
    _log(logger, 'info', `   (token kaynağı: ${source}) — admin oluşturulunca otomatik geçersiz olur.`);
    _log(logger, 'info', '============================================================');
}

/**
 * @param {{port?:number, logger?:object}} [opts]
 * @returns {{generated:boolean, token?:string, source?:string, reason?:string, error?:string}}
 */
function ensureSetupToken(opts = {}) {
    const { port, logger } = opts;
    try {
        // 1) Admin zaten varsa kurulum tamamlanmış — token üretme/loglama.
        let hasAdmin = false;
        try { hasAdmin = customerUserStore.countActiveAdmins() > 0; } catch (_) { /* DB henüz yok */ }
        if (hasAdmin) return { generated: false, reason: 'admin-exists' };

        // 2) Env'den token geldiyse onu kullan (install scripti veya manuel .env).
        const envToken = String(process.env.MSA_SETUP_TOKEN || '').trim();
        if (envToken) {
            _logSetupUrl(logger, port, envToken, 'env');
            return { generated: false, token: envToken, source: 'env' };
        }

        // 3) Kalıcı dosyadan oku; yoksa üret + yaz (data volume'de persist).
        let token = '';
        try {
            if (fs.existsSync(TOKEN_FILE)) token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        } catch (_) { /* okunamazsa yeniden üret */ }

        let generated = false;
        if (!token) {
            token = crypto.randomBytes(24).toString('hex');
            try {
                fs.mkdirSync(DATA_DIR, { recursive: true });
                fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
            } catch (e) {
                _log(logger, 'warn', '[Setup] setup-token dosyaya yazılamadı (bellekte kullanılır):', e.message);
            }
            generated = true;
        }

        process.env.MSA_SETUP_TOKEN = token;
        _logSetupUrl(logger, port, token, generated ? 'generated' : 'file');
        return { generated, token, source: generated ? 'generated' : 'file' };
    } catch (e) {
        _log(logger, 'error', '[Setup] ensureSetupToken hatası:', e.message);
        return { generated: false, error: e.message };
    }
}

/**
 * Admin oluşturulduktan sonra kalıcı setup-token dosyasını sil — sızıntı yüzeyini kapat.
 * (customer.routes.js başarılı /customer/setup sonrası çağırabilir; çağrılmazsa
 * zararsız: admin varken ensureSetupToken zaten no-op döner.)
 */
function clearPersistedSetupToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
    } catch (_) { /* sessiz */ }
}

module.exports = { ensureSetupToken, clearPersistedSetupToken, TOKEN_FILE };
