'use strict';
const express = require('express');
const { asyncH, envInt } = require('@mailtrustai/shared');
const { db } = require('../db');

const router = express.Router();

function onlineThresholds() {
    return {
        online: (envInt('HEARTBEAT_ONLINE_THRESHOLD_SECONDS', 300)) * 1000,
        stale:  (envInt('HEARTBEAT_STALE_THRESHOLD_SECONDS', 1800)) * 1000
    };
}
function statusOf(lastHbAt) {
    const t = onlineThresholds();
    if (!lastHbAt) return 'never';
    const age = Date.now() - lastHbAt;
    if (age <= t.online) return 'online';
    if (age <= t.stale)  return 'stale';
    return 'offline';
}

function customerRowToStatus(row) {
    return {
        customerId: row.customer_id,
        companyName: row.company_name,
        dealerId: row.dealer_id,
        licenseStatus: row.lic_status,
        plan: row.plan,
        tier: row.tier,
        expiresAt: row.expires_at,
        instanceId: row.instance_id,
        appVersion: row.app_version,
        lastHeartbeatAt: row.last_heartbeat_at,
        onlineStatus: statusOf(row.last_heartbeat_at),
        healthStatus: (() => {
            try { return JSON.parse(row.last_payload_json || '{}').healthStatus || null; } catch (_) { return null; }
        })(),
        monthlyScanCount: (() => {
            try { return JSON.parse(row.last_payload_json || '{}').monthlyScanCount ?? null; } catch (_) { return null; }
        })(),
        enabledFeatures: (() => {
            try { return JSON.parse(row.last_payload_json || '{}').enabledFeatures || {}; } catch (_) { return {}; }
        })(),
        localPolicyVersion:    (() => { try { return JSON.parse(row.last_payload_json || '{}').localPolicyVersion ?? null; } catch (_) { return null; } })(),
        localWhitelistVersion: (() => { try { return JSON.parse(row.last_payload_json || '{}').localWhitelistVersion ?? null; } catch (_) { return null; } })(),
        localBlacklistVersion: (() => { try { return JSON.parse(row.last_payload_json || '{}').localBlacklistVersion ?? null; } catch (_) { return null; } })(),
        localApiConfigVersion: (() => { try { return JSON.parse(row.last_payload_json || '{}').localApiConfigVersion ?? null; } catch (_) { return null; } })()
    };
}

const baseQuery = `
SELECT c.id AS customer_id, c.company_name, c.dealer_id,
       l.status AS lic_status, l.plan, l.tier, l.expires_at,
       a.instance_id, a.app_version, a.last_heartbeat_at, a.last_payload_json
FROM customers c
LEFT JOIN licenses l ON l.customer_id = c.id AND l.status='active'
LEFT JOIN activations a ON a.license_id = l.id
`;

router.get('/central/customers', asyncH((req, res) => {
    const rows = db.prepare(baseQuery).all();
    res.json({ count: rows.length, customers: rows.map(customerRowToStatus) });
}));

router.get('/central/customers/:customerId/status', asyncH((req, res) => {
    const rows = db.prepare(baseQuery + ' WHERE c.id = ?').all(req.params.customerId);
    res.json({ customerId: req.params.customerId, instances: rows.map(customerRowToStatus) });
}));

router.get('/central/customers/:customerId/instances', asyncH((req, res) => {
    const rows = db.prepare(`
        SELECT a.* FROM activations a
        JOIN licenses l ON l.id = a.license_id
        WHERE l.customer_id = ?`).all(req.params.customerId);
    res.json({ customerId: req.params.customerId, instances: rows });
}));

router.get('/central/dealers/:dealerId/customers/status', asyncH((req, res) => {
    const rows = db.prepare(baseQuery + ' WHERE c.dealer_id = ?').all(req.params.dealerId);
    res.json({ dealerId: req.params.dealerId, customers: rows.map(customerRowToStatus) });
}));

module.exports = router;
