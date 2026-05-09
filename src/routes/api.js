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
    '/admin/send-reset-code',
    '/admin/verify-reset-code',
    '/customer/status',
    '/customer/setup',
    '/customer/login'
]);

router.use((req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (req.path.startsWith('/dealer/') || req.path === '/dealer') return next();

    // Bearer token: admin oturumu veya müşteri oturumu
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        const token = auth.slice(7).trim();
        if (verifyAdminToken(token)) return next();
        if (customerAuth.verifyCustomerToken(token)) return next();
    }

    // x-license-key: geçerli lisans anahtarı ile doğrudan API erişimi
    const licKey = req.headers['x-license-key'] || req.body?.licenseKey || '';
    if (licKey) {
        const result = validateLicenseKey(licKey);
        if (result.valid) return next();
    }

    return res.status(401).json({ error: 'Müşteri yönetim oturumu gerekli. Lütfen giriş yapın.' });
});

// ─── Sub-router mount ─────────────────────────────────────
router.use(require('../interfaces/http/routes/meta.routes'));
router.use(require('../interfaces/http/routes/admin.routes'));
router.use(require('../interfaces/http/routes/trustedDomains.routes'));
router.use(require('../interfaces/http/routes/fpSuggestions.routes'));
router.use(require('../interfaces/http/routes/customer.routes'));
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
