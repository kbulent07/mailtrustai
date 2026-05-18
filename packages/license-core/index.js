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
// TIER MATRIX — Tarama sayısı limitleri (T1–T9)
// Plan özellikleri belirler; tier aylık tarama kotasını belirler.
// ============================================================
const TIER_MATRIX = {
    T1: { monthlyScanCount:      50, label: 'T1 (50/ay)' },
    T2: { monthlyScanCount:     100, label: 'T2 (100/ay)' },
    T3: { monthlyScanCount:     250, label: 'T3 (250/ay)' },
    T4: { monthlyScanCount:     500, label: 'T4 (500/ay)' },
    T5: { monthlyScanCount:    1000, label: 'T5 (1.000/ay)' },
    T6: { monthlyScanCount:    2000, label: 'T6 (2.000/ay)' },
    T7: { monthlyScanCount:    5000, label: 'T7 (5.000/ay)' },
    T8: { monthlyScanCount:   10000, label: 'T8 (10.000/ay)' },
    T9: { monthlyScanCount: 9999999, label: 'T9 (Sınırsız)' }
};

// ============================================================
// PLAN MATRIX — Özellik setleri (plan seçimi)
// tier alanı artık lisansta ayrıca saklanır (T1–T9);
// buradaki tier varsayılan/fallback değerdir.
// ============================================================
const PLAN_MATRIX = {
    trial: {
        tier: 'T1',
        graceDays: 1,
        features: {
            imapMonitor: true, deepAi: false, pdfReport: false, quarantine: false,
            siemWebhook: false, multiMailbox: false, localAi: false,
            centralApiProxy: false, centralListSync: true, centralPolicySync: true
        },
        limits: { monthlyScanCount: 50, mailboxCount: 1, userCount: 1 }
    },
    pro: {
        tier: 'T5',
        graceDays: 3,
        features: {
            imapMonitor: true, deepAi: true, pdfReport: true, quarantine: true,
            siemWebhook: false, multiMailbox: true, localAi: false,
            centralApiProxy: false, centralListSync: true, centralPolicySync: true
        },
        limits: { monthlyScanCount: 1000, mailboxCount: 10, userCount: 10 }
    },
    enterprise: {
        tier: 'T9',
        graceDays: 7,
        features: {
            imapMonitor: true, deepAi: true, pdfReport: true, quarantine: true,
            siemWebhook: true, multiMailbox: true, localAi: true,
            centralApiProxy: true, centralListSync: true, centralPolicySync: true
        },
        limits: { monthlyScanCount: 9999999, mailboxCount: 1000, userCount: 1000 }
    }
};

/**
 * Plan + tier birleşimi için final tanımı döner.
 * @param {string} plan  - 'trial' | 'pro' | 'enterprise'
 * @param {string} [tier] - 'T1'…'T9' (yoksa plan varsayılanı)
 */
function getPlan(plan, tier) {
    const base = PLAN_MATRIX[plan] || PLAN_MATRIX.trial;
    const t    = (tier && TIER_MATRIX[tier]) ? tier : base.tier;
    const scanCount = TIER_MATRIX[t]?.monthlyScanCount ?? base.limits.monthlyScanCount;
    return {
        ...base,
        tier: t,
        limits: { ...base.limits, monthlyScanCount: scanCount }
    };
}

function getTier(tier) { return TIER_MATRIX[tier] || null; }

function generateLicenseKey({ customerId, dealerId, plan = 'trial' }) {
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
    getPlan, getTier,
    generateLicenseKey, signActivation, verifyActivationSig
};
