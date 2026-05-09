// ============================================================
// HTTP routes: müşteri yönetim paneli (index.html erişim şifresi)
// ============================================================
const express = require('express');

const customerAuth        = require('../../../middleware/customerAuth');
const { requireAdminAuth } = require('../../../middleware/adminAuth');
const { validateLicenseKey } = require('../../../license/license');

const router = express.Router();

router.get('/customer/status', (req, res) => {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    let valid = token ? customerAuth.verifyCustomerToken(token) : false;
    let bridgeToken = null;

    // Token yoksa veya geçersizse: x-license-key ile fallback yetkilendirme.
    // Bu sayede tarayıcı sessionStorage'ı sıfırlansa bile (tab kapanması gibi)
    // lisans aktif kaldığı sürece kullanıcı tekrar şifre sormakla karşılaşmaz.
    if (!valid) {
        const licKey = String(req.headers['x-license-key'] || req.query.licenseKey || '');
        if (licKey) {
            const result = validateLicenseKey(licKey);
            if (result.valid) {
                valid = true;
                // Yeni bir kısa süreli müşteri token'ı üret — istemci bunu kullanıp
                // sonraki isteklerde Authorization header'ı olarak gönderebilir.
                bridgeToken = customerAuth.createCustomerToken();
            }
        }
    }

    res.json({
        passwordSet:    customerAuth.isCustomerPasswordSet(),
        sessionValid:   valid,
        bridgeToken                  // null veya yeni token (license bridge)
    });
});

router.post('/customer/setup', async (req, res) => {
    try {
        if (customerAuth.isCustomerPasswordSet()) {
            return res.status(409).json({ error: 'Müşteri şifresi zaten ayarlanmış. Sıfırlamak için admin panelini kullanın.' });
        }

        // İlk kurulum hijack koruması: sadece localhost veya MSA_SETUP_TOKEN
        const ipRaw = String(req.ip || req.connection?.remoteAddress || '');
        const isLocal = /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1|localhost)$/i.test(ipRaw);
        const expectedToken = process.env.MSA_SETUP_TOKEN || '';
        const providedToken = String(req.headers['x-setup-token'] || '');
        const tokenMatch = expectedToken && providedToken && providedToken === expectedToken;

        if (!isLocal && !tokenMatch) {
            return res.status(403).json({
                error: 'İlk kurulum yalnızca sunucuya yerel (localhost) erişimden veya MSA_SETUP_TOKEN env değeri ile yapılabilir.',
                hint: 'Sunucu konsolundaki "ilk kurulum URL"sini kullanın veya .env dosyasına MSA_SETUP_TOKEN ekleyip x-setup-token header ile çağırın.'
            });
        }

        const password = String(req.body?.password || '');
        if (password.length < 6) {
            return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
        }
        await customerAuth.setCustomerPassword(password);
        const token = customerAuth.createCustomerToken();
        console.log(`[Setup] Müşteri yönetim şifresi oluşturuldu (kaynak: ${isLocal ? 'localhost' : 'setup-token'}).`);
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

// Admin paneli üzerinden şifre sıfırlama
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

module.exports = router;
