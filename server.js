require('dotenv').config();
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const WebSocket = require('ws');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const dealerRoutes = require('./src/routes/dealerApi');
const { setupWebSocket } = require('./src/routes/websocket');
const { startBackgroundRefresh } = require('./src/license/remoteValidator');
const { loadSettings } = require('./src/storage/settingsStore');
const { checkAndSeedInitialPasswords } = require('./src/services/initialSetupService');
const customerUserStore = require('./src/storage/customerUserStore');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Müşteri-modu: keygen ve bayi panelleri tamamen kapatılır.
// MSA_CUSTOMER_ONLY=true → /keygen.html, /bayi.html ve /api/dealer/* 404 döner.
const CUSTOMER_ONLY = String(process.env.MSA_CUSTOMER_ONLY || '').toLowerCase() === 'true';

// Reverse proxy arkasında doğru IP'yi alabilmek için (X-Forwarded-For). Localhost gate'i için kritik.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Customer-only: keygen ve bayi panelleri ile dealer API'leri açıkça kapatılır.
// Bu middleware static + route mount'lardan önce çalışmalı.
if (CUSTOMER_ONLY) {
    // Customer modunda kilitlenen lisans-üretici endpoint'leri (admin oturumu olsa bile çağrılamaz)
    const BLOCKED_API = new Set([
        '/api/license/generate',
        '/api/license/batch',
        '/api/license/trial',
        '/api/license/revoke',
        '/api/license/unrevoke',
        '/api/license/revoked',
        '/api/resellers',
        '/api/audit-log'
    ]);
    app.use((req, res, next) => {
        const p = (req.path || '').toLowerCase();
        if (p === '/keygen.html' || p === '/bayi.html' || p.startsWith('/api/dealer')) {
            return res.status(404).send('Not Found');
        }
        for (const blocked of BLOCKED_API) {
            if (p === blocked || p.startsWith(blocked + '/')) {
                return res.status(404).json({ error: 'Bu uç nokta müşteri kurulumunda devre dışı.' });
            }
        }
        next();
    });
    console.log('[Mode] CUSTOMER_ONLY aktif — keygen/bayi panelleri ve lisans-üretici API\'leri devre dışı.');
}

// ─── Security headers (Helmet + CSP) ──────────────────────
// Mevcut frontend bol miktarda inline onclick / style= kullaniyor —
// strict CSP UI'yi kirar. Bu sebeple 'unsafe-inline' izinli ama
// 3rd-party origin script/style/connect engelli (en yaygin XSS vektoru
// olan harici malicious CDN injection'a karsi yine de etkili).
//
// İleride frontend refactor edilirse 'unsafe-inline' kaldirilip
// nonce/hash tabanli politikaya gecilebilir.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src':  ["'self'"],
            'script-src':   ["'self'", "'unsafe-inline'"],
            'style-src':    ["'self'", "'unsafe-inline'"],
            'img-src':      ["'self'", 'data:', 'blob:'],
            'font-src':     ["'self'", 'data:'],
            'connect-src':  ["'self'", 'ws:', 'wss:'],  // WebSocket icin
            'frame-ancestors': ["'none'"],              // clickjacking koruma
            'object-src':   ["'none'"],                 // <object>/<embed> bloklu
            'base-uri':     ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false,  // WebSocket + dis kaynak uyumu
    crossOriginResourcePolicy: { policy: 'same-site' }
}));

// ─── CORS ─────────────────────────────────────────────────
// MSA_ALLOWED_ORIGINS virgulle ayrilmis whitelist (ornek: https://app.x.com,https://admin.x.com)
// Tanimsizsa same-origin/no-Origin disinda istekler reddedilir.
// "*" verilirse tum origin'lere izin verilir (sadece dev/test icin onerilir).
const ALLOWED_ORIGINS = String(process.env.MSA_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
    origin(origin, cb) {
        // Tarayici disi/same-origin istekler (origin yok) her zaman gecer.
        if (!origin) return cb(null, true);
        if (ALLOWED_ORIGINS.includes('*')) return cb(null, true);
        if (ALLOWED_ORIGINS.length === 0)   return cb(null, false); // default deny
        if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        return cb(null, false);
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With']
}));
if (ALLOWED_ORIGINS.length === 0) {
    console.log('[Security] CORS: same-origin only (MSA_ALLOWED_ORIGINS tanimsiz).');
} else {
    console.log(`[Security] CORS whitelist: ${ALLOWED_ORIGINS.join(', ')}`);
}

// Middleware
// JSON: 50mb → 5mb (buyuk dosya zaten multer üzerinden geliyor; .eml metin
// payload'ı icin 5mb yeterli). MSA_JSON_BODY_LIMIT ile override edilebilir.
// urlencoded form body kucuk olmali — DoS/ReDoS vektorunu daraltir.
const JSON_LIMIT = process.env.MSA_JSON_BODY_LIMIT || '5mb';
const URL_LIMIT  = process.env.MSA_URL_BODY_LIMIT  || '200kb';
app.use(express.json({ limit: JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: URL_LIMIT }));

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
    // maxAge:0 + etag:true → tarayıcı her seferinde If-None-Match ile sorar,
    // değişmemişse server 304 Not Modified döner (cache'lenmiş kopyayı kullanır,
    // ama her zaman güncel). Değişmişse 200 ile yeni dosyayı alır. Hot-fix anında
    // propagate eder; yalnızca trafik küçük bir gecikme yaşar.
    maxAge: 0,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
}));

// ─── Rate limiting ────────────────────────────────────────
// Iki katmanli koruma: genel API icin yumusak, analyze/* icin sert.
// MSA_DISABLE_RATE_LIMIT=true ile testlerde devre dist birakilabilir.
const RATE_LIMIT_DISABLED = String(process.env.MSA_DISABLE_RATE_LIMIT || '').toLowerCase() === 'true';

if (!RATE_LIMIT_DISABLED) {
    const globalLimiter = rateLimit({
        windowMs:        15 * 60 * 1000, // 15 dk
        max:             Number(process.env.MSA_RATE_LIMIT_GLOBAL_MAX) || 300,
        standardHeaders: true,
        legacyHeaders:   false,
        message:         { error: 'Cok fazla istek — kisa bir sure sonra tekrar deneyin.' }
    });

    // Analyze cagrilari maliyetli (LLM + VT) ve buyuk payload alir → daha sert
    const analyzeLimiter = rateLimit({
        windowMs:        5 * 60 * 1000,  // 5 dk
        max:             Number(process.env.MSA_RATE_LIMIT_ANALYZE_MAX) || 30,
        standardHeaders: true,
        legacyHeaders:   false,
        message:         { error: 'Analiz hizi limiti asildi — 5 dk sonra tekrar deneyin.' }
    });

    app.use('/api/analyze', analyzeLimiter);
    app.use('/api', globalLimiter);
    console.log('[Security] Rate limit aktif (global 300/15dk, analyze 30/5dk).');
} else {
    console.warn('[Security] UYARI: MSA_DISABLE_RATE_LIMIT=true — rate limit kapali.');
}

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

// İlk şifre seed işlemi tamamlanmadan listen edilmemeli — aksi halde
// startup'tan hemen sonra login denemeleri 403 alabilir.
(async () => {
    try {
        await checkAndSeedInitialPasswords();
    } catch (e) {
        console.error('[Setup] İlk şifre seed işlemi başarısız:', e.message);
    }
    // Eski settings.customerPassword → DB'deki customer_users tablosuna admin olarak taşı
    try {
        await customerUserStore.migrateFromLegacySettings();
    } catch (e) {
        console.error('[Setup] customer_users migration başarısız:', e.message);
    }
    startListening();
})();

function startListening() {
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
}
