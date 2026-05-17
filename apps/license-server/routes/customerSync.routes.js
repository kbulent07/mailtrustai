'use strict';

const express = require('express');
const { asyncH, scrubPII, envInt, safeJSON } = require('@mailtrustai/shared');
const { audit, get, run } = require('../db');
const { getList } = require('./lists.routes');
const { getApiPolicy } = require('./apiPolicy.routes');

const router = express.Router();

const FORBIDDEN_KEYS = new Set([
    'mailBody', 'mailSubject', 'sender', 'recipient', 'attachmentName', 'attachmentContent',
    'rawHeaders', 'imapPassword', 'smtpPassword', 'apiKey', 'openaiApiKey', 'claudeApiKey',
    'anthropicApiKey', 'virustotalApiKey', 'credentials', 'aiPrompt', 'aiResponse'
]);
const MAX_PAYLOAD_BYTES = envInt('CUSTOMER_SYNC_MAX_PAYLOAD_BYTES', 16384);
const MAX_WALK_DEPTH = envInt('CUSTOMER_SYNC_MAX_DEPTH', 8);

function ensureNoPII(body) {
    function walk(obj, depth) {
        if (depth > MAX_WALK_DEPTH) {
            const e = new Error(`payload çok derin (max ${MAX_WALK_DEPTH})`); e.status = 413; throw e;
        }
        if (!obj || typeof obj !== 'object') return null;
        for (const key of Object.keys(obj)) {
            if (FORBIDDEN_KEYS.has(key)) return key;
            const nested = walk(obj[key], depth + 1);
            if (nested) return nested;
        }
        return null;
    }

    const hit = walk(body, 0);
    if (hit) {
        const error = new Error(`Heartbeat payload yasak alan içeriyor: ${hit}`);
        error.status = 422;
        throw error;
    }
}

function ensurePayloadSize(payload) {
    const size = Buffer.byteLength(JSON.stringify(payload || {}), 'utf8');
    if (size > MAX_PAYLOAD_BYTES) {
        const error = new Error(`heartbeat payload cok buyuk: ${size} bytes (max ${MAX_PAYLOAD_BYTES})`);
        error.status = 413;
        throw error;
    }
}

// Server-side telemetri whitelist'i. Customer ne yollarsa yollasın, sadece
// bu alanlar DB'de saklanır. Saldırgan instanceId biliyorsa bile dealer panel'i
// "spoof" edemez (rastgele key'ler reddedilir).
const SERVER_HEARTBEAT_KEYS = new Set([
    'appVersion', 'buildVersion', 'nodeVersion', 'environment',
    'healthStatus', 'enabledFeatures', 'services', 'errorSummary',
    'monthlyScanCount', 'dailyScanCount', 'mailboxCount', 'userCount',
    'localPolicyVersion', 'localWhitelistVersion', 'localBlacklistVersion', 'localApiConfigVersion',
    'plan', 'tier', 'licenseStatus', 'hostnameHash', 'lastHeartbeatAt'
]);
function serverWhitelistTelemetry(payload) {
    const out = {};
    for (const k of SERVER_HEARTBEAT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(payload, k)) out[k] = payload[k];
    }
    return scrubPII(out);
}

async function persistHeartbeat(payload) {
    ensureNoPII(payload);
    ensurePayloadSize(payload);
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

    const safeTelemetry = serverWhitelistTelemetry(payload);
    await run(
        'UPDATE activations SET last_heartbeat_at=?, last_payload_json=?, app_version=COALESCE(?,app_version) WHERE license_id=? AND instance_id=?',
        [Date.now(), JSON.stringify(safeTelemetry), payload.appVersion || null, license.id, payload.instanceId]
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

async function authorizePullQuery(query) {
    const { customerId, licenseKeyHash, instanceId } = query || {};
    if (!customerId || !licenseKeyHash || !instanceId) {
        const error = new Error('customerId, licenseKeyHash ve instanceId gerekli');
        error.status = 400;
        throw error;
    }

    const license = await get('SELECT id, customer_id FROM licenses WHERE license_key_hash = ?', [licenseKeyHash]);
    if (!license) {
        const error = new Error('lisans bulunamadi');
        error.status = 404;
        throw error;
    }
    if (license.customer_id !== customerId) {
        const error = new Error('customerId ve lisans eslesmiyor');
        error.status = 403;
        throw error;
    }

    const activation = await get(
        'SELECT id FROM activations WHERE license_id=? AND instance_id=?',
        [license.id, instanceId]
    );
    if (!activation) {
        const error = new Error('aktivasyon bulunamadi');
        error.status = 403;
        throw error;
    }

    return { customerId };
}

router.post('/customer-sync/bootstrap', asyncH(async (req, res) => {
    const body = req.body || {};
    // Önce PII + payload size kontrolünü çalıştır (persistHeartbeat içinde):
    // payload size 413, PII 422 olarak doğrudan dönsün.
    ensureNoPII(body);
    ensurePayloadSize(body);

    // Bootstrap = ilk aktivasyon sonrası policy/lists/apiPolicy bundle çekimi.
    // Aktivasyon kaydı yoksa policy sızıntısını engelle (sadece licenseKeyHash
    // bilen biri tüm bundle'ı çekmesin).
    if (!body.licenseKeyHash || !body.instanceId) {
        return res.status(400).json({ error: 'licenseKeyHash ve instanceId gerekli' });
    }

    const license = await get('SELECT id, customer_id FROM licenses WHERE license_key_hash = ?', [body.licenseKeyHash]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });
    if (body.customerId && license.customer_id !== body.customerId) {
        return res.status(403).json({ error: 'customerId ve lisans eşleşmiyor' });
    }
    const activation = await get(
        'SELECT id FROM activations WHERE license_id=? AND instance_id=?',
        [license.id, body.instanceId]
    );
    if (!activation) {
        return res.status(403).json({ error: 'aktivasyon gerekli — önce /api/license/activate çağırın' });
    }

    await persistHeartbeat(body);
    await audit(license.customer_id, 'customer.bootstrap', license.id, { instanceId: body.instanceId });
    res.json({ ok: true, ...(await bundleForCustomer(license.customer_id)) });
}));

router.post('/customer-sync/heartbeat', asyncH(async (req, res) => {
    await persistHeartbeat(req.body || {});
    res.json({ ok: true, serverTime: Date.now() });
}));

function _safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

router.get('/customer-sync/pull', asyncH(async (req, res) => {
    const { policyV = '0', whitelistV = '0', blacklistV = '0', apiPolicyV = '0' } = req.query;
    const auth = await authorizePullQuery(req.query || {});

    const bundle = await bundleForCustomer(auth.customerId);
    const out = {};
    if (bundle.policy.version > _safeNum(policyV)) out.policy = bundle.policy;
    if (bundle.lists.whitelist.version > _safeNum(whitelistV) || bundle.lists.blacklist.version > _safeNum(blacklistV)) out.lists = bundle.lists;
    if (bundle.apiPolicy.version > _safeNum(apiPolicyV)) out.apiPolicy = bundle.apiPolicy;
    res.json(out);
}));

router.post('/customer-sync/ack', asyncH(async (req, res) => {
    const { customerId, instanceId, licenseKeyHash, applied } = req.body || {};
    // Audit log injection koruması: actor (customerId) attacker-controlled OLAMAZ.
    // licenseKeyHash + instanceId üzerinden customer'ı doğrula, audit'e DB'den
    // gelen customer_id'yi yaz.
    if (!licenseKeyHash || !instanceId) {
        return res.status(400).json({ error: 'licenseKeyHash ve instanceId gerekli' });
    }
    const license = await get('SELECT id, customer_id FROM licenses WHERE license_key_hash=?', [licenseKeyHash]);
    if (!license) return res.status(404).json({ error: 'lisans bulunamadı' });
    if (customerId && license.customer_id !== customerId) {
        return res.status(403).json({ error: 'customerId ve lisans eşleşmiyor' });
    }
    const activation = await get(
        'SELECT id FROM activations WHERE license_id=? AND instance_id=?',
        [license.id, instanceId]
    );
    if (!activation) return res.status(403).json({ error: 'aktivasyon bulunamadı' });

    // `applied` array; her elemanı `{kind, version}` formatında — daha karmaşık
    // payload audit'e yazılmaz.
    const safeApplied = Array.isArray(applied)
        ? applied.slice(0, 32).map(x => ({ kind: String(x?.kind || ''), version: Number(x?.version) || 0 }))
        : [];
    await audit(license.customer_id, 'customer.ack', instanceId, { applied: safeApplied });
    res.json({ ok: true });
}));

module.exports = router;
