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

// Plan/tier feature/limit tablosu — merkezi license-server tek doğruluk kaynağı.
const PLAN_MATRIX = {
    demo: {
        tier: 'demo',
        graceDays: 1,
        features: { imapMonitor: true, deepAi: false, pdfReport: false, quarantine: false, siemWebhook: false, multiMailbox: false, localAi: false, centralApiProxy: false, centralListSync: true, centralPolicySync: true },
        limits: { monthlyScanCount: 200, mailboxCount: 1, userCount: 1 }
    },
    pro: {
        tier: 'pro',
        graceDays: 3,
        features: { imapMonitor: true, deepAi: true, pdfReport: true, quarantine: true, siemWebhook: false, multiMailbox: true, localAi: false, centralApiProxy: false, centralListSync: true, centralPolicySync: true },
        limits: { monthlyScanCount: 20000, mailboxCount: 10, userCount: 10 }
    },
    enterprise: {
        tier: 'enterprise',
        graceDays: 7,
        features: { imapMonitor: true, deepAi: true, pdfReport: true, quarantine: true, siemWebhook: true, multiMailbox: true, localAi: true, centralApiProxy: true, centralListSync: true, centralPolicySync: true },
        limits: { monthlyScanCount: 1000000, mailboxCount: 1000, userCount: 1000 }
    }
};
function getPlan(plan) { return PLAN_MATRIX[plan] || PLAN_MATRIX.demo; }

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

module.exports = { PLAN_MATRIX, getPlan, generateLicenseKey, signActivation, verifyActivationSig };
