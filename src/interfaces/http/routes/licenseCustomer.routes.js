// ============================================================
// HTTP routes: LICENSE — customer-only endpoint'ler
//
// Bu dosya yasak pattern (generateLicenseKey/signActivation/revoke vb.) icermez,
// dolayisiyla customer Docker image'inda check-customer-package gecer.
// Admin endpoint'ler (generate/batch/trial/revoke/unrevoke/revoked/activate-lic)
// asil license.routes.js'de — customer image'a MOUNT EDILMEZ.
// ============================================================
const express = require('express');
const router  = express.Router();

const { buildFingerprintJson }  = require('../../../license/fingerprint');
const { validateLicenseKey }    = require('../../../license/license');
const { loadSettings, saveSettings } = require('../../../storage/settingsStore');
const { getMonthlyCount, getCurrentMonthKey } = require('../../../storage/monthlyCounter');
const { getDailyCount }         = require('../../../storage/dailyScansStore');
const { loadLicenseFile }       = require('../../../license/licenseFile');
const { state }                 = require('../../../services/appState');
const { getPriceTable, PLANS, TIERS, DURATIONS } = require('../../../license/license');

// ── Parmak İzi — müşteri aktivasyon bilgisi ──────────────────
// Standart fingerprint.json formatı (hash'lenmis sinyaller).
router.get('/license/fingerprint', (req, res) => {
    try {
        const fp = buildFingerprintJson();
        res.json(fp);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Aylik/gunluk kullanim ────────────────────────────────────
router.get('/license/usage', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const settings = loadSettings();
    const key = (settings.activeLicenseKey || '').trim();
    let monthlyLimit = 30;
    let usageScope   = 'unlicensed';
    let unlimited    = false;
    if (key) {
        try {
            const v = validateLicenseKey(key);
            if (v.valid) {
                monthlyLimit = v.monthlyLimit ?? 30;
                unlimited    = monthlyLimit === Infinity;
                const crypto = require('crypto');
                usageScope   = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
            }
        } catch (_) { /* ignore */ }
    }
    const monthlyCount = getMonthlyCount(undefined, usageScope);
    const remaining    = unlimited ? null : Math.max(0, monthlyLimit - monthlyCount);
    res.json({
        monthlyCount, monthKey: getCurrentMonthKey(), dailyCount: getDailyCount(today),
        monthlyLimit: unlimited ? null : monthlyLimit,
        remaining,
        unlimited
    });
});

// ── Fiyat tablosu (read-only) ────────────────────────────────
router.get('/license/prices', (req, res) => {
    res.json(getPriceTable(state.customPrices));
});

// ── Plan / tier / duration ────────────────────────────────────
router.get('/license/tiers', (req, res) => {
    res.json({ plans: PLANS, tiers: TIERS, durations: DURATIONS });
});

// ── .lic dosyasi durumu (read-only) ──────────────────────────
router.get('/license/lic-status', (req, res) => {
    try {
        const result = loadLicenseFile(undefined, { force: true });
        if (!result) return res.json({ active: false, message: 'license.lic dosyasi bulunamadi' });
        res.json({ active: result.valid, license: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
