// ============================================================
// REST API ROUTES — aggregator (thin)
//
// Bu dosya artık doğrudan endpoint tanımı içermez. Her endpoint
// grubu src/interfaces/http/routes/ altında ayrı bir router olarak
// tanımlanır ve burada tek bir parent router'a mount edilir.
//
// Sorumlulukları:
//   1) Müşteri/Admin oturum guard'ı (PUBLIC_PATHS dışındaki tüm /api/*)
//   2) Init IIFE'leri (scan-mailbox monitor başlatma, threat-intel feed,
//      periyodik rapor scheduler)
//   3) Sub-router'ları mount etme
// ============================================================
const express = require('express');
const router  = express.Router();

const { verifyAdminToken }  = require('../middleware/adminAuth');
const customerAuth          = require('../middleware/customerAuth');
const { validateLicenseKey } = require('../license/license');
const { loadSettings }      = require('../storage/settingsStore');
const { startScanMailboxMonitor }   = require('../services/scanMailboxService');
const { runScheduledPeriodicReports } = require('../services/reportService');
const { initThreatIntelFeed }       = require('../integrations/threatIntel');

// ─── Customer auth guard ─────────────────────────────────
const PUBLIC_PATHS = new Set([
    '/health',
    '/admin/session',
    '/admin/setup',
    '/admin/setup/status',
    '/admin/send-reset-code',
    '/admin/verify-reset-code',
    '/customer/status',
    '/customer/setup',
    '/customer/login'
]);

// Sadece müşteri ADMIN rolü erişebilen path prefix'leri (user rolü için 403).
// Customer admin = "müşteri admin" — kendi alanındaki her şeyi yönetir.
// user rolü için izinli: belirli IMAP/analyze/scan endpoint'leri (aşağıda whitelist).
const ADMIN_ONLY_PREFIXES = [
    // /settings/* spesifik yazma endpoint'leri (read-only /settings/status user için açık)
    '/settings/keys',
    '/settings/admin-password',
    '/settings/otx/test',
    '/settings/realtime-alerts',
    '/threat-intel/refresh',
    '/admin/config/',
    '/admin/trusted-domains',
    '/admin/fp-suggestions',
    '/customer-users',
    '/resellers',
    '/license/generate',
    '/license/batch',
    '/license/trial',
    '/license/revoke',
    '/license/unrevoke',
    '/license/revoked',
    '/reports/settings',
    '/scan-mailboxes',
    '/audit-log'
    // /settings/webhook GET user'a açık (read-only); POST/test endpoint'leri
    // route handler içinde zaten kendi auth'unu yapıyor.
];

// user rolü için izinli path'ler (whitelist). Diğer her şey kapalı.
// "user" rolü = müşterinin kullanıcısı = sadece kendi IMAP'ını kullanır.
const USER_ROLE_ALLOWED_PREFIXES = [
    '/imap/',          // sadece kendi IMAP hesabını (imap.routes.js içinde filtre)
    '/analyze/',       // mail analizi (kendi mailbox'ından)
    '/health',
    '/customer/status',
    '/license',           // GET /license → kayıtlı aktif lisans (user da görmeli)
    '/license/validate',
    '/license/prices',
    '/license/activate',
    '/license/check',
    '/license/usage',
    '/settings/status',   // ayar durumu (yalnız okuma) — user için gerekli
    '/stats/',
    '/lists/',
    '/threat-intel/',     // istatistik okuma (refresh hariç ADMIN_ONLY'de)
    '/scan-history',      // tarama geçmişi
    '/monitor/'           // monitor durumu okuma
];

function _isAdminOnlyPath(path) {
    return ADMIN_ONLY_PREFIXES.some(p => path === p || path.startsWith(p));
}

function _isUserAllowedPath(path) {
    return USER_ROLE_ALLOWED_PREFIXES.some(p => path === p || path.startsWith(p));
}

router.use(async (req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (req.path.startsWith('/dealer/') || req.path === '/dealer') return next();

    // Bearer token: admin token (keygen) veya müşteri token (admin/user role)
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        const token = auth.slice(7).trim();

        // 1) Sistem admin token (keygen.html → license üretim için)
        if (verifyAdminToken(token)) return next();

        // 2) Müşteri token (email + role + imapEmail)
        const parsed = customerAuth.parseCustomerToken(token);
        if (parsed) {
            // DB'de hâlâ aktif mi?
            const customerUserStore = require('../storage/customerUserStore');
            const u = customerUserStore.findByEmail(parsed.email);
            if (u && u.active) {
                req.customerUser = { email: u.email, role: u.role, imapEmail: u.imapEmail };

                // Rol-bazlı path kontrolü
                if (u.role === 'admin') {
                    return next();   // her yere erişebilir
                }
                // user role: sadece whitelist + admin-only DEĞİL
                if (_isUserAllowedPath(req.path) && !_isAdminOnlyPath(req.path)) {
                    return next();
                }
                return res.status(403).json({
                    error: 'Bu işlem için yetkiniz yok. Yalnız müşteri admin erişebilir.',
                    role: u.role
                });
            }
            // Token geçerli ama DB'de aktif değil → reddet
            return res.status(401).json({ error: 'Oturum geçersiz. Yeniden giriş yapın.' });
        }
    }

    // x-license-key: geçerli lisans anahtarı ile doğrudan API erişimi (admin gibi davranır)
    const licKey = req.headers['x-license-key'] || req.body?.licenseKey || '';
    if (licKey) {
        const result = validateLicenseKey(licKey);
        if (result.valid) return next();
    }

    // x-admin-password: doğrudan admin şifresi ile erişim (geriye uyumluluk)
    const adminPwdHeader = req.headers['x-admin-password'] || '';
    if (adminPwdHeader) {
        const { verifyAdminPassword } = require('../middleware/adminAuth');
        const valid = await verifyAdminPassword(adminPwdHeader);
        if (valid) return next();
    }

    return res.status(401).json({ error: 'Müşteri yönetim oturumu gerekli. Lütfen giriş yapın.' });
});

// ─── Sub-router mount ─────────────────────────────────────
router.use(require('../interfaces/http/routes/meta.routes'));
router.use(require('../interfaces/http/routes/admin.routes'));
router.use(require('../interfaces/http/routes/configBackup.routes'));
router.use(require('../interfaces/http/routes/trustedDomains.routes'));
router.use(require('../interfaces/http/routes/fpSuggestions.routes'));
router.use(require('../interfaces/http/routes/customer.routes'));
router.use(require('../interfaces/http/routes/customerUsers.routes'));
router.use(require('../interfaces/http/routes/analyze.routes'));
router.use(require('../interfaces/http/routes/imap.routes'));
router.use(require('../interfaces/http/routes/monitor.routes'));
router.use(require('../interfaces/http/routes/license.routes'));
router.use(require('../interfaces/http/routes/reports.routes'));
router.use(require('../interfaces/http/routes/lists.routes'));
router.use(require('../interfaces/http/routes/threatIntel.routes'));
router.use(require('../interfaces/http/routes/settings.routes'));
router.use(require('../interfaces/http/routes/stats.routes'));
router.use(require('../interfaces/http/routes/resellers.routes'));

// ─── Başlangıç IIFE'leri ─────────────────────────────────
(function initScanMailboxes() {
    setTimeout(() => {
        const settings = loadSettings();
        for (const smb of (settings.scanMailboxes || [])) {
            if (!smb.enabled || !smb.imapEmail) continue;
            startScanMailboxMonitor(smb).catch(e =>
                console.error(`[ScanMailbox] Failed to start ${smb.imapEmail}:`, e.message)
            );
        }
    }, 10 * 1000);
})();

initThreatIntelFeed();

(function initPeriodicReports() {
    setTimeout(() => {
        runScheduledPeriodicReports().catch(e => console.error('[PeriodicReport] startup check failed:', e.message));
        setInterval(() => {
            runScheduledPeriodicReports().catch(e => console.error('[PeriodicReport] scheduled check failed:', e.message));
        }, 60 * 1000);
    }, 20 * 1000);
})();

module.exports = router;
