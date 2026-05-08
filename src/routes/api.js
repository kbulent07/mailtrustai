// ============================================================
// REST API ROUTES
// ============================================================
const express = require('express');
const multer  = require('multer');
const bcrypt  = require('bcrypt');
const router  = express.Router();

const { requireAdminAuth, verifyAdminPassword, createAdminToken } = require('../middleware/adminAuth');
const customerAuth = require('../middleware/customerAuth');

// ─── Analizörler ve Ayrıştırıcılar ───────────────────────
const { parseEmail, parseUploadedEmail } = require('../analysis/parser');
const { analyzeAttachments } = require('../analysis/attachmentAnalyzer');
const { buildEmailAnalysisResult, buildAttachmentOnlyResult, applyVirusTotalInsights } = require('../analysis/emailAnalyzer');
const { scanAttachments: vtScan } = require('../integrations/virustotal');

// ─── Lisans ───────────────────────────────────────────────
const { validateLicenseKey, generateLicenseKey, generateBatchKeys, getPriceTable, PLANS, TIERS, DURATIONS, revokeKey, unRevokeKey, loadRevocationList } = require('../license/license');
const { checkRemoteLicense, startBackgroundRefresh } = require('../license/remoteValidator');

// ─── IMAP / Hesaplar ──────────────────────────────────────
const { testConnection, addAccount, removeAccount, updateAccount, loadCredentials } = require('../imap/connection');
const { listEmails, fetchAndParseEmail } = require('../imap/scanner');

// ─── Storage ──────────────────────────────────────────────
const { loadScanHistory, recordScan } = require('../storage/scanHistory');
const { loadSettings, saveSettings }  = require('../storage/settingsStore');
const { loadResellers, addReseller, removeReseller } = require('../storage/resellerStore');
const { listAutoMonitors, removeAutoMonitor } = require('../storage/autoMonitorState');
const { getMonthlyCount, getCurrentMonthKey } = require('../storage/monthlyCounter');
const { getDailyCount, todayKey } = require('../storage/dailyScansStore');

// ─── Servisler ────────────────────────────────────────────
const { state, checkLicense, checkDailyLimit, checkMonthlyLimit, incrementScanCounts } = require('../services/appState');
const {
    normalizeReportRecipients, normalizePeriodicReportSettings,
    getAutoSummaryReportRecipients, getReportingSmtpConfig,
    sendEnterpriseRiskAlert, sendPeriodicSummaryReport,
    runScheduledPeriodicReports
} = require('../services/reportService');
const { scanMailboxMonitors, startScanMailboxMonitor } = require('../services/scanMailboxService');

// ─── Diğer ────────────────────────────────────────────────
const { generateOtp, verifyOtp } = require('../utils/otpStore');
const { loadLists, addToAllowlist, removeFromAllowlist, addToBlocklist, removeFromBlocklist } = require('../storage/allowlistStore');
const { initThreatIntelFeed, getThreatIntelStats, refreshFeed: refreshThreatIntel } = require('../integrations/threatIntel');
const { testWebhook } = require('../integrations/webhook');
const { PERIODS, resolveRange, filterRowsForReport, summarizeRows } = require('../smtp/periodicReportBuilder');
const { OPENAI_MODEL, AVAILABLE_OPENAI_MODELS } = require('../integrations/openai');

const RECOVERY_EMAIL = process.env.MSA_RECOVERY_EMAIL || '';

// ─── Multer ───────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── BAŞLANGIÇ ────────────────────────────────────────────
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

// ============================================================
// ADMIN SESSION (JWT-like token üretimi — auth gerektirmez)
// ============================================================
router.post('/admin/session', async (req, res) => {
    try {
        const { adminPassword } = req.body || {};
        if (!adminPassword) return res.status(400).json({ error: 'adminPassword zorunludur' });
        const valid = await verifyAdminPassword(adminPassword);
        if (!valid) return res.status(403).json({ error: 'Geçersiz admin şifresi' });
        const token = createAdminToken();
        res.json({ token, expiresIn: 8 * 3600 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// MÜŞTERİ YÖNETİM PANELİ ŞİFRESİ (index.html erişimi)
// ============================================================
router.get('/customer/status', (req, res) => {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    res.json({
        passwordSet:    customerAuth.isCustomerPasswordSet(),
        sessionValid:   token ? customerAuth.verifyCustomerToken(token) : false
    });
});

router.post('/customer/setup', async (req, res) => {
    try {
        if (customerAuth.isCustomerPasswordSet()) {
            return res.status(409).json({ error: 'Müşteri şifresi zaten ayarlanmış. Sıfırlamak için admin panelini kullanın.' });
        }
        const password = String(req.body?.password || '');
        if (password.length < 6) {
            return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
        }
        await customerAuth.setCustomerPassword(password);
        const token = customerAuth.createCustomerToken();
        res.json({ success: true, token, expiresIn: 12 * 3600 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/customer/login', async (req, res) => {
    try {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const rate = customerAuth.checkLoginRate(ip);
        if (!rate.allowed) {
            return res.status(429).json({
                error: `Çok fazla hatalı giriş. ${Math.ceil(rate.retryAfter / 60)} dakika sonra deneyin.`,
                retryAfter: rate.retryAfter
            });
        }
        const password = String(req.body?.password || '');
        if (!password) return res.status(400).json({ error: 'Şifre zorunludur.' });

        const valid = await customerAuth.verifyCustomerPassword(password);
        if (!valid) return res.status(403).json({ error: 'Geçersiz şifre.' });

        customerAuth.clearLoginRate(ip);
        const token = customerAuth.createCustomerToken();
        res.json({ success: true, token, expiresIn: 12 * 3600 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin paneli üzerinden şifre değiştirme/sıfırlama (admin auth gerektirir)
router.post('/customer/reset', requireAdminAuth, async (req, res) => {
    try {
        const password = String(req.body?.password || '');
        if (password.length < 6) {
            return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
        }
        await customerAuth.setCustomerPassword(password);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// SAĞLIK KONTROLÜ (auth gerektirmez — Docker/k8s probe için)
// ============================================================
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        version: require('../../package.json').version,
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// ANALİZ ENDPOINT'LERİ
// ============================================================
router.post('/analyze/eml', upload.single('file'), async (req, res) => {
    try {
        const license = checkLicense(req);
        if (!checkDailyLimit(license))   return res.status(429).json({ error: 'Daily scan limit reached' });
        if (!checkMonthlyLimit(license)) return res.status(429).json({ error: 'Monthly scan limit reached' });

        let source;
        if (req.file)        source = req.file.buffer;
        else if (req.body.source) source = req.body.source;
        else return res.status(400).json({ error: 'No EML file or source provided' });

        const parsed = req.file
            ? await parseUploadedEmail(source, req.file.originalname || '')
            : await parseEmail(source);
        if (!parsed.success) return res.status(400).json({ error: parsed.error });

        const result = await buildEmailAnalysisResult(parsed.data, license);
        result.scanSource = 'upload';
        state.scanHistory = recordScan(result);
        incrementScanCounts();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/analyze/file', upload.single('file'), async (req, res) => {
    try {
        const license = checkLicense(req);
        if (!checkDailyLimit(license))   return res.status(429).json({ error: 'Daily scan limit reached' });
        if (!checkMonthlyLimit(license)) return res.status(429).json({ error: 'Monthly scan limit reached' });
        if (!req.file) return res.status(400).json({ error: 'No file provided' });

        const lowerName = String(req.file.originalname || '').toLowerCase();
        if (lowerName.endsWith('.eml') || lowerName.endsWith('.msg')) {
            const parsed = await parseUploadedEmail(req.file.buffer, req.file.originalname || '');
            if (!parsed.success) return res.status(400).json({ error: parsed.error });
            const result = await buildEmailAnalysisResult(parsed.data, license);
            result.scanSource = 'upload';
            state.scanHistory = recordScan(result);
            incrementScanCounts();
            return res.json(result);
        }

        const att = { filename: req.file.originalname, contentType: req.file.mimetype, size: req.file.size, content: req.file.buffer };
        const attachmentResult = analyzeAttachments([att]);
        const result = buildAttachmentOnlyResult(att, attachmentResult);
        result.scanSource = 'upload';

        const vtCandidates = (attachmentResult.results || []).filter(item => item.vtEligible !== false);
        if (state.vtApiKey && vtCandidates.length) {
            result.virusTotal = await vtScan(vtCandidates.map(item => ({
                ...item, content: req.file.buffer,
                contentType: req.file.mimetype, filename: req.file.originalname
            })), state.vtApiKey);
            result.vtStatus.checked = true;
            result.vtStatus.reason  = 'completed';
            applyVirusTotalInsights(result, result.virusTotal);
        } else if (attachmentResult.results?.some(item => item.vtEligible === false)) {
            result.vtStatus.checked = false;
            result.vtStatus.reason  = 'image-local-scan';
        } else if (attachmentResult.results?.length > 0) {
            result.findings.push({ severity: 'warning', category: 'virusTotal',
                message: 'Virüs tarama API anahtarı tanımlı değil. Yalnızca yerel ek kontrolleri çalıştırıldı.' });
        }

        state.scanHistory = recordScan(result);
        incrementScanCounts();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// IMAP ENDPOINT'LERİ
// ============================================================
router.post('/imap/test', async (req, res) => {
    res.json(await testConnection(req.body));
});

router.post('/imap/accounts', async (req, res) => {
    if (!req.body?.email || !req.body?.password || !req.body?.host)
        return res.status(400).json({ error: 'Email, password, and host are required' });
    const accounts = addAccount({
        ...req.body,
        autoSummaryReport: req.body.autoSummaryReport === true || req.body.autoSummaryReport === 'true'
    });
    res.json({ success: true, count: accounts.length });
});

router.delete('/imap/accounts/:email', (req, res) => {
    res.json({ success: true, count: removeAccount(req.params.email).length });
});

router.get('/imap/accounts', (req, res) => {
    res.json(loadCredentials().map(a => ({
        email: a.email, host: a.host, port: a.port,
        autoSummaryReport: a.autoSummaryReport === true,
        rejectUnauthorized: a.rejectUnauthorized !== false
    })));
});

router.patch('/imap/accounts/:email/report', (req, res) => {
    const email   = decodeURIComponent(req.params.email);
    const updated = updateAccount(email, { autoSummaryReport: req.body.enabled === true || req.body.enabled === 'true' });
    if (!updated) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, email, autoSummaryReport: updated.autoSummaryReport === true });
});

router.post('/imap/list', async (req, res) => {
    const license = checkLicense(req);
    if (!license.features?.imapConnection) return res.status(403).json({ error: 'IMAP tarama Enterprise lisansı gerektirir' });
    const { email, folder, limit } = req.body;
    const account = loadCredentials().find(a => a.email === email);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const result = await listEmails(account, folder, limit);
    res.status(result.success ? 200 : 400).json(result);
});

router.post('/imap/scan', async (req, res) => {
    const license = checkLicense(req);
    if (!license.features?.inboxScan)   return res.status(403).json({ error: 'Inbox tarama Enterprise lisansı gerektirir' });
    if (!checkDailyLimit(license))      return res.status(429).json({ error: 'Daily scan limit reached' });
    if (!checkMonthlyLimit(license))    return res.status(429).json({ error: 'Monthly scan limit reached' });

    const { email, uid, folder } = req.body;
    const account = loadCredentials().find(a => a.email === email);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const parsed = await fetchAndParseEmail(account, uid, folder);
    if (!parsed.success) return res.status(400).json(parsed);

    const result = await buildEmailAnalysisResult(parsed.data, license);
    result.scanSource = 'imap-manual';

    const riskAlert = await sendEnterpriseRiskAlert({ result, license, to: account.email, reason: 'manual-imap-scan' });
    if (riskAlert) result.riskAlert = riskAlert;

    state.scanHistory = recordScan(result);
    incrementScanCounts();
    res.json(result);
});

// ============================================================
// SMTP / TARAMA POSTA KUTUSU
// ============================================================
const { testSmtpConnection } = require('../smtp/sender');

router.post('/smtp/test', async (req, res) => {
    res.json(await testSmtpConnection(req.body));
});

router.get('/auto-monitors', (req, res) => {
    res.json(listAutoMonitors().map(({ email, updatedAt }) => ({ email, updatedAt: updatedAt || null })));
});

router.delete('/auto-monitors/:email', (req, res) => {
    removeAutoMonitor(decodeURIComponent(req.params.email));
    res.json({ success: true });
});

router.get('/scan-mailboxes', (req, res) => {
    const settings = loadSettings();
    res.json((settings.scanMailboxes || []).map(smb => ({
        ...smb,
        reportMode:   smb.reportMode === 'all' ? 'all' : 'risky',
        reportTo:     smb.reportTo || '',
        imapPassword: smb.imapPassword ? '****' : '',
        smtpPassword: smb.smtpPassword ? '****' : ''
    })));
});

router.post('/scan-mailboxes', async (req, res) => {
    const {
        imapHost, imapPort, imapEmail, imapPassword, imapTls,
        smtpHost, smtpPort, smtpPassword,
        reportLang, enabled, reportMode, reportTo, reportToForwarder
    } = req.body;

    if (!imapHost)     return res.status(400).json({ error: 'IMAP sunucu adresi zorunludur.' });
    if (!imapEmail)    return res.status(400).json({ error: 'E-posta adresi zorunludur.' });
    if (!imapPassword) return res.status(400).json({ error: 'IMAP şifresi zorunludur.' });

    const license = checkLicense(req);
    if (!license.features?.scanMailbox)
        return res.status(403).json({ error: 'Tarama Posta Kutusu Pro veya Enterprise lisansı gerektirir.' });
    if (reportMode === 'all' && license.plan !== 'enterprise')
        return res.status(403).json({ error: 'Tüm mailler raporlama modu yalnızca Enterprise lisansında kullanılabilir.' });

    const current   = loadSettings();
    const mailboxes = current.scanMailboxes || [];
    const idx       = mailboxes.findIndex(s => s.imapEmail === imapEmail);

    // Sistemde yalnızca 1 merkezi raporlama mail hesabı kurulabilir (tüm lisans tipleri)
    if (idx < 0 && mailboxes.length >= 1) {
        return res.status(403).json({
            error: 'Yalnızca 1 merkezi raporlama mail hesabı tanımlanabilir. Mevcut hesabı silip yenisini ekleyebilirsiniz.',
            limitReached: true
        });
    }

    // Şifreleri şifrele, düz metin saklanmasın
    const { encrypt } = require('../imap/connection');
    const entry = {
        imapEmail,
        imapHost,
        imapPort:          Number(imapPort) || 993,
        imapPassword:      encrypt(imapPassword),
        imapTls:           imapTls !== false && imapTls !== 'false',
        smtpHost:          smtpHost || imapHost,
        smtpPort:          Number(smtpPort) || 587,
        smtpPassword:      smtpPassword ? encrypt(smtpPassword) : encrypt(imapPassword),
        reportLang:        reportLang || 'tr',
        reportMode:        reportMode === 'all' ? 'all' : 'risky',
        reportTo:          reportToForwarder ? '' : (reportTo || ''),
        reportToForwarder: reportToForwarder === true,
        enabled:           enabled !== false && enabled !== 'false'
    };

    if (idx >= 0) mailboxes[idx] = entry; else mailboxes.push(entry);
    saveSettings({ ...current, scanMailboxes: mailboxes });

    const existing = scanMailboxMonitors.get(imapEmail);
    if (existing) { await existing.stop(); scanMailboxMonitors.delete(imapEmail); }
    if (entry.enabled) await startScanMailboxMonitor(entry).catch(e => console.error('[ScanMailbox] Start error:', e.message));

    res.json({ success: true, count: mailboxes.length });
});

router.delete('/scan-mailboxes/:email', async (req, res) => {
    const imapEmail = decodeURIComponent(req.params.email);
    const monitor   = scanMailboxMonitors.get(imapEmail);
    if (monitor) { await monitor.stop(); scanMailboxMonitors.delete(imapEmail); }

    const current = loadSettings();
    saveSettings({ ...current, scanMailboxes: (current.scanMailboxes || []).filter(s => s.imapEmail !== imapEmail) });
    res.json({ success: true });
});

router.patch('/scan-mailboxes/:email', async (req, res) => {
    const imapEmail = decodeURIComponent(req.params.email);
    if (req.body.reportMode === 'all') {
        const license = checkLicense(req);
        if (license.plan !== 'enterprise')
            return res.status(403).json({ error: 'Tüm mailler raporlama modu yalnızca Enterprise lisansında kullanılabilir.' });
    }

    const current   = loadSettings();
    const mailboxes = current.scanMailboxes || [];
    const idx       = mailboxes.findIndex(s => s.imapEmail === imapEmail);
    if (idx < 0) return res.status(404).json({ error: 'Scan mailbox not found' });

    mailboxes[idx] = { ...mailboxes[idx], ...req.body, imapEmail };
    saveSettings({ ...current, scanMailboxes: mailboxes });

    const existing = scanMailboxMonitors.get(imapEmail);
    if (existing) { await existing.stop(); scanMailboxMonitors.delete(imapEmail); }
    if (mailboxes[idx].enabled) await startScanMailboxMonitor(mailboxes[idx]).catch(e => console.error('[ScanMailbox] Restart error:', e.message));

    res.json({ success: true });
});

// ============================================================
// LİSANS ENDPOINT'LERİ
// ============================================================
router.post('/license/validate', async (req, res) => {
    const key    = String(req.body.key || '');
    const result = validateLicenseKey(key);
    if (!result.valid) return res.json(result);

    try {
        const remote = await checkRemoteLicense(key);
        if (!remote.allowed) {
            return res.json({
                valid: false,
                error: remote.revokedAt
                    ? `License revoked (${new Date(remote.revokedAt).toLocaleDateString('tr-TR')})`
                    : 'License revoked or blocked by remote server',
                remoteSource: remote.source
            });
        }
        result.remoteCheck = { source: remote.source, graceRemainingHours: remote.graceRemainingHours };
    } catch (e) {
        result.remoteCheck = { source: 'error', error: e.message };
    }

    res.json(result);
});

router.post('/license/generate', requireAdminAuth, (req, res) => {
    const { plan, tier, duration, reseller, count } = req.body;
    if (count && count > 1) return res.json({ keys: generateBatchKeys(plan, tier, duration, count, reseller) });
    res.json({ key: generateLicenseKey(plan, tier, duration, reseller) });
});

router.get('/license/prices', (req, res) => {
    res.json(getPriceTable(state.customPrices));
});

router.post('/license/prices', (req, res) => {
    state.customPrices = req.body.prices || null;
    const current = loadSettings();
    saveSettings({ ...current, customPrices: state.customPrices });
    res.json({ success: true });
});

router.get('/license/tiers', (req, res) => {
    res.json({ plans: PLANS, tiers: TIERS, durations: DURATIONS });
});

router.post('/license/revoke', requireAdminAuth, (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Lisans anahtarı gerekli' });
    revokeKey(key);
    res.json({ success: true, message: `Lisans iptal edildi: ${key}` });
});

router.post('/license/unrevoke', requireAdminAuth, (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Lisans anahtarı gerekli' });
    unRevokeKey(key);
    res.json({ success: true, message: `Lisans iptali kaldırıldı: ${key}` });
});

router.get('/license/revoked', requireAdminAuth, (req, res) => {
    res.json(loadRevocationList());
});

router.get('/license/usage', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    res.json({ monthlyCount: getMonthlyCount(), monthKey: getCurrentMonthKey(), dailyCount: getDailyCount(today) });
});

// ============================================================
// ADMİN — DURUM / YÖNETİM
// ============================================================
const SERVER_START_TIME = new Date();

router.get('/admin/status', (req, res) => {
    const uptimeSec = Math.floor((Date.now() - SERVER_START_TIME.getTime()) / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const mins  = Math.floor((uptimeSec % 3600) / 60);
    const secs  = uptimeSec % 60;
    res.json({
        status: 'running',
        startedAt:  SERVER_START_TIME.toISOString(),
        uptime:     uptimeSec,
        uptimeLabel:`${hours}s ${mins}d ${secs}sn`,
        nodeVersion:process.version,
        platform:   process.platform,
        memoryMB:   Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
});

router.post('/admin/restart', requireAdminAuth, (req, res) => {
    res.json({ success: true, message: 'Servis yeniden başlatılıyor...' });
    res.on('finish', () => setTimeout(() => {
        console.log('[Admin] Servis yeniden başlatma komutu alındı. Çıkılıyor...');
        process.exit(0);
    }, 300));
});

router.post('/admin/stop', requireAdminAuth, (req, res) => {
    res.json({ success: true, message: 'Servis durduruluyor...' });
    res.on('finish', () => setTimeout(() => {
        console.log('[Admin] Servis durdurma komutu alındı. Çıkılıyor...');
        process.exit(2);
    }, 300));
});

// ─── OTP Şifre Sıfırlama ─────────────────────────────────
const { sendReportEmail } = require('../smtp/sender');

router.post('/admin/send-reset-code', async (req, res) => {
    if (!RECOVERY_EMAIL)
        return res.status(503).json({ error: 'Kurtarma e-postası yapılandırılmamış. MSA_RECOVERY_EMAIL ortam değişkenini ayarlayın.' });

    const otp = generateOtp('admin-reset');
    if (otp.cooldown) {
        const secsLeft = Math.ceil(otp.cooldownMs / 1000);
        return res.status(429).json({ error: `Yeni kod için ${secsLeft} saniye bekleyin.`, cooldownSeconds: secsLeft });
    }

    const smtpConfig = getReportingSmtpConfig();
    if (!smtpConfig)
        return res.status(503).json({ error: 'SMTP yapılandırması bulunamadı. Önce bir Tarama Posta Kutusu hesabı ekleyin.' });

    const maskedEmail = RECOVERY_EMAIL.replace(/(.{2}).+(@.+)/, '$1***$2');
    const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:24px;background:#0f172a;font-family:Arial,sans-serif;color:#e5e7eb"><div style="max-width:480px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px"><div style="font-size:20px;font-weight:800;color:#f8fafc;margin-bottom:8px">🔐 Admin Şifre Sıfırlama</div><div style="font-size:13px;color:#94a3b8;margin-bottom:24px">MailTrustAI</div><div style="font-size:14px;color:#cbd5e1;margin-bottom:20px">Aşağıdaki doğrulama kodunu girerek admin şifrenizi sıfırlayabilirsiniz:</div><div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#38bdf8;background:#0f172a;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">${otp.code}</div><div style="font-size:12px;color:#64748b">Bu kod <strong style="color:#94a3b8">10 dakika</strong> geçerlidir. Siz talep etmediyseniz bu e-postayı dikkate almayın.</div></div></body></html>`;

    const sendResult = await sendReportEmail({ smtpConfig, to: RECOVERY_EMAIL,
        from: `"MailTrustAI" <${smtpConfig.smtpUser}>`,
        subject: `[MailTrustAI] Admin Şifre Sıfırlama Kodu: ${otp.code}`, htmlBody });

    if (!sendResult.success)
        return res.status(502).json({ error: `E-posta gönderilemedi: ${sendResult.error}` });

    console.log(`[Admin] Şifre sıfırlama kodu ${maskedEmail} adresine gönderildi.`);
    res.json({ success: true, maskedEmail, message: `Doğrulama kodu ${maskedEmail} adresine gönderildi.` });
});

router.post('/admin/verify-reset-code', async (req, res) => {
    const { code, newPassword } = req.body;
    if (!code || !newPassword)  return res.status(400).json({ error: 'Doğrulama kodu ve yeni şifre gereklidir.' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır.' });

    const result = verifyOtp('admin-reset', code);
    if (!result.valid) {
        const messages = {
            'expired':           'Doğrulama kodunun süresi dolmuş. Yeni kod isteyin.',
            'no-code':           'Geçerli bir doğrulama kodu yok. Lütfen önce kod isteyin.',
            'too-many-attempts': 'Çok fazla hatalı giriş. Yeni kod isteyin.',
            'wrong-code':        `Hatalı kod. ${result.attemptsLeft ?? ''} deneme hakkınız kaldı.`
        };
        return res.status(401).json({ error: messages[result.reason] || 'Geçersiz kod.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const current = loadSettings();
    saveSettings({ ...current, adminPassword: hashedPassword });

    console.log('[Admin] Şifre OTP doğrulaması ile başarıyla değiştirildi.');
    res.json({ success: true, message: 'Admin şifresi başarıyla güncellendi.' });
});

// ============================================================
// RESELLER'LAR
// ============================================================
router.get('/resellers',    requireAdminAuth, (req, res) => res.json(loadResellers()));
router.post('/resellers',   requireAdminAuth, (req, res) => res.json(addReseller(req.body)));
router.delete('/resellers/:id', requireAdminAuth, (req, res) => {
    removeReseller(req.params.id);
    res.json({ success: true });
});

// ============================================================
// AYARLAR
// ============================================================
router.post('/settings/keys', requireAdminAuth, async (req, res) => {
    const updateKey = (current, incoming) => {
        if (incoming === undefined) return current;
        if (incoming === ':clear') return '';
        if (typeof incoming === 'string' && incoming.trim() === '') return current;
        return incoming;
    };
    state.vtApiKey     = updateKey(state.vtApiKey,     req.body.vtApiKey);
    state.claudeApiKey = updateKey(state.claudeApiKey, req.body.claudeApiKey);
    state.openaiApiKey = updateKey(state.openaiApiKey, req.body.openaiApiKey);
    state.otxApiKey    = updateKey(state.otxApiKey,    req.body.otxApiKey);

    if (req.body.openaiModel !== undefined) {
        state.openaiModel = req.body.openaiModel === ':clear'
            ? '' : (String(req.body.openaiModel || '').trim() || state.openaiModel);
    }

    const current = loadSettings();
    let adminPassword = current.adminPassword;
    if (req.body.adminPassword !== undefined) {
        adminPassword = req.body.adminPassword ? await bcrypt.hash(req.body.adminPassword, 10) : '';
    }

    saveSettings({ ...current,
        vtApiKey: state.vtApiKey, claudeApiKey: state.claudeApiKey,
        openaiApiKey: state.openaiApiKey, openaiModel: state.openaiModel,
        otxApiKey: state.otxApiKey,
        companyProfile: { ...(current.companyProfile || {}), ...(req.body.companyProfile || {}) },
        adminPassword
    });

    res.json({ success: true,
        vtConfigured:    !!state.vtApiKey,
        claudeConfigured:!!state.claudeApiKey,
        openaiConfigured:!!state.openaiApiKey,
        openaiModel:     state.openaiModel || OPENAI_MODEL,
        otxConfigured:   !!state.otxApiKey,
        companyProfile:  loadSettings().companyProfile || {}
    });
});

// ─── OTX bağlantı testi ──────────────────────────────────────
router.post('/settings/otx/test', requireAdminAuth, async (req, res) => {
    const { queryIndicator } = require('../integrations/otx');
    const apiKey = req.body.otxApiKey || state.otxApiKey;
    if (!apiKey) return res.status(400).json({ error: 'OTX API anahtarı tanımlı değil' });
    // Bilinen temiz IP ile test sorgusu: Google DNS
    const result = await queryIndicator('IPv4', '8.8.8.8', apiKey);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: `OTX API bağlantısı başarılı — pulse sayısı: ${result.pulseCount ?? '?'}` });
});

router.get('/settings/status', (req, res) => {
    const settings = loadSettings();
    res.json({
        vtConfigured:    !!state.vtApiKey,
        claudeConfigured:!!state.claudeApiKey,
        openaiConfigured:!!state.openaiApiKey,
        openaiModel:     state.openaiModel || OPENAI_MODEL,
        availableModels: AVAILABLE_OPENAI_MODELS,
        otxConfigured:   !!state.otxApiKey,
        companyProfile:  settings.companyProfile || {}
    });
});

router.get('/settings/webhook', (req, res) => {
    const s = loadSettings();
    res.json({ webhookEnabled: s.webhookEnabled || false, webhookUrl: s.webhookUrl || '', webhookMinLevel: s.webhookMinLevel || 'low' });
});

router.post('/settings/webhook', (req, res) => {
    const current = loadSettings();
    saveSettings({ ...current,
        webhookEnabled:  !!req.body.webhookEnabled,
        webhookUrl:      String(req.body.webhookUrl || '').trim(),
        webhookMinLevel: ['safe','low','medium','high'].includes(req.body.webhookMinLevel) ? req.body.webhookMinLevel : 'low'
    });
    res.json({ success: true });
});

router.post('/settings/webhook/test', async (req, res) => {
    const url = req.body.webhookUrl || loadSettings().webhookUrl;
    if (!url) return res.status(400).json({ error: 'Webhook URL gerekli' });
    res.json(await testWebhook(url));
});

// ============================================================
// RAPORLAR
// ============================================================
router.get('/reports/settings', (req, res) => {
    res.json(normalizePeriodicReportSettings(loadSettings().periodicReports));
});

router.post('/reports/settings', (req, res) => {
    const current   = loadSettings();
    const existing  = normalizePeriodicReportSettings(current.periodicReports);
    const recipients = normalizeReportRecipients(req.body.recipients);
    const enabledRecipients = req.body.enabledRecipients !== undefined
        ? normalizeReportRecipients(req.body.enabledRecipients).filter(e => recipients.includes(e))
        : existing.enabledRecipients.filter(e => recipients.includes(e));
    const next = { ...existing, recipients, enabledRecipients,
        daily:   req.body.daily   !== false && req.body.daily   !== 'false',
        weekly:  req.body.weekly  !== false && req.body.weekly  !== 'false',
        monthly: req.body.monthly !== false && req.body.monthly !== 'false',
        lastSent: existing.lastSent || {} };
    saveSettings({ ...current, periodicReports: next });
    res.json({ success: true, settings: next });
});

router.post('/reports/send', async (req, res) => {
    const period = String(req.body.period || 'daily');
    if (!PERIODS[period]) return res.status(400).json({ error: 'Invalid report period' });

    const targetMailbox = String(req.body.targetEmail || '').trim();
    const recipients = req.body.recipients !== undefined
        ? normalizeReportRecipients(req.body.recipients)
        : (targetMailbox ? [targetMailbox] : getAutoSummaryReportRecipients());

    const result = await sendPeriodicSummaryReport({ period, recipients, targetMailbox, reason: 'manual' });
    res.status(result.success ? 200 : 400).json(result);
});

router.get('/reports/preview/:period', (req, res) => {
    const period = String(req.params.period || 'daily');
    if (!PERIODS[period]) return res.status(400).json({ error: 'Invalid report period' });
    const targetMailbox = String(req.query.targetEmail || '').trim();
    const history = loadScanHistory();
    const range   = resolveRange(period);
    const rows    = filterRowsForReport(history, range.start, range.end, targetMailbox);
    res.json({
        period, targetMailbox,
        range: { start: range.start.toISOString(), end: range.end.toISOString() },
        stats: summarizeRows(rows), count: rows.length
    });
});

// ============================================================
// GEÇMİŞ / İSTATİSTİK
// ============================================================
router.get('/history', (req, res) => {
    state.scanHistory = loadScanHistory();
    res.json(state.scanHistory.slice(0, 50));
});

router.get('/stats', (req, res) => {
    state.scanHistory = loadScanHistory();
    const today = new Date().toISOString().slice(0, 10);
    const history = state.scanHistory;

    // Risk seviyesi dağılımı
    const byLevel = { high: 0, medium: 0, low: 0, safe: 0 };
    for (const s of history) {
        const lvl = s.level || 'safe';
        if (byLevel[lvl] !== undefined) byLevel[lvl]++;
        else byLevel.safe++;
    }

    // Tarama kaynağı dağılımı
    const bySource = {};
    for (const s of history) {
        const src = s.scanSource || 'unknown';
        bySource[src] = (bySource[src] || 0) + 1;
    }

    // Son 7 günlük tarama trendi
    const trend7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const count = history.filter(s => (s.timestamp || s.scanTime || '').slice(0, 10) === dateStr).length;
        trend7.push({ date: dateStr, count });
    }

    // Tehdit kategorileri (son 200 taramadan en sık findings kategorileri)
    const catCount = {};
    for (const s of history.slice(0, 200)) {
        for (const f of (s.findings || [])) {
            if (f.severity === 'critical' || f.severity === 'warning') {
                const cat = f.category || 'other';
                catCount[cat] = (catCount[cat] || 0) + 1;
            }
        }
    }
    const topCategories = Object.entries(catCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([category, count]) => ({ category, count }));

    // VirusTotal & OTX isabet oranları
    const vtHits  = history.filter(s => s.vtStatus?.checked && (s.findings || []).some(f => f.category === 'virusTotal' && f.severity === 'critical')).length;
    const otxHits = history.filter(s => (s.findings || []).some(f => f.category === 'otx')).length;

    res.json({
        totalScans:    history.length,
        todayScans:    getDailyCount(today),
        monthlyScans:  getMonthlyCount(),
        threats:       byLevel.high,
        accounts:      loadCredentials().length,
        byLevel,
        bySource,
        trend7,
        topCategories,
        vtHits,
        otxHits
    });
});

// ============================================================
// ALLOWLIST / BLOCKLIST
// ============================================================
router.get('/lists', (req, res) => res.json(loadLists()));

router.post('/lists/allowlist', (req, res) => {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain gerekli' });
    addToAllowlist(domain);
    res.json({ success: true, lists: loadLists() });
});

router.delete('/lists/allowlist/:domain', (req, res) => {
    removeFromAllowlist(decodeURIComponent(req.params.domain));
    res.json({ success: true, lists: loadLists() });
});

router.post('/lists/blocklist', (req, res) => {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain gerekli' });
    addToBlocklist(domain);
    res.json({ success: true, lists: loadLists() });
});

router.delete('/lists/blocklist/:domain', (req, res) => {
    removeFromBlocklist(decodeURIComponent(req.params.domain));
    res.json({ success: true, lists: loadLists() });
});

// ============================================================
// TEHDİT İSTİHBARATI
// ============================================================
router.get('/threat-intel/stats', (req, res) => res.json(getThreatIntelStats()));

router.post('/threat-intel/refresh', requireAdminAuth, async (req, res) => {
    try {
        await refreshThreatIntel();
        res.json({ success: true, stats: getThreatIntelStats() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// CSV EXPORT
// ============================================================
router.get('/history/export.csv', (req, res) => {
    const history = loadScanHistory();
    const limit   = Math.min(Number(req.query.limit) || 500, 1000);
    const rows    = history.slice(0, limit);

    const headers  = ['Tarih','Seviye','Skor','Gonderen','Alici','Konu','Ek_Sayisi','VT_Zararli','AI_Seviye'];
    const csvLines = [headers.join(',')];

    for (const row of rows) {
        const meta = row.emailMeta || {};
        const from = (meta.from?.[0]?.address || '').replace(/,/g, ';');
        const to   = (meta.to?.[0]?.address   || '').replace(/,/g, ';');
        const subj = String(meta.subject || '').replace(/,/g, ';').replace(/"/g, "'").slice(0, 100);
        const attCount    = meta.attachmentCount || (Array.isArray(row.attachmentDetails) ? row.attachmentDetails.length : 0);
        const vtMalicious = (row.virusTotal || []).reduce((s, v) => s + (v.stats?.malicious || 0), 0);
        const aiLevel     = row.openaiAnalysis?.threatLevel || '';
        const date        = row.timestamp ? new Date(row.timestamp).toISOString().slice(0, 19).replace('T', ' ') : '';
        csvLines.push([date, row.level || '', row.score || 0, from, to, `"${subj}"`, attCount, vtMalicious, aiLevel].join(','));
    }

    const csv = '﻿' + csvLines.join('\r\n'); // UTF-8 BOM for Excel
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mailtrustai-tarama-gecmisi-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
});

module.exports = router;
