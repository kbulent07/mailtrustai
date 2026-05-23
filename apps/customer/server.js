'use strict';
require('dotenv').config();

// ============================================================
// MailTrustAI — CUSTOMER (self-hosted)
// Bu uygulama bayi paneli, keygen veya lisans üretici route'ları
// içermez. Merkezi sunucu ile SADECE lisans/heartbeat/policy/list/
// API-policy sync amacıyla haberleşir.
// ============================================================

// Customer-only mod zorlayıcı: env ne olursa olsun bu binary customer'dır.
process.env.MSA_CUSTOMER_ONLY = 'true';

const express = require('express');
const http = require('http');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const WebSocket = require('ws');
const path = require('path');

// Workspace paketleri
const { logger, env, envBool, envInt, APP, asyncH, safeJSONReviver, hardenPrototypes, installShutdownHandlers } = require('@mailtrustai/shared');

hardenPrototypes();
const licenseClient = require('@mailtrustai/license-client');
const centralSync   = require('@mailtrustai/central-sync');
const policyClient  = require('@mailtrustai/policy-client');

// Customer-only kod artık `@mailtrustai/customer-core` paketinden gelir.
// (Fiziksel dosyalar şimdilik repo-root src/ altında — bridge pattern.)
const core = require('@mailtrustai/customer-core');
const customerApi = express.Router();
const { setupWebSocket } = core.websocket();
const { loadSettings } = core.storage.settingsStore();
const { checkAndSeedInitialPasswords } = core.services.initialSetup();
const { ensureSetupToken } = core.services.setupToken();
const customerUserStore = core.storage.customerUserStore();
const metaRoutes = core.routes.meta();
const analyzeRoutes = core.routes.analyze();
const imapRoutes = core.routes.imap();
const monitorRoutes = core.routes.monitor();
const reportsRoutes = core.routes.reports();
const listsRoutes = core.routes.lists();
const statsRoutes = core.routes.stats();
const customerAuthRoutes = core.routes.customer();
const customerUsersRoutes = core.routes.customerUsers();
const fpSuggestionsRoutes = core.routes.fpSuggestions();
const settingsRoutes = core.routes.settings();
// License customer routes: /api/license/fingerprint, /lic-status, /usage, /prices, /tiers.
// Admin endpoint'ler (generate/trial/revoke) license.routes.js'de — customer image'a
// yasak pattern (generateLicenseKey) icerdigi icin DAHIL EDILMIYOR.
const licenseCustomerRoutes = core.routes.licenseCustomer();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Trust proxy: Docker/nginx arkasında req.ip'nin doğru çalışması için.
// TRUST_PROXY=1 → tek hop (default). TRUST_PROXY=false → devre dışı.
const _trustProxyEnv = env('TRUST_PROXY', '1');
if (_trustProxyEnv && _trustProxyEnv !== 'false' && _trustProxyEnv !== '0') {
    app.set('trust proxy', isNaN(Number(_trustProxyEnv)) ? _trustProxyEnv : Number(_trustProxyEnv));
}

// =====================================================================
// HARD GATE: customer image'de bu yollar 404 döner. apps/customer/Dockerfile
// ayrıca ilgili dosyaları fiziksel olarak imaj dışı bırakır.
// =====================================================================
const BLOCKED = [
    '/keygen.html', '/bayi.html', '/reseller.html',
    '/api/dealer',
    '/api/license/generate', '/api/license/batch', '/api/license/trial',
    '/api/license/revoke', '/api/license/unrevoke', '/api/license/revoked',
    '/api/license/audit',
    '/api/license/customer',  // Başka müşterilerin lisans bilgisi sızmasın
    '/api/license/renew',
    '/api/license/create',
    '/api/resellers',
    '/api/audit-log',
    '/api/admin',
    '/api/central',
    '/api/customer-sync',
    '/api/policy',
    // NOT: '/api/lists' BLOKLU DEĞİL — customer kendi allowlist/blocklist'ini
    // yönetebilmeli. License-server'daki '/api/lists/:customerId/whitelist'
    // gibi endpoint'ler customer app'inde zaten yüklü değil.
    '/api/config'
];
// /api/admin/restart ve /api/admin/stop → HARD-GATE'den muaf (customer admin yönetimi)
const BLOCKED_EXEMPT = new Set(['/api/admin/restart', '/api/admin/stop']);
app.use((req, res, next) => {
    const p = (req.path || '').toLowerCase();
    if (BLOCKED_EXEMPT.has(p)) return next();
    for (const b of BLOCKED) {
        if (p === b || p.startsWith(b + '/')) {
            return res.status(404).json({ error: 'Bu uç nokta müşteri kurulumunda devre dışı.' });
        }
    }
    next();
});
logger.info('[customer] HARD-GATE aktif: keygen/bayi/license-generator/dealer/admin endpoint\'leri 404.');

// ─── CORS ─────────────────────────────────────────────────
// MSA_ALLOWED_ORIGINS virgulle ayrilmis whitelist. Bos = same-origin only.
// '*' verilirse tum origin'lere acilir (sadece dev/test icin).
const _ALLOWED_ORIGINS = String(env('MSA_ALLOWED_ORIGINS', ''))
    .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
    origin(origin, cb) {
        if (!origin) return cb(null, true);                    // same-origin / tooling
        if (_ALLOWED_ORIGINS.includes('*')) return cb(null, true);
        if (_ALLOWED_ORIGINS.length === 0)   return cb(null, false);
        if (_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        return cb(null, false);
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With']
}));
if (_ALLOWED_ORIGINS.length === 0) {
    logger.info('[customer] CORS: same-origin only (MSA_ALLOWED_ORIGINS tanimsiz).');
} else {
    logger.info(`[customer] CORS whitelist: ${_ALLOWED_ORIGINS.join(', ')}`);
}

// ─── Helmet + CSP ─────────────────────────────────────────
// Mevcut frontend bol inline onclick / onchange / style= kullaniyor (449+ kullanim).
// Bu sebeple 'unsafe-inline' izinli ama 3rd-party origin script/style/connect engelli.
// script-src-attr 'unsafe-inline' KRITIK: Helmet useDefaults bunu 'none' yapar ve
// onclick/onchange gibi inline event handler'larini bloklar (UI'da butonlar olmez).
// Frontend refactor sonrasi nonce/hash tabanli politikaya gecilebilir.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src':     ["'self'"],
            'script-src':      ["'self'", "'unsafe-inline'"],
            'script-src-attr': ["'unsafe-inline'"],  // onclick="..." vb. icin sart
            'style-src':       ["'self'", "'unsafe-inline'"],
            'img-src':         ["'self'", 'data:', 'blob:'],
            'font-src':        ["'self'", 'data:'],
            'connect-src':     ["'self'", 'ws:', 'wss:'],
            'frame-ancestors': ["'none'"],
            'object-src':      ["'none'"],
            'base-uri':        ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' }
}));

// Body limit: legacy default 50MB cok genis. JSON 5mb, urlencoded 200kb yeterli;
// buyuk dosya zaten multer uzerinden (50mb). ReDoS/parser stress'i azaltir.
const _jsonLimit = envInt('CUSTOMER_JSON_LIMIT_MB', 5) * 1024 * 1024;
const _urlencLimit = envInt('CUSTOMER_URLENC_LIMIT_KB', 200) * 1024;
app.use(express.json({ limit: _jsonLimit, reviver: safeJSONReviver }));
app.use(express.urlencoded({ extended: true, limit: _urlencLimit }));

// ─── Rate limiting ────────────────────────────────────────
// Iki katmanli koruma: genel API icin yumusak, analyze/* icin sert.
// MSA_DISABLE_RATE_LIMIT=true ile test ortaminda devre disi.
if (!envBool('MSA_DISABLE_RATE_LIMIT', false)) {
    const globalLimiter = rateLimit({
        windowMs:        15 * 60 * 1000,
        max:             envInt('MSA_RATE_LIMIT_GLOBAL_MAX', 300),
        standardHeaders: true,
        legacyHeaders:   false,
        message:         { error: 'Cok fazla istek — kisa bir sure sonra tekrar deneyin.' }
    });
    const analyzeLimiter = rateLimit({
        windowMs:        5 * 60 * 1000,
        max:             envInt('MSA_RATE_LIMIT_ANALYZE_MAX', 30),
        standardHeaders: true,
        legacyHeaders:   false,
        message:         { error: 'Analiz hizi limiti asildi — 5 dk sonra tekrar deneyin.' }
    });
    app.use('/api/analyze', analyzeLimiter);
    app.use('/api', globalLimiter);
    logger.info('[customer] Rate limit aktif (global 300/15dk, analyze 30/5dk).');
} else {
    logger.warn('[customer] UYARI: MSA_DISABLE_RATE_LIMIT=true — rate limit kapali.');
}

function healthPayload() {
    return { ok: true, service: 'customer', time: Date.now(), version: APP.VERSION };
}
app.get('/healthz', (req, res) => res.json(healthPayload()));
app.get('/health', (req, res) => res.json(healthPayload()));
app.get('/api/health', (req, res) => res.json(healthPayload()));

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

// Static — kök public/ klasörü. Bayi.html / keygen.html Dockerfile build
// adımında imajdan SİLİNİR; ayrıca yukarıdaki HARD-GATE her ihtimale karşı 404 verir.
const PUBLIC_DIR = core.PUBLIC_DIR;
app.use(express.static(PUBLIC_DIR, {
    etag: true, lastModified: true, maxAge: 0,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); }
}));

// ============================================================
// Customer-only ek API'ler: lisans durumu (read-only) ve policy snapshot
// ============================================================

// License-server URL'i dinamik kaynak — onceligi settings > env.
// UI'dan kullanici degistirirse settings.licenseRemoteUrl yazilir.
// Bos olursa env (MSA_LICENSE_REMOTE_URL) fallback olarak kullanilir.
function getActiveLicenseRemoteUrl() {
    try {
        const s = loadSettings();
        if (s?.licenseRemoteUrl && String(s.licenseRemoteUrl).trim()) {
            return String(s.licenseRemoteUrl).trim().replace(/\/$/, '');
        }
    } catch (_) { /* settings okunamadi - env fallback */ }
    return (env('MSA_LICENSE_REMOTE_URL') || '').replace(/\/$/, '');
}

app.get('/api/customer/license/status', asyncH((req, res) => {
    const snap = licenseClient.getSnapshot();
    const grace = licenseClient.graceCheck();
    res.json({ snapshot: snap, grace });
}));

app.post('/api/customer/license/activate', asyncH(async (req, res) => {
    const { licenseKey } = req.body || {};
    if (!licenseKey) return res.status(400).json({ error: 'licenseKey gerekli' });
    const remoteUrl = getActiveLicenseRemoteUrl();
    if (!remoteUrl) return res.status(503).json({ error: 'License-server URL tanımlı değil. UI veya .env ile ayarlayın.' });
    const r = await licenseClient.activate({ remoteUrl, licenseKey });
    res.json({ ok: true, snapshot: r });
}));

app.post('/api/customer/license/validate', asyncH(async (req, res) => {
    const remoteUrl = getActiveLicenseRemoteUrl();
    if (!remoteUrl) return res.status(503).json({ error: 'License-server URL tanımlı değil.' });
    const settings = (() => { try { return loadSettings(); } catch (_) { return {}; } })();
    const licenseKey = req.body?.licenseKey || settings.activeLicenseKey;
    if (!licenseKey) return res.status(400).json({ error: 'licenseKey yok' });
    const r = await licenseClient.validate({ remoteUrl, licenseKey });
    const snapshot = licenseClient.getSnapshot();
    res.json({ ...r, snapshot });
}));

// ─── License-server URL UI yonetimi ───────────────────────────
// GET  : mevcut URL'i + kaynagini (settings|env) doner
// POST : URL'i settings'e yazar (env override eder)
// GET ping: belirtilen veya aktif URL'e baglanti testi
app.get('/api/customer/license/server-url', (req, res) => {
    let envUrl = env('MSA_LICENSE_REMOTE_URL') || '';
    let settingsUrl = '';
    try { settingsUrl = String(loadSettings()?.licenseRemoteUrl || ''); } catch (_) {}
    const active = getActiveLicenseRemoteUrl();
    res.json({
        active,
        source: settingsUrl ? 'settings' : (envUrl ? 'env' : 'none'),
        envUrl,
        settingsUrl,
        editable: true
    });
});

app.post('/api/customer/license/server-url', asyncH((req, res) => {
    const { url } = req.body || {};
    const cleaned = String(url || '').trim().replace(/\/$/, '');
    // Bos URL = settings'i temizle (env'e geri don)
    if (cleaned && !/^https?:\/\//i.test(cleaned)) {
        return res.status(400).json({ error: 'URL http:// veya https:// ile baslamali' });
    }
    const { saveSettings } = core.storage.settingsStore();
    const current = (() => { try { return loadSettings(); } catch (_) { return {}; } })();
    saveSettings({ ...current, licenseRemoteUrl: cleaned });
    const active = getActiveLicenseRemoteUrl();
    logger.info(`[license] server-url guncellendi -> ${active || '(bos, env fallback)'}`);
    res.json({ ok: true, active, source: cleaned ? 'settings' : (env('MSA_LICENSE_REMOTE_URL') ? 'env' : 'none') });
}));

// ─── License-client iletisim log buffer (UI'daki Loglar modali icin) ─────
// In-memory ring buffer (license-client._logBuffer). Container restart'inda silinir.
app.get('/api/customer/license/logs', (req, res) => {
    try {
        const since = Number(req.query.since) || 0;
        const level = req.query.level ? String(req.query.level) : null;
        const logs = (typeof licenseClient.getLogs === 'function')
            ? licenseClient.getLogs({ since, level })
            : [];
        const remoteUrl = getActiveLicenseRemoteUrl();
        res.json({
            ok: true,
            now:           Date.now(),
            remoteUrl,
            remoteUrlSet:  !!remoteUrl,
            bufferSize:    Number(process.env.MSA_LICENSE_LOG_BUFFER_SIZE) || 200,
            count:         logs.length,
            logs
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message, logs: [], count: 0 });
    }
});

app.delete('/api/customer/license/logs', (req, res) => {
    try {
        const removed = (typeof licenseClient.clearLogs === 'function')
            ? licenseClient.clearLogs()
            : 0;
        res.json({ ok: true, removed });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/customer/license/ping', asyncH(async (req, res) => {
    const urlOverride = String(req.query.url || '').trim().replace(/\/$/, '');
    const remoteUrl   = urlOverride || getActiveLicenseRemoteUrl();
    if (!remoteUrl) {
        return res.status(400).json({ ok: false, error: 'License-server URL tanımlı değil.' });
    }
    // /api/health (license-server) veya /healthz (genel) ikisinden birini dener
    const candidates = ['/api/health', '/healthz'];
    const started = Date.now();
    for (const path of candidates) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const r = await fetch(remoteUrl + path, { signal: controller.signal })
                .finally(() => clearTimeout(timer));
            if (r.ok) {
                const elapsedMs = Date.now() - started;
                let body = null;
                try { body = await r.json(); } catch (_) {}
                return res.json({ ok: true, url: remoteUrl, path, elapsedMs, body });
            }
        } catch (_) { /* sonraki path'i dene */ }
    }
    return res.status(502).json({
        ok: false,
        url: remoteUrl,
        error: 'License-server cevap vermedi (/api/health ve /healthz denendi).',
        elapsedMs: Date.now() - started
    });
}));

app.get('/api/customer/policy/snapshot', (req, res) => {
    res.json({
        policy: centralSync.getPolicy(),
        lists: centralSync.getLists(),
        apiPolicy: centralSync.getApiPolicy(),
        state: centralSync.getState()
    });
});

app.get('/api/customer/feature/:name', (req, res) => {
    res.json({ feature: req.params.name, enabled: policyClient.isFeatureEnabled(req.params.name) });
});

// ============================================================
// /api/admin/restart — Docker restart-policy üzerinden servisi yeniden başlatır.
// Yalnızca müşteri admin kullanıcıları çağırabilir.
// ============================================================
const { requireAdminAuth: _requireAdminAuth } = core.middleware.adminAuth();

app.post('/api/admin/restart', _requireAdminAuth, (req, res) => {
    res.json({ ok: true, message: 'Servis yeniden başlatılıyor...' });
    // Yanıt gönderdikten 800ms sonra çık — Docker restart policy devralır.
    setTimeout(() => {
        logger.info('[customer] Admin isteği ile yeniden başlatılıyor.');
        process.exit(0);
    }, 800);
});

app.post('/api/admin/stop', _requireAdminAuth, (req, res) => {
    res.json({ ok: true, message: 'Servis durduruluyor...' });
    setTimeout(() => {
        logger.info('[customer] Admin isteği ile durduruluyor.');
        process.exit(0);
    }, 800);
});

// Mevcut API yüzeyi (legacy routes/api.js); BLOCKED listede olan path'ler yukarıda 404'lenir.
customerApi.use(metaRoutes);
customerApi.use(analyzeRoutes);
customerApi.use(imapRoutes);
customerApi.use(monitorRoutes);
customerApi.use(reportsRoutes);
customerApi.use(listsRoutes);
customerApi.use(statsRoutes);
customerApi.use(customerAuthRoutes);
customerApi.use(customerUsersRoutes);
customerApi.use(settingsRoutes);
customerApi.use(licenseCustomerRoutes);

// FP (Yanlış Pozitif) önerileri — yeni lisans sistemiyle uyumlu.
// req._licenseOverride = true inject edilerek eski HMAC lisans kontrolü bypass edilir.
customerApi.use((req, res, next) => {
    if (!req._licenseOverride) {
        req._licenseOverride = licenseClient.graceCheck().ok;
    }
    next();
}, fpSuggestionsRoutes);

app.use('/api', customerApi);

setupWebSocket(wss);

// Sunucu hazır olduktan ~12s sonra scan-mailbox monitörlerini resume et.
// (Anlık rapor maili gönderen monitörler — IMAP IDLE + SMTP send.)
// WebSocket monitörleri setupWebSocket içinde başlar; scan-mailbox ayrı.
// 12s gecikme: license-client validate + central-sync bootstrap tamamlansın.
(() => {
    const { resumeScanMailboxMonitors } = core.services.scanMailbox();
    setTimeout(() => {
        resumeScanMailboxMonitors().catch(e =>
            logger.error('[ScanMailbox] Resume hatası:', e.message)
        );
    }, 12_000);
})();

app.use('/api', (req, res) => res.status(404).json({ error: `API endpoint bulunamadı: ${req.method} ${req.path}` }));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ============================================================
// Boot + periyodik sync
// ============================================================
const PORT = envInt('PORT', 3000);
(async () => {
    try { await checkAndSeedInitialPasswords(); } catch (e) { logger.error('initial seed:', e.message); }
    try { await customerUserStore.migrateFromLegacySettings(); } catch (e) { logger.error('user migrate:', e.message); }
    // İlk kurulum token'ını garanti et: admin yoksa ve env token boşsa otomatik
    // üret + data/setup-token'a yaz, setup URL'ini logla (manuel docker-compose yolu).
    try { ensureSetupToken({ port: PORT, logger }); } catch (e) { logger.error('setup token:', e.message); }
    startListening();
})();

function _gatherTelemetry() {
    // Sayaçları storage'tan çekmeye çalışır; başarısızsa 0 döner.
    // NOT: Onceki kod yanlis fonksiyon adlari cagiriyordu (getCurrentMonthCount /
    // getTodayCount). Storage modullerinde bu adlar yok — dogru API:
    //   monthlyCounter.getMonthlyCount(monthKey, scope='global')
    //   dailyScansStore.getDailyCount(dateKey, scope='global'), todayKey()
    //   scanHistory.countScanHistory(), .loadScanHistory() (son tarama tarihi icin)
    try {
        const monthly = core.storage.monthlyCounter();
        const daily   = core.storage.dailyScansStore();
        const scans   = core.storage.scanHistory();
        const settings = (() => { try { return loadSettings(); } catch (_) { return {}; } })();

        const monthlyScanCount = typeof monthly.getMonthlyCount === 'function' ? monthly.getMonthlyCount() : 0;
        const dailyScanCount   = typeof daily.getDailyCount === 'function' ? daily.getDailyCount(daily.todayKey?.()) : 0;
        const totalScanCount   = typeof scans.countScanHistory === 'function' ? scans.countScanHistory() : 0;

        // Son tarama tarihi — scan_history en son entry'sinden ISO timestamp
        let lastScanAt = null;
        try {
            const hist = scans.loadScanHistory?.() || [];
            if (hist.length) {
                const latest = hist.reduce((a, b) => (new Date(a.timestamp || 0) > new Date(b.timestamp || 0) ? a : b));
                lastScanAt = latest?.timestamp || null;
            }
        } catch (_) { /* sessiz */ }

        return {
            counters: {
                monthlyScanCount,
                dailyScanCount,
                totalScanCount,
                mailboxCount:    (settings.mailboxes || []).length || 0,
                userCount: 1
            },
            lastScanAt,
            services: {
                imapMonitor:  settings.autoMonitorEnabled ? 'running' : 'stopped',
                smtpReporter: settings.smtp?.host ? 'configured' : 'not_configured',
                quarantine:   settings.quarantineEnabled ? 'enabled' : 'disabled',
                aiProvider:   (settings.openaiApiKey || settings.claudeApiKey) ? 'configured' : 'not_configured',
                healthStatus: 'ok'
            }
        };
    } catch (e) { return { counters: {}, services: { healthStatus: 'degraded', errorSummary: e.message } }; }
}

// Graceful shutdown — sync interval'leri + HTTP server'ı kapat.
let _syncRunner = null;
installShutdownHandlers([
    () => new Promise((resolve) => {
        try { _syncRunner && _syncRunner.stop(); } catch (_) {}
        try {
            server.close(() => { logger.info('[customer] HTTP server kapandı'); resolve(); });
            setTimeout(() => { try { server.closeAllConnections?.(); } catch (_) {} resolve(); }, 8000).unref();
        } catch (_) { resolve(); }
    })
]);

process.on('unhandledRejection', (reason) => logger.error('[customer] unhandledRejection', reason));
process.on('uncaughtException', (err) => { logger.error('[customer] uncaughtException', err); process.exit(1); });

// ─── Merkezi (Owner) AI model uygulaması ──────────────────────────────────────
// license-server apiPolicy.body.aiModels (override ?? global) müşteriye sync edilir.
// Burada runtime'da MEVCUT kilit altyapısına besleriz:
//   · MSA_LOCKED_OPENAI_MODEL → settings.routes müşteri model değişikliğini reddeder
//     + UI'da seçeneği disable eder; openai çağrıları state.openaiModel'i kullanır.
//   · MSA_LOCKED_CLAUDE_MODEL → claude.js her çağrıda dinamik okur.
// Böylece model YALNIZ Merkezi Yönetim'den (owner) değişir; müşteri admini değiştiremez.
function _applyCentralAiModels() {
    let ai;
    try { ai = centralSync.getApiPolicy()?.body?.aiModels; } catch (_) { ai = null; }
    if (!ai || typeof ai !== 'object') return;
    try {
        if (ai.openai) {
            process.env.MSA_LOCKED_OPENAI_MODEL = String(ai.openai);
            try { core.services.appState().state.openaiModel = String(ai.openai); } catch (_) {}
        }
        if (ai.claude) {
            process.env.MSA_LOCKED_CLAUDE_MODEL = String(ai.claude);
        }
    } catch (e) {
        logger.warn('[ai-model] merkezi model uygulanamadı:', e.message);
    }
}

function startListening() {
    server.listen(PORT, () => {
        logger.info(`🛡️  MailTrustAI Customer @ http://localhost:${PORT} (v${APP.VERSION})`);

        const syncEnabled = envBool('MSA_CENTRAL_SYNC_ENABLED', true);
        const syncUrl     = env('MSA_CENTRAL_SYNC_URL') || getActiveLicenseRemoteUrl();
        const remoteUrl   = getActiveLicenseRemoteUrl();
        const presetKey   = env('MSA_LICENSE_KEY');
        const hbSec       = envInt('MSA_HEARTBEAT_INTERVAL_SECONDS', 300);
        const plSec       = envInt('MSA_POLICY_SYNC_INTERVAL_SECONDS', 900);
        const startSync = () => {
            _syncRunner = centralSync.startPeriodicSync({
                syncUrl, enabled: syncEnabled, heartbeatSeconds: hbSec, pullSeconds: plSec,
                gather: async () => _gatherTelemetry()
            });
        };

        // İlk açılışta lisans key env'den geldiyse activate/validate dene.
        // Başarısız olsa bile customer çalışmaya devam eder (grace/offline mode).
        (async () => {
            try {
                if (presetKey && remoteUrl) {
                    await licenseClient.activate({ remoteUrl, licenseKey: presetKey });
                    await licenseClient.validate({ remoteUrl, licenseKey: presetKey });
                    logger.info('[license] startup activate/validate başarılı.');
                }
            } catch (e) {
                logger.warn('[license] startup activate/validate başarısız:', e.message);
            } finally {
                startSync();
            }
        })();

        // Merkezi AI modelini uygula: ilk pull tamamlandıktan kısa süre sonra + periyodik
        // (apiPolicy pull cadence'i ile uyumlu, ucuz in-memory okuma).
        setTimeout(_applyCentralAiModels, 15 * 1000);
        setInterval(_applyCentralAiModels, Math.max(60, plSec) * 1000).unref();

        // Periyodik validate: ek tarama paketi ve lisans değişikliklerini 6 saatte bir yansıt.
        const VALIDATE_INTERVAL_MS = envInt('MSA_VALIDATE_INTERVAL_HOURS', 6) * 3600 * 1000;
        if (presetKey && remoteUrl) {
            setInterval(async () => {
                try {
                    await licenseClient.validate({ remoteUrl, licenseKey: presetKey });
                    logger.info('[license] periyodik validate tamam.');
                } catch (e) {
                    logger.warn('[license] periyodik validate başarısız (grace devam):', e.message);
                }
            }, VALIDATE_INTERVAL_MS).unref();
        }

        // Eski uzak doğrulayıcı kalıyor — geriye dönük uyumluluk
        if (remoteUrl) {
            try {
                const { startBackgroundRefresh } = core.license.remoteValidator();
                startBackgroundRefresh(() => {
                    try {
                        const { listAutoMonitors } = core.storage.autoMonitorState();
                        return listAutoMonitors().map(m => m.licenseKey).filter(Boolean);
                    } catch { return []; }
                });
            } catch (e) { logger.warn('remoteValidator init:', e.message); }
        } else {
            logger.info('[license] MSA_LICENSE_REMOTE_URL boş — uzak doğrulama devre dışı.');
        }
    });
}
