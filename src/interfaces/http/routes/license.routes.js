// ============================================================
// HTTP routes: lisans yönetimi (validate / activate / trial /
// generate / prices / tiers / revoke / unrevoke / revoked / usage)
// ============================================================
const express = require('express');

const {
    validateLicenseKey, generateLicenseKey, generateBatchKeys,
    getPriceTable, PLANS, TIERS, DURATIONS,
    revokeKey, unRevokeKey, loadRevocationList, isRevoked
} = require('../../../license/license');
const { checkRemoteLicense, getCachedStatus } = require('../../../license/remoteValidator');
const { buildFingerprintJson } = require('../../../license/fingerprint');
const { loadLicenseFile, validateLicenseFile, invalidateCache } = require('../../../license/licenseFile');
const { loadSettings, saveSettings } = require('../../../storage/settingsStore');
const { getMonthlyCount, getCurrentMonthKey } = require('../../../storage/monthlyCounter');
const { getDailyCount } = require('../../../storage/dailyScansStore');
const { state } = require('../../../services/appState');
const { requireAdminAuth } = require('../../../middleware/adminAuth');
const { recordAudit } = require('../../../storage/auditLog');

const router = express.Router();

function _maskKey(k) {
    if (!k) return '';
    const s = String(k);
    if (s.length <= 12) return s;
    return s.slice(0, 8) + '…' + s.slice(-4);
}

// ─── MERKEZİ LİSANS SUNUCUSU ENDPOINT'İ (müşteri sunucularından çağrılır) ───
// Müşteri sunucusunun src/license/remoteValidator.js modülü bu endpoint'i
// MSA_LICENSE_REMOTE_URL'e POST atarak periodic olarak sorgular.
//
// İstek :  { key: "MSA-..." }
// Cevap :  { valid: bool, revokedAt: ISO | null, reason?: 'invalid'|'revoked'|'expired'|'ok' }
//
// Public (auth-free) — yalnız genel HTTPS + IP allowlist (varsa nginx katmanında).
// Anahtarın HMAC imzası burada doğrulanır → geçersiz anahtarlar 'valid:false' döner.
// Revoke kontrolü: data/revoked-licenses.json
router.post('/license/check', (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!key) {
        return res.status(400).json({ valid: false, error: 'key required' });
    }

    // 1) Anahtarın format + imza + süre kontrolü
    const v = validateLicenseKey(key);

    if (!v.valid) {
        if (v.error === 'License revoked') {
            // revoked-licenses.json string[] tutuyor — revokedAt yok, null donulur
            return res.json({ valid: false, revokedAt: null, reason: 'revoked' });
        }
        const reason = /expired/i.test(v.error || '') ? 'expired' : 'invalid';
        return res.json({ valid: false, revokedAt: null, reason, error: v.error });
    }

    // 2) Geçerli anahtar — meta bilgi opsiyonel olarak geri dönelim
    res.json({
        valid: true,
        revokedAt: null,
        reason: 'ok',
        plan: v.plan,
        tier: v.tier,
        duration: v.duration,
        expiryDate: v.expiryDate,
        daysLeft: v.daysLeft
    });
});

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

// Sunucuda kayıtlı (kalıcı) lisans
router.get('/license', (req, res) => {
    try {
        const settings = loadSettings();
        const key = (settings.activeLicenseKey || '').trim();
        if (!key) return res.json({ active: false });

        const result        = validateLicenseKey(key);
        const remote        = getCachedStatus(key);
        const remoteAllowed = !remote || remote.allowed !== false;

        res.json({
            active:        result.valid && remoteAllowed,
            licenseKey:    key,
            maskedKey:     _maskKey(key),
            setAt:         settings.activeLicenseSetAt || null,
            validation:    result,
            remoteAllowed,
            remoteSource:  remote?.source || null
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/license/activate', async (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'Lisans anahtarı zorunludur.' });

    const result = validateLicenseKey(key);
    if (!result.valid) return res.status(400).json({ error: result.error || 'Geçersiz lisans anahtarı.' });

    try {
        const remote = await checkRemoteLicense(key);
        if (!remote.allowed) {
            return res.status(403).json({
                error: remote.revokedAt
                    ? `Lisans iptal edilmiş (${new Date(remote.revokedAt).toLocaleDateString('tr-TR')})`
                    : 'Lisans uzak sunucuda engellenmiş veya iptal edilmiş.',
                remoteSource: remote.source
            });
        }
    } catch (e) {
        console.warn('[License/Activate] Uzak doğrulama erişilemez:', e.message);
    }

    const settings = loadSettings();
    saveSettings({
        ...settings,
        activeLicenseKey:   key,
        activeLicenseSetAt: new Date().toISOString()
    });

    console.log(`[License] Aktif lisans sunucuya kaydedildi: ${_maskKey(key)} (plan=${result.plan}, tier=${result.tier})`);
    recordAudit({
        req,
        actorType: 'customer',
        actorId: 'license',
        action: 'license.activate',
        target: key,
        details: { plan: result.plan, tier: result.tier, duration: result.duration, reseller: result.reseller }
    });
    res.json({
        success: true,
        message: 'Lisans sunucuya kaydedildi. Yeniden başlatma ve versiyon geçişlerinde otomatik korunacak.',
        validation: result,
        maskedKey:  _maskKey(key)
    });
});

// 7 günlük Enterprise trial — yalnızca admin
router.post('/license/trial', requireAdminAuth, async (req, res) => {
    const plan = 'ENT', tier = 'T3', duration = 'T';
    const reseller = String(req.body?.reseller || 'TRIAL').toUpperCase().slice(0, 12);

    const key        = generateLicenseKey(plan, tier, duration, reseller);
    const validation = validateLicenseKey(key);
    if (!validation.valid) return res.status(500).json({ error: 'Trial lisans üretilemedi.' });

    console.log(`[License] Admin trial lisansı üretildi: ${_maskKey(key)} — 7 gün, ENT T3 (reseller=${reseller})`);
    recordAudit({
        req,
        actorType: 'admin',
        actorId: 'admin',
        action: 'license.trial.generate',
        target: key,
        details: { plan, tier, duration, reseller }
    });
    res.json({
        success:   true,
        message:   '7 günlük Enterprise deneme lisansı üretildi.',
        key,
        maskedKey: _maskKey(key),
        validation,
        expiresAt: validation.expiryDate,
        plan, tier, duration
    });
});

router.post('/license/deactivate', (req, res) => {
    const settings = loadSettings();
    if (!settings.activeLicenseKey) {
        return res.status(404).json({ error: 'Sunucuda kayıtlı lisans yok.' });
    }
    saveSettings({ ...settings, activeLicenseKey: '', activeLicenseSetAt: '' });
    console.log('[License] Sunucudaki aktif lisans kaldırıldı.');
    recordAudit({ req, actorType: 'customer', actorId: 'license', action: 'license.deactivate' });
    res.json({ success: true, message: 'Sunucudaki kayıtlı lisans kaldırıldı.' });
});

router.post('/license/generate', requireAdminAuth, (req, res) => {
    const { plan, tier, duration, reseller, count } = req.body;
    if (count && count > 1) {
        const keys = generateBatchKeys(plan, tier, duration, count, reseller);
        recordAudit({
            req,
            actorType: 'admin',
            actorId: 'admin',
            action: 'license.batch.generate',
            details: { plan, tier, duration, reseller, count: keys.length }
        });
        return res.json({ keys });
    }
    const key = generateLicenseKey(plan, tier, duration, reseller);
    recordAudit({
        req,
        actorType: 'admin',
        actorId: 'admin',
        action: 'license.generate',
        target: key,
        details: { plan, tier, duration, reseller }
    });
    res.json({ key });
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
    recordAudit({ req, actorType: 'admin', actorId: 'admin', action: 'license.revoke', target: key });
    res.json({ success: true, message: `Lisans iptal edildi: ${key}` });
});

router.post('/license/unrevoke', requireAdminAuth, (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Lisans anahtarı gerekli' });
    unRevokeKey(key);
    recordAudit({ req, actorType: 'admin', actorId: 'admin', action: 'license.unrevoke', target: key });
    res.json({ success: true, message: `Lisans iptali kaldırıldı: ${key}` });
});

router.get('/license/revoked', requireAdminAuth, (req, res) => {
    res.json(loadRevocationList());
});

router.get('/license/usage', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    res.json({ monthlyCount: getMonthlyCount(), monthKey: getCurrentMonthKey(), dailyCount: getDailyCount(today) });
});

// ── Parmak İzi — müşteri aktivasyon bilgisi ──────────────────
// Standart fingerprint.json formatı döner (hash'lenmiş sinyaller).
router.get('/license/fingerprint', (req, res) => {
    try {
        const fp = buildFingerprintJson();
        res.json(fp);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── .lic dosyası yükleme (base64 veya JSON) ──────────────────
router.post('/license/activate-lic', requireAdminAuth, (req, res) => {
    try {
        const body = req.body;
        let licObj;

        if (body.licenseData) {
            // JSON string veya base64 olarak gönderilmiş olabilir
            try {
                licObj = typeof body.licenseData === 'string'
                    ? JSON.parse(body.licenseData)
                    : body.licenseData;
            } catch {
                return res.status(400).json({ error: 'Geçersiz JSON formatı' });
            }
        } else if (body.payload && body.signature) {
            licObj = body;
        } else {
            return res.status(400).json({ error: 'licenseData veya payload+signature gerekli' });
        }

        const result = validateLicenseFile(licObj);
        if (!result.valid) {
            return res.status(400).json({ error: result.error, detail: result });
        }

        // data/license.lic olarak kaydet
        const fs   = require('fs');
        const path = require('path');
        const dest = path.join(__dirname, '..', '..', '..', '..', 'data', 'license.lic');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(licObj, null, 2), 'utf8');
        invalidateCache();

        recordAudit('license-lic-activated', { serial: result.serial, company: result.company });
        res.json({ success: true, license: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Aktif .lic dosyası bilgisi ────────────────────────────────
router.get('/license/lic-status', (req, res) => {
    try {
        const result = loadLicenseFile(undefined, { force: true });
        if (!result) return res.json({ active: false, message: 'license.lic dosyası bulunamadı' });
        res.json({ active: result.valid, license: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
