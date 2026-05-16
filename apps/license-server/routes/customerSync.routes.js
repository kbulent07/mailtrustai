'use strict';
const express = require('express');
const { asyncH, logger, scrubPII } = require('@mailtrustai/shared');
const { sha256 } = require('@mailtrustai/security');
const { db, audit } = require('../db');
const { getList } = require('./lists.routes');
const { getApiPolicy } = require('./apiPolicy.routes');

const router = express.Router();

// PII koruma: payload'da yasak alanlar varsa hata.
const FORBIDDEN_KEYS = ['mailBody', 'mailSubject', 'sender', 'recipient', 'attachmentName', 'attachmentContent',
    'rawHeaders', 'imapPassword', 'smtpPassword', 'apiKey', 'openaiApiKey', 'claudeApiKey', 'anthropicApiKey',
    'virustotalApiKey', 'credentials', 'aiPrompt', 'aiResponse'];
function ensureNoPII(body) {
    function walk(o) {
        if (!o || typeof o !== 'object') return null;
        for (const k of Object.keys(o)) {
            if (FORBIDDEN_KEYS.includes(k)) return k;
            const r = walk(o[k]);
            if (r) return r;
        }
        return null;
    }
    const hit = walk(body);
    if (hit) {
        const err = new Error(`Heartbeat payload yasak alan içeriyor: ${hit}`);
        err.status = 422;
        throw err;
    }
}

function _persistHeartbeat(payload) {
    ensureNoPII(payload);
    if (!payload.licenseKeyHash || !payload.instanceId) {
        const e = new Error('licenseKeyHash ve instanceId gerekli'); e.status = 400; throw e;
    }
    const lic = db.prepare('SELECT id, customer_id, dealer_id FROM licenses WHERE license_key_hash = ?').get(payload.licenseKeyHash);
    if (!lic) { const e = new Error('lisans bulunamadı'); e.status = 404; throw e; }
    db.prepare(`UPDATE activations SET last_heartbeat_at=?, last_payload_json=?, app_version=COALESCE(?,app_version) WHERE license_id=? AND instance_id=?`)
      .run(Date.now(), JSON.stringify(scrubPII(payload)), payload.appVersion || null, lic.id, payload.instanceId);
    return lic;
}

function _bundleForCustomer(customerId) {
    const policyRow = db.prepare('SELECT * FROM policies WHERE customer_id=?').get(customerId);
    const wl = getList(customerId, 'whitelist');
    const bl = getList(customerId, 'blacklist');
    const ap = getApiPolicy(customerId);
    return {
        policy:    policyRow ? { version: policyRow.version, ...JSON.parse(policyRow.body_json) } : { version: 0, featureOverrides: {}, limits: {} },
        lists:     { version: Math.max(wl.version, bl.version), whitelist: { version: wl.version, ...wl.body }, blacklist: { version: bl.version, ...bl.body } },
        apiPolicy: { version: ap.version, ...ap.body }
    };
}

// POST /api/customer-sync/bootstrap
router.post('/customer-sync/bootstrap', asyncH((req, res) => {
    const lic = _persistHeartbeat(req.body || {});
    audit(lic.customer_id, 'customer.bootstrap', lic.id, { instanceId: req.body.instanceId });
    res.json({ ok: true, ..._bundleForCustomer(lic.customer_id) });
}));

// POST /api/customer-sync/heartbeat
router.post('/customer-sync/heartbeat', asyncH((req, res) => {
    const lic = _persistHeartbeat(req.body || {});
    res.json({ ok: true, serverTime: Date.now() });
}));

// GET /api/customer-sync/pull?customerId=&policyV=&whitelistV=&blacklistV=&apiPolicyV=
router.get('/customer-sync/pull', asyncH((req, res) => {
    const { customerId, policyV = '0', whitelistV = '0', blacklistV = '0', apiPolicyV = '0' } = req.query;
    if (!customerId) return res.status(400).json({ error: 'customerId gerekli' });
    const bundle = _bundleForCustomer(customerId);
    const out = {};
    if (bundle.policy.version    > Number(policyV))     out.policy    = bundle.policy;
    if (bundle.lists.whitelist.version > Number(whitelistV) || bundle.lists.blacklist.version > Number(blacklistV)) out.lists = bundle.lists;
    if (bundle.apiPolicy.version > Number(apiPolicyV))  out.apiPolicy = bundle.apiPolicy;
    res.json(out);
}));

// POST /api/customer-sync/ack
router.post('/customer-sync/ack', asyncH((req, res) => {
    const { customerId, instanceId, applied } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'customerId gerekli' });
    audit(customerId, 'customer.ack', instanceId || null, { applied });
    res.json({ ok: true });
}));

module.exports = router;
