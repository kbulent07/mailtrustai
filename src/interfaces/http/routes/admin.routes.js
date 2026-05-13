// ============================================================
// HTTP routes: admin oturum, durum, restart/stop, şifre sıfırlama (OTP)
// ============================================================
const express = require('express');
const bcrypt  = require('bcrypt');

const { requireAdminAuth, verifyAdminPassword, createAdminToken } =
    require('../../../middleware/adminAuth');
const { loadSettings, saveSettings } = require('../../../storage/settingsStore');
const { generateOtp, verifyOtp } = require('../../../utils/otpStore');
const { getReportingSmtpConfig } = require('../../../services/reportService');
const { sendReportEmail } = require('../../../smtp/sender');
const { loadAuditLog, recordAudit } = require('../../../storage/auditLog');
const { cleanupInitialCredsFile } = require('../../../services/initialSetupService');

const RECOVERY_EMAIL = process.env.MSA_RECOVERY_EMAIL || '';

const router = express.Router();

// ─── Admin login rate limit (IP başına 8 deneme / 15 dk) ──
const _adminAttempts = new Map();
const ADMIN_MAX_ATTEMPTS = 8;
const ADMIN_WINDOW_MS = 15 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of _adminAttempts.entries()) {
        if (now > rec.resetAt) _adminAttempts.delete(ip);
    }
}, 5 * 60 * 1000).unref();

function _checkAdminLoginRate(ip) {
    const now = Date.now();
    const rec = _adminAttempts.get(ip);
    if (!rec || now > rec.resetAt) {
        _adminAttempts.set(ip, { count: 1, resetAt: now + ADMIN_WINDOW_MS });
        return { allowed: true };
    }
    rec.count++;
    if (rec.count > ADMIN_MAX_ATTEMPTS) {
        return { allowed: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
    }
    return { allowed: true };
}

router.post('/admin/session', async (req, res) => {
    try {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const rate = _checkAdminLoginRate(ip);
        if (!rate.allowed) {
            return res.status(429).json({
                error: `Çok fazla hatalı giriş. ${Math.ceil(rate.retryAfter / 60)} dakika sonra deneyin.`,
                retryAfter: rate.retryAfter
            });
        }

        const { adminPassword } = req.body || {};
        if (!adminPassword) return res.status(400).json({ error: 'adminPassword zorunludur' });
        const valid = await verifyAdminPassword(adminPassword);
        if (!valid) {
            recordAudit({ req, actorType: 'admin', actorId: 'admin', action: 'admin.login', status: 'failure' });
            return res.status(403).json({ error: 'Geçersiz admin şifresi' });
        }
        _adminAttempts.delete(ip);
        const token = createAdminToken();
        recordAudit({ req, actorType: 'admin', actorId: 'admin', action: 'admin.login', status: 'success' });
        
        // İlk şifre dosyasını temizle (varsa)
        cleanupInitialCredsFile();
        
        res.json({ token, expiresIn: 8 * 3600 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Durum / yönetim ─────────────────────────────────────
const SERVER_START_TIME = new Date();

router.get('/admin/status', (req, res) => {
    const uptimeSec = Math.floor((Date.now() - SERVER_START_TIME.getTime()) / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const mins  = Math.floor((uptimeSec % 3600) / 60);
    const secs  = uptimeSec % 60;
    res.json({
        status:       'running',
        startedAt:    SERVER_START_TIME.toISOString(),
        uptime:       uptimeSec,
        uptimeLabel: `${hours}s ${mins}d ${secs}sn`,
        nodeVersion:  process.version,
        platform:     process.platform,
        memoryMB:     Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
});

router.get('/audit-log', requireAdminAuth, (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
    res.json(loadAuditLog(limit));
});

// Restart: outer api.js guard (Bearer / x-license-key / x-admin-password)
// yetkili kişi girişini zaten doğruladığı için burada ek admin auth aranmıyor.
//
// İşleyiş: Mevcut süreci sonlandırmadan ÖNCE, aynı argümanlarla bağımsız (detached)
// bir alt süreç fırlatıyoruz. Bu sayede npm start, doğrudan node, batch wrapper veya
// Windows Service ile başlatılmış olsa bile yeniden başlatma çalışır.
router.post('/admin/restart', (req, res) => {
    res.json({ success: true, message: 'Servis yeniden başlatılıyor...' });
    res.on('finish', () => setTimeout(() => {
        try {
            const { spawn } = require('child_process');
            const cwd       = process.cwd();
            const node      = process.execPath;
            const script    = process.argv[1];
            const scriptArgs = process.argv.slice(2);
            const nodeArgs   = [...process.execArgv, script, ...scriptArgs];

            // cmd.exe yerine node-tabanlı wrapper kullanıyoruz — Windows'ta
            // konsol penceresi açılmasını engellemek için. Wrapper ~3 sn bekleyip
            // gerçek sunucuyu detached + windowsHide ile fırlatır, sonra çıkar.
            const wrapperCode = `
                const { spawn } = require('child_process');
                setTimeout(() => {
                    try {
                        const child = spawn(${JSON.stringify(node)},
                            ${JSON.stringify(nodeArgs)},
                            {
                                detached: true,
                                stdio: 'ignore',
                                cwd: ${JSON.stringify(cwd)},
                                env: process.env,
                                windowsHide: true
                            });
                        child.unref();
                    } catch (e) { /* sessiz */ }
                    process.exit(0);
                }, 3000);
            `;

            console.log('[Admin] Servis yeniden başlatılıyor — detached wrapper fırlatılıyor...');
            console.log(`[Admin]   exec: ${node} (wrapper -e ...)`);
            console.log(`[Admin]   cwd : ${cwd}`);

            const child = spawn(node, ['-e', wrapperCode], {
                detached:    true,
                stdio:       'ignore',
                cwd,
                env:         process.env,
                windowsHide: true   // CREATE_NO_WINDOW — konsol penceresi açılmaz
            });
            child.unref();

            setTimeout(() => {
                console.log('[Admin] Eski süreç kapatılıyor.');
                process.exit(0);
            }, 500);
        } catch (e) {
            console.error('[Admin] Yeniden başlatma alt süreci fırlatılamadı:', e);
            // Yine de çık — wrapper varsa en azından kapanma davranışı korunur
            process.exit(0);
        }
    }, 300));
});

router.post('/admin/stop', requireAdminAuth, (req, res) => {
    if (process.env.MSA_ALLOW_REMOTE_SHUTDOWN !== 'true') {
        return res.status(403).json({
            error: 'Uzaktan kapatma devre dışı. Etkinleştirmek için .env dosyasında MSA_ALLOW_REMOTE_SHUTDOWN=true yapın.'
        });
    }
    res.json({ success: true, message: 'Servis durduruluyor...' });
    res.on('finish', () => setTimeout(() => {
        console.log('[Admin] Servis durdurma komutu alındı. Çıkılıyor...');
        process.exit(2);
    }, 300));
});

// ─── OTP Şifre Sıfırlama ─────────────────────────────────
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
    const logoHeader =
        `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:20px"><tr>` +
        `<td style="background:#1e3a8a;background:linear-gradient(135deg,#1e3a8a,#3b82f6 60%,#8b5cf6);width:44px;height:44px;border-radius:9px;text-align:center;vertical-align:middle;font-size:24px;line-height:44px;color:#ffffff;font-weight:900">&#128737;</td>` +
        `<td style="padding-left:12px;vertical-align:middle"><div style="font-size:17px;font-weight:800;color:#f8fafc;letter-spacing:.3px">MailTrustAI</div><div style="font-size:10px;color:#94a3b8;letter-spacing:1px;margin-top:2px">SCAN &middot; ANALYZE &middot; EVALUATE &middot; PROTECT</div></td>` +
        `</tr></table>`;
    const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:24px;background:#0f172a;font-family:Arial,sans-serif;color:#e5e7eb"><div style="max-width:480px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px">${logoHeader}<div style="font-size:20px;font-weight:800;color:#f8fafc;margin-bottom:8px">🔐 Admin Şifre Sıfırlama</div><div style="font-size:14px;color:#cbd5e1;margin:18px 0 20px">Aşağıdaki doğrulama kodunu girerek admin şifrenizi sıfırlayabilirsiniz:</div><div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#38bdf8;background:#0f172a;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">${otp.code}</div><div style="font-size:12px;color:#64748b">Bu kod <strong style="color:#94a3b8">10 dakika</strong> geçerlidir. Siz talep etmediyseniz bu e-postayı dikkate almayın.</div></div></body></html>`;

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

module.exports = router;
