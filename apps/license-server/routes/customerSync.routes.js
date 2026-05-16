'use strict';

const express = require('express');
const { asyncH, scrubPII } = require('@mailtrustai/shared');
const { audit, get, run } = require('../db');
const { getList } = require('./lists.routes');
const { getApiPolicy } = require('./apiPolicy.routes');

const router = express.Router();

const FORBIDDEN_KEYS = [
    'mailBody', 'mailSubject', 'sender', 'recipient', 'attachmentName', 'attachmentContent',
    'rawHeaders', 'imapPassword', 'smtpPassword', 'apiKey', 'openaiApiKey', 'claudeApiKey',
    'anthropicApiKey', 'virustotalApiKey', 'credentials', 'aiPrompt', 'aiResponse'
];

function ensureNoPII(body) {
    function walk(obj) {
        if (!obj || typeof obj !== 'object') return null;
        for (const key of Object.keys(obj)) {
            if (FORBIDDEN_KEYS.includes(key)) return key;
            const nested = walk(obj[key]);
            if (nested) return nested;
        }
        return null;
    }

    const hit = walk(body);
    if (hit) {
        const error = new Error(`Heartbeat payload yasak alan içeriyor: ${hit}`);
        error.status = 422;
        throw error;
    }
}

async function persistHeartbeat(payload) {
    ensureNoPII(payload);
    if (!payload.licenseKeyHash || !payload.instanceId) {
        const error = new Error('licenseKeyHash ve instanceId gerekli');
        error.status = 400;
        throw error;
    }

    const license = await get('SELECT id, customer_id, dealer_id FROM licenses WHERE license_key_hash = ?', [payload.licenseKeyHash]);
    if (!license) {
        const error = new Error('lisans bulunamadı');
        error.status = 404;
        throw error;
    }

    await run(
        'UPDATE activations SET last_heartbeat_at=?, last_payload_json=?, app_version=COALESCE(?,app_version) WHERE license_id=? AND instance_id=?',
        [Date.now(), JSON.stringify(scrubPII(payload)), payload.appVersion || null, license.id, payload.instanceId]
    );

    return license;
}

async function bundleForCustomer(customerId) {
    const policy = await get('SELECT * FROM policies WHERE customer_id=?', [customerId]);
    const whitelist = await getList(customerId, 'whitelist');
    const blacklist = await getList(customerId, 'blacklist');
    const apiPolicy = await getApiPolicy(customerId);

    return {
        policy: policy ? { version: policy.version, ...JSON.parse(policy.body_json) } : { version: 0, featureOverrides: {}, limits: {} },
        lists: {
            version: Math.max(whitelist.version, blacklist.version),
            whitelist: { version: whitelist.version, ...whitelist.body },
            blacklist: { version: blacklist.version, ...blacklist.body }
        },
        apiPolicy: { version: apiPolicy.version, ...apiPolicy.body }
    };
}

router.post('/customer-sync/bootstrap', asyncH(async (req, res) => {
    const license = await persistHeartbeat(req.body || {});
    await audit(license.customer_id, 'customer.bootstrap', license.id, { instanceId: req.body.instanceId });
    res.json({ ok: true, ...(await bundleForCustomer(license.customer_id)) });
}));

router.post('/customer-sync/heartbeat', asyncH(async (req, res) => {
    await persistHeartbeat(req.body || {});
    res.json({ ok: true, serverTime: Date.now() });
}));

router.get('/customer-sync/pull', asyncH(async (req, res) => {
    const { customerId, policyV = '0', whitelistV = '0', blacklistV = '0', apiPolicyV = '0' } = req.query;
    if (!customerId) return res.status(400).json({ error: 'customerId gerekli' });

    const bundle = await bundleForCustomer(customerId);
    const out = {};
    if (bundle.policy.version > Number(policyV)) out.policy = bundle.policy;
    if (bundle.lists.whitelist.version > Number(whitelistV) || bundle.lists.blacklist.version > Number(blacklistV)) out.lists = bundle.lists;
    if (bundle.apiPolicy.version > Number(apiPolicyV)) out.apiPolicy = bundle.apiPolicy;
    res.json(out);
}));

router.post('/customer-sync/ack', asyncH(async (req, res) => {
    const { customerId, instanceId, applied } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'customerId gerekli' });
    await audit(customerId, 'customer.ack', instanceId || null, { applied });
    res.json({ ok: true });
}));

module.exports = router;
