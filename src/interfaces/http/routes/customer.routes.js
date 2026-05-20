// ============================================================
// HTTP routes: müşteri yönetim paneli auth (email + şifre, rol bazlı)
// ============================================================
const express = require('express');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');

const customerAuth = require('../../../middleware/customerAuth');
const { requireAdminAuth } = require('../../../middleware/adminAuth');
const { validateLicenseKey } = require('../../../license/license');
const { cleanupInitialCredsFile } = require('../../../services/initialSetupService');
const customerUserStore = require('../../../storage/customerUserStore');
const { sendSystemEmail } = require('../../../smtp/sender');

// Timing-safe string karşılaştırma — setup token bilgi sızıntısını engeller.
function _tokenEquals(a, b) {
    if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

const router = express.Router();

// /customer/status — front-end başlangıçta login/setup formundan hangisi olduğunu
// öğrenmek için çağırır. Lisans köprüsü desteği korundu.
router.get('/customer/status', (req, res) => {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    const parsed = token ? customerAuth.parseCustomerToken(token) : null;
    let valid = !!parsed;
    let bridgeToken = null;
    let role = parsed?.role || null;
    let email = parsed?.email || null;

    // Token yoksa veya geçersizse: x-license-key ile fallback yetkilendirme.
    // Lisans köprüsü yalnız admin rolünde çalışır — kullanıcılar email/parola ile girer.
    if (!valid) {
        const licKey = String(req.headers['x-license-key'] || req.query.licenseKey || '');
        if (licKey) {
            const result = validateLicenseKey(licKey);
            if (result.valid && customerAuth.hasAnyAdmin()) {
                // İlk admin'i bul (geriye uyumluluk: tek-admin senaryosu)
                const admins = customerUserStore.listAll().filter(u => u.role === 'admin' && u.active);
                const firstAdmin = admins[0];
                if (firstAdmin) {
                    valid = true;
                    role = 'admin';
                    email = firstAdmin.email;
                    bridgeToken = customerAuth.createCustomerToken({
                        email: firstAdmin.email, role: 'admin', imapEmail: null
                    });
                }
            }
        }
    }

    res.json({
        // Geriye uyumlu alanlar
        passwordSet:  customerAuth.isCustomerInitialized(),
        sessionValid: valid,
        bridgeToken,
        // Yeni alanlar
        initialized:  customerAuth.isCustomerInitialized(),
        role,
        email,
        imapEmail:    parsed?.imapEmail || null
    });
});

// /customer/setup — İlk admin'i kur (email + şifre)
router.post('/customer/setup', async (req, res) => {
    try {
        if (customerAuth.isCustomerInitialized()) {
            return res.status(409).json({ error: 'Müşteri admin zaten ayarlanmış. Sıfırlamak için kurtarma akışını kullanın.' });
        }

        // Setup token brute-force koruması — login ile aynı rate limiter kullanılır.
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const rate = customerAuth.checkLoginRate(ip);
        if (!rate.allowed) {
            return res.status(429).json({
                error: `Çok fazla deneme. ${Math.ceil(rate.retryAfter / 60)} dakika sonra deneyin.`,
                retryAfter: rate.retryAfter
            });
        }

        // İlk kurulum hijack koruması: localhost VEYA MSA_SETUP_TOKEN
        const ipRaw = String(req.ip || req.connection?.remoteAddress || '');
        const isLocal = /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1|localhost)$/i.test(ipRaw);
        const expectedToken = process.env.MSA_SETUP_TOKEN || '';
        const providedToken = String(
            req.headers['x-setup-token'] ||
            req.query?.setup_token ||
            req.body?.setupToken ||
            ''
        );
        const tokenMatch = _tokenEquals(expectedToken, providedToken);

        if (!isLocal && !tokenMatch) {
            // Debug log: 403 nedenini docker logs ile görebilmek için (token'lar maskeli)
            const _mask = (s) => s ? (String(s).slice(0, 4) + '...' + String(s).slice(-4) + ` (len=${String(s).length})`) : '<empty>';
            console.warn('[Setup-403] ip=' + ipRaw +
                ' expected=' + _mask(expectedToken) +
                ' provided=' + _mask(providedToken) +
                ' src=' + (req.headers['x-setup-token'] ? 'header' :
                           req.query?.setup_token ? 'query' :
                           req.body?.setupToken ? 'body' : 'none'));
            return res.status(403).json({
                error: 'İlk kurulum yalnızca localhost veya geçerli MSA_SETUP_TOKEN ile yapılabilir.',
                hint: 'Sunucu .env dosyasına MSA_SETUP_TOKEN ekleyin ve URL\'ye ?setup_token=... ekleyin.'
            });
        }

        const email    = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        if (!email || !customerUserStore._isValidEmail(email)) {
            return res.status(400).json({ error: 'Geçerli bir e-posta adresi gerekli.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
        }

        const admin = await customerAuth.createCustomerUser({
            email, password, role: 'admin', imapEmail: null, active: true
        });
        customerUserStore.touchLogin(admin.email);
        customerAuth.clearLoginRate(ip); // başarılı kurulumda rate limiter'ı sıfırla

        const token = customerAuth.createCustomerToken({
            email: admin.email, role: 'admin', imapEmail: null
        });
        console.log(`[Setup] İlk müşteri admin oluşturuldu: ${admin.email} (kaynak: ${isLocal ? 'localhost' : 'setup-token'})`);
        cleanupInitialCredsFile();
        res.json({ success: true, token, expiresIn: 12 * 3600, email: admin.email, role: 'admin' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// /customer/login — Email + şifre ile giriş
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

        const email    = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        if (!email || !password) return res.status(400).json({ error: 'E-posta ve şifre zorunludur.' });

        const user = await customerAuth.verifyCustomerCredentials(email, password);
        if (!user) return res.status(403).json({ error: 'Geçersiz e-posta veya şifre.' });

        customerAuth.clearLoginRate(ip);
        customerUserStore.touchLogin(user.email);
        cleanupInitialCredsFile();

        const token = customerAuth.createCustomerToken({
            email: user.email, role: user.role, imapEmail: user.imapEmail
        });

        res.json({
            success:   true,
            token,
            expiresIn: 12 * 3600,
            email:     user.email,
            role:      user.role,
            imapEmail: user.imapEmail
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── MAGIC LINK: şifremi unuttum ─────────────────────────────
// Aynı e-postaya 5 dk cooldown uygulanır.
const _forgotCooldown = new Map(); // email → timestamp

router.post('/customer/forgot-password', async (req, res) => {
    // Her zaman 200 dön — kullanıcıya e-posta varlığını sızdırma.
    const genericOk = () => res.json({ ok: true });

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!customerUserStore._isValidEmail(email)) return genericOk();

    const user = customerUserStore.findByEmail(email);
    if (!user || !user.active) return genericOk();

    // 5 dakika cooldown
    const now = Date.now();
    const lastSent = _forgotCooldown.get(email) || 0;
    if (now - lastSent < 5 * 60 * 1000) return genericOk();

    const token   = uuidv4().replace(/-/g, '');
    const expires = new Date(now + 60 * 60 * 1000).toISOString(); // 1 saat
    customerUserStore.setResetToken(email, token, expires);
    _forgotCooldown.set(email, now);

    // Sunucu kökenini belirle
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host  = req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost:3000';
    const resetUrl = `${proto}://${host}/?reset_token=${token}`;

    const html = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#6366f1">MailTrustAI — Şifre Sıfırlama</h2>
          <p>Merhaba,</p>
          <p>Hesabınız için şifre sıfırlama talebinde bulunuldu.</p>
          <p style="margin:24px 0">
            <a href="${resetUrl}"
               style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
              Şifremi Sıfırla
            </a>
          </p>
          <p style="color:#888;font-size:13px">Bu bağlantı <strong>1 saat</strong> geçerlidir.<br>
          Talebi siz yapmadıysanız bu e-postayı görmezden gelebilirsiniz.</p>
        </div>`;

    await sendSystemEmail({
        to:      email,
        subject: 'MailTrustAI — Şifre Sıfırlama Bağlantısı',
        htmlBody: html
    });

    return genericOk();
});

router.post('/customer/reset-password', async (req, res) => {
    try {
        const token    = String(req.body?.token || '').trim();
        const password = String(req.body?.password || '');

        if (!token)           return res.status(400).json({ error: 'Token gerekli.' });
        if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });

        const row = customerUserStore.findByResetToken(token);
        if (!row) return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş bağlantı.' });

        await customerUserStore.setPassword(row.email, password);
        customerUserStore.clearResetToken(row.email);
        _forgotCooldown.delete(row.email);

        res.json({ ok: true, email: row.email });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// validate token endpoint — sayfa yüklenirken tokenin hâlâ geçerli olup olmadığını kontrol eder
router.get('/customer/reset-password/validate', (req, res) => {
    const token = String(req.query.token || '').trim();
    const row   = customerUserStore.findByResetToken(token);
    if (!row) return res.status(400).json({ valid: false, error: 'Geçersiz veya süresi dolmuş bağlantı.' });
    res.json({ valid: true, email: row.email });
});

// Eski endpoint — admin paneli üzerinden müşteri şifre sıfırlama.
// Artık herhangi bir müşteri kullanıcısının şifresini admin token ile sıfırlar.
router.post('/customer/reset', requireAdminAuth, async (req, res) => {
    try {
        const targetEmail = String(req.body?.email || '').trim().toLowerCase();
        const password    = String(req.body?.password || '');
        if (password.length < 6) {
            return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
        }
        if (!targetEmail) {
            // Geriye uyumluluk: email verilmemişse ilk admin'i sıfırla
            const admins = customerUserStore.listAll().filter(u => u.role === 'admin' && u.active);
            if (!admins.length) return res.status(404).json({ error: 'Sıfırlanacak admin yok.' });
            await customerUserStore.setPassword(admins[0].email, password);
            return res.json({ success: true, email: admins[0].email });
        }
        await customerUserStore.setPassword(targetEmail, password);
        res.json({ success: true, email: targetEmail });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
