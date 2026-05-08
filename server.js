require('dotenv').config();
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const WebSocket = require('ws');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const dealerRoutes = require('./src/routes/dealerApi');
const { setupWebSocket } = require('./src/routes/websocket');
const { startBackgroundRefresh } = require('./src/license/remoteValidator');
const { loadSettings, migrateToEncrypted } = require('./src/storage/settingsStore');

// İlk açılışta düz metin API anahtarlarını AES'le şifreli formata yükselt
migrateToEncrypted();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Reverse proxy arkasında doğru IP'yi alabilmek için (X-Forwarded-For). Localhost gate'i için kritik.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// no-cache yalnızca dinamik içerik (API + HTML sayfaları) için. Static asset'ler
// (CSS/JS/PNG) tarayıcı tarafından önbelleklenebilsin → bandwidth ve hız.
app.use((req, res, next) => {
    const url = req.path || req.url || '';
    const isStaticAsset = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)$/i.test(url);
    if (!isStaticAsset) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    maxAge: '1h' // ~1 saat tarayıcı önbelleği; release'lerde URL versionlama yapılırsa daha uzun olabilir
}));

// API Routes
app.use('/api', apiRoutes);
app.use('/api/dealer', dealerRoutes);

// WebSocket
setupWebSocket(wss);

// API 404 — eşleşmeyen /api/* isteklerini JSON ile yanıtla (SPA HTML fallback'e düşmesin)
app.use('/api', (req, res) => {
    res.status(404).json({ error: `API endpoint bulunamadı: ${req.method} ${req.path}` });
});

// SPA fallback — sadece GET isteklerine index.html döndür
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🛡️  MailTrustAI`);
    console.log(`   Server running at http://localhost:${PORT}`);
    console.log(`   Admin/Keygen at http://localhost:${PORT}/keygen.html`);
    console.log(`   Dealer Portal at http://localhost:${PORT}/bayi.html`);
    console.log(`   Press Ctrl+C to stop\n`);

    // Kayıtlı (kalıcı) lisans varsa duruma göre logla — restart/versiyon geçişi sonrası
    try {
        const s = loadSettings();
        if (s.activeLicenseKey) {
            const masked = s.activeLicenseKey.slice(0, 8) + '…' + s.activeLicenseKey.slice(-4);
            const setAt  = s.activeLicenseSetAt ? new Date(s.activeLicenseSetAt).toLocaleString('tr-TR') : 'bilinmiyor';
            const { validateLicenseKey } = require('./src/license/license');
            const validation = validateLicenseKey(s.activeLicenseKey);
            if (validation.valid) {
                console.log(`   [License] Kayıtlı lisans yüklendi: ${masked} (${validation.plan} ${validation.tier}, ${validation.daysLeft} gün)`);
                console.log(`   [License] Aktivasyon tarihi: ${setAt}\n`);
            } else {
                console.warn(`   [License] UYARI: Kayıtlı lisans geçersiz (${validation.error}). Yeniden aktivasyon gerekebilir.\n`);
            }
        }
    } catch { /* sessiz */ }

    // Uzak lisans doğrulama arka plan yenileme
    // MSA_LICENSE_REMOTE_URL .env'de tanımlıysa aktif olur
    if (process.env.MSA_LICENSE_REMOTE_URL) {
        startBackgroundRefresh(() => {
            // Periyodik yenileme için bilinen aktif lisans anahtarlarını döndür
            // (autoMonitor kayıtlarından — IMAP izleme aktif olan anahtarlar)
            try {
                const { listAutoMonitors } = require('./src/storage/autoMonitorState');
                const monitors = listAutoMonitors();
                return monitors.map(m => m.licenseKey).filter(Boolean);
            } catch { return []; }
        });
    } else {
        console.log('   [License] Uzak doğrulama devre dışı (MSA_LICENSE_REMOTE_URL yok).');
    }
});
