'use strict';
// !!! GÜVENLİK: Bu paket CUSTOMER IMAGE içinde bulunmamalıdır.
// scripts/check-customer-package.js bunu fiziksel olarak doğrular.

const crypto = require('crypto');
const { sha256 } = require('@mailtrustai/security');

function SECRET() {
    const s = process.env.LICENSE_SIGNING_SECRET;
    if (!s || s === 'CHANGE_ME_DEV_ONLY' || s === 'CHANGE_ME') {
        if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
            throw new Error('LICENSE_SIGNING_SECRET production\'da zorunludur (license-core).');
        }
        return 'CHANGE_ME_DEV_ONLY';
    }
    return s;
}

// ============================================================
// TIER MATRIX — Mail tarama kapasitesi seviyeleri (1–9)
// Plan (pro/enterprise) hangi özelliklerin açık olduğunu belirler;
// tier (T1–T9) aylık mail tarama kapasitesini belirler.
// Pro 5 ile Enterprise 5 AYNI kapasiteye sahiptir; fark özelliklerdedir.
//
//   creditCost : Bayi bu tier'da lisans/ek-paket üretirken düşülen kredi.
//   adminOnly  : Yalnızca merkezi admin üretebilir; bayi panelinde gizli.
//   custom     : Kapasite sabit değil — admin lisans üretirken belirler.
// ============================================================
const TIER_MATRIX = {
    T1: { monthlyScanCount:    50, creditCost:  1, label: 'T1 (50/ay)' },
    T2: { monthlyScanCount:   100, creditCost:  2, label: 'T2 (100/ay)' },
    T3: { monthlyScanCount:   250, creditCost:  3, label: 'T3 (250/ay)' },
    T4: { monthlyScanCount:   500, creditCost:  4, label: 'T4 (500/ay)' },
    T5: { monthlyScanCount:  1000, creditCost:  5, label: 'T5 (1.000/ay)' },
    T6: { monthlyScanCount:  2500, creditCost:  7, label: 'T6 (2.500/ay)' },
    T7: { monthlyScanCount:  5000, creditCost:  9, label: 'T7 (5.000/ay)' },
    T8: { monthlyScanCount: 10000, creditCost: 12, label: 'T8 (10.000/ay)' },
    // T9 = özel (custom). Kapasite admin tarafından belirlenir, bayi üretemez.
    T9: { monthlyScanCount: null, creditCost: 0, adminOnly: true, custom: true, label: 'T9 (Özel / Custom)' }
};

// ============================================================
// PLAN MATRIX — Özellik setleri (plan seçimi)
// tier alanı artık lisansta ayrıca saklanır (T1–T9);
// buradaki tier varsayılan/fallback değerdir.
// ============================================================
const PLAN_MATRIX = {
    pro: {
        tier: 'T5',
        graceDays: 3,
        features: {
            manualUpload: true, headerAnalysis: true, attachmentScan: true,
            contentAnalysis: 'advanced', virusTotal: true, pdfReport: true, jsonReport: false,
            imapMonitor: true, deepAi: true, quarantine: true,
            siemWebhook: false, multiMailbox: true, localAi: false,
            centralApiProxy: false, centralListSync: true, centralPolicySync: true,
            scanMailbox: true, realtimeAlert: false,
            imapConnection: false, inboxScan: false, autoMonitor: false,
            batchScan: false, apiAccess: false
            // dailyLimit ve linkLimit JSON-Infinity uyumsuz — appState.js türetir
        },
        limits: { monthlyScanCount: 1000, mailboxCount: 10, userCount: 10 }
    },
    enterprise: {
        tier: 'T8',
        graceDays: 7,
        features: {
            manualUpload: true, headerAnalysis: true, attachmentScan: true,
            contentAnalysis: 'advanced', virusTotal: true, pdfReport: true, jsonReport: true,
            imapMonitor: true, deepAi: true, quarantine: true,
            siemWebhook: true, multiMailbox: true, localAi: true,
            centralApiProxy: true, centralListSync: true, centralPolicySync: true,
            scanMailbox: true, realtimeAlert: true,
            imapConnection: true, inboxScan: true, autoMonitor: true,
            batchScan: true, apiAccess: true
            // dailyLimit ve linkLimit JSON-Infinity uyumsuz — appState.js türetir
        },
        limits: { monthlyScanCount: 10000, mailboxCount: 1000, userCount: 1000 }
    }
};

/**
 * Plan + tier birleşimi için final tanımı döner.
 * @param {string} plan  - 'pro' | 'enterprise'
 * @param {string} [tier] - 'T1'…'T9' (yoksa plan varsayılanı)
 * @param {object} [opts] - { customScanCount } — yalnız T9 (custom) için kapasite
 */
function getPlan(plan, tier, opts = {}) {
    const base = PLAN_MATRIX[plan] || PLAN_MATRIX.pro;
    const t    = (tier && TIER_MATRIX[tier]) ? tier : base.tier;
    const tierDef = TIER_MATRIX[t] || {};

    // T9 (custom): kapasite admin tarafından verilir. Verilmezse plan tabanına düş.
    let scanCount;
    if (tierDef.custom) {
        const c = Number(opts.customScanCount);
        scanCount = (Number.isFinite(c) && c > 0) ? c : base.limits.monthlyScanCount;
    } else {
        scanCount = tierDef.monthlyScanCount ?? base.limits.monthlyScanCount;
    }

    return {
        ...base,
        tier: t,
        creditCost: tierDef.creditCost ?? 1,
        limits: { ...base.limits, monthlyScanCount: scanCount }
    };
}

/**
 * Bir tier'ın bayi kredi maliyetini döner (T9 = 0, çünkü bayi üretemez).
 */
function tierCreditCost(tier) {
    return TIER_MATRIX[tier]?.creditCost ?? 1;
}

/**
 * Tier yalnızca admin tarafından mı üretilebilir? (T9 custom)
 */
function isAdminOnlyTier(tier) {
    return !!TIER_MATRIX[tier]?.adminOnly;
}

function getTier(tier) { return TIER_MATRIX[tier] || null; }

function generateLicenseKey({ customerId, dealerId, plan = 'pro' }) {
    const raw = `${customerId}|${dealerId || ''}|${plan}|${Date.now()}|${crypto.randomBytes(8).toString('hex')}`;
    const sig = crypto.createHmac('sha256', SECRET()).update(raw).digest('hex').slice(0, 16);
    const key = `MTAI-${plan.toUpperCase().slice(0, 4)}-${crypto.randomBytes(6).toString('hex').toUpperCase()}-${sig.toUpperCase()}`;
    return { key, keyHash: sha256(key) };
}

function signActivation(payload) {
    const json = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', SECRET()).update(json).digest('hex');
    return { payload, sig };
}

function verifyActivationSig({ payload, sig }) {
    const expect = crypto.createHmac('sha256', SECRET()).update(JSON.stringify(payload)).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig)); } catch (_) { return false; }
}

module.exports = {
    PLAN_MATRIX, TIER_MATRIX,
    getPlan, getTier, tierCreditCost, isAdminOnlyTier,
    generateLicenseKey, signActivation, verifyActivationSig
};
