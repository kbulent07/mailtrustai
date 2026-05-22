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
    let daysLeft     = null;
    let expiresAt    = null;

    // Onceligi license-client snapshot (server-side dogrulanmis lisans)
    // Fallback: legacy validateLicenseKey HMAC
    try {
        const licenseClient = require('@mailtrustai/license-client');
        const snap = licenseClient.getSnapshot?.();
        if (snap && snap.licenseStatus === 'active') {
            const ml = snap.limits?.monthlyScanCount;
            if (typeof ml === 'number' && ml > 0) {
                monthlyLimit = ml;
                unlimited    = ml >= 1e9;
            }
            if (snap.expiresAt) {
                expiresAt = snap.expiresAt;
                daysLeft  = Math.max(0, Math.ceil((snap.expiresAt - Date.now()) / 86400000));
            }
            if (snap.licenseKeyHash) {
                usageScope = String(snap.licenseKeyHash).slice(0, 16);
            }
        }
    } catch (_) { /* license-client yok ya da snapshot bos — legacy fallback'e gec */ }

    // Legacy HMAC fallback (snapshot yoksa veya license-client yuklu degilse)
    if (usageScope === 'unlicensed' && key) {
        try {
            const v = validateLicenseKey(key);
            if (v.valid) {
                if (monthlyLimit === 30) monthlyLimit = v.monthlyLimit ?? 30;
                if (!unlimited)          unlimited    = monthlyLimit === Infinity;
                const crypto = require('crypto');
                usageScope   = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
                if (daysLeft === null && v.daysLeft !== undefined) daysLeft = v.daysLeft;
            }
        } catch (_) { /* ignore */ }
    }
    // Hem license-scoped hem global sayim — UI 'remaining' icin license-scoped'i
    // kullanir (quota dogru takip), ama monthlyCount ve dailyCount kullaniciya
    // genel olarak gosterilir (eski davranis ile uyumlu).
    const monthlyScoped = getMonthlyCount(undefined, usageScope);
    const monthlyGlobal = getMonthlyCount(undefined, 'global');
    const dailyGlobal   = getDailyCount(today);
    const remaining     = unlimited ? null : Math.max(0, monthlyLimit - monthlyScoped);
    res.json({
        monthlyCount: monthlyGlobal,
        monthlyScopedCount: monthlyScoped,
        monthKey: getCurrentMonthKey(),
        dailyCount: dailyGlobal,
        monthlyLimit: unlimited ? null : monthlyLimit,
        remaining,
        unlimited,
        // UI badge'i icin: kalan gun + expiry timestamp
        daysLeft,
        expiresAt
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
