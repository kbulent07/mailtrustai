'use strict';

const express = require('express');
const { asyncH, envInt, safeJSON } = require('@mailtrustai/shared');
const { all } = require('../db');

const router = express.Router();

function onlineThresholds() {
    return {
        online: envInt('HEARTBEAT_ONLINE_THRESHOLD_SECONDS', 300) * 1000,
        stale: envInt('HEARTBEAT_STALE_THRESHOLD_SECONDS', 1800) * 1000
    };
}

function statusOf(lastHeartbeatAt) {
    const thresholds = onlineThresholds();
    if (!lastHeartbeatAt) return 'never';
    const age = Date.now() - lastHeartbeatAt;
    if (age <= thresholds.online) return 'online';
    if (age <= thresholds.stale) return 'stale';
    return 'offline';
}

function customerRowToStatus(row) {
    const payload = safeJSON(row.last_payload_json, {});

    return {
        customerId: row.customer_id,
        companyName: row.company_name,
        dealerId: row.dealer_id,
        licenseId: row.license_id || null,
        licenseStatus: row.lic_status,
        keyMasked: row.license_key_masked || null,
        licenseLabel: row.license_label || null,
        plan: row.plan,
        tier: row.tier,
        issuedAt: row.license_issued_at || null,
        expiresAt: row.expires_at,
        graceDays: row.grace_days ?? null,
        customerEmail: row.customer_email || null,
        contactName: row.contact_name || null,
        contactEmail: row.contact_email || null,
        contactPhone: row.contact_phone || null,
        phone: row.phone || null,
        customerCreatedAt: row.customer_created_at || null,
        instanceId: row.instance_id,
        appVersion: row.app_version,
        activatedAt: row.activated_at || null,
        lastHeartbeatAt: row.last_heartbeat_at,
        onlineStatus: statusOf(row.last_heartbeat_at),
        healthStatus: payload.healthStatus || null,
        monthlyScanCount: payload.monthlyScanCount ?? null,
        enabledFeatures: payload.enabledFeatures || {},
        localPolicyVersion: payload.localPolicyVersion ?? null,
        localWhitelistVersion: payload.localWhitelistVersion ?? null,
        localBlacklistVersion: payload.localBlacklistVersion ?? null,
        localApiConfigVersion: payload.localApiConfigVersion ?? null
    };
}

const baseQuery = `
SELECT c.id AS customer_id, c.company_name, c.dealer_id, c.email AS customer_email,
       c.contact_name, c.contact_email, c.contact_phone, c.phone,
       c.created_at AS customer_created_at,
       l.id AS license_id, l.status AS lic_status, l.plan, l.tier, l.expires_at,
       l.license_key_masked, l.label AS license_label,
       l.issued_at AS license_issued_at, l.grace_days,
       a.instance_id, a.app_version, a.activated_at, a.last_heartbeat_at, a.last_payload_json
FROM customers c
LEFT JOIN licenses l ON l.customer_id = c.id AND l.status='active'
LEFT JOIN activations a ON a.license_id = l.id
`;

router.get('/central/customers', asyncH(async (req, res) => {
    const rows = await all(baseQuery);
    res.json({ count: rows.length, customers: rows.map(customerRowToStatus) });
}));

router.get('/central/customers/:customerId/status', asyncH(async (req, res) => {
    const rows = await all(`${baseQuery} WHERE c.id = ?`, [req.params.customerId]);
    res.json({ customerId: req.params.customerId, instances: rows.map(customerRowToStatus) });
}));

router.get('/central/customers/:customerId/instances', asyncH(async (req, res) => {
    // Dealer scope: optional query param. Bayi sadece kendi müşterilerini görebilir.
    const dealerId = req.query.dealerId;
    const rows = dealerId
        ? await all(
            `SELECT a.* FROM activations a
             JOIN licenses l ON l.id = a.license_id
             JOIN customers c ON c.id = l.customer_id
             WHERE l.customer_id = ? AND c.dealer_id = ?`,
            [req.params.customerId, dealerId]
        )
        : await all(
            `SELECT a.id, a.license_id, a.instance_id, a.app_version, a.build_version,
                    a.node_version, a.environment, a.activated_at, a.last_heartbeat_at
             FROM activations a
             JOIN licenses l ON l.id = a.license_id
             WHERE l.customer_id = ?`,
            [req.params.customerId]
        );
    res.json({ customerId: req.params.customerId, dealerId: dealerId || null, instances: rows });
}));

router.get('/central/dealers/:dealerId/customers/status', asyncH(async (req, res) => {
    const rows = await all(`${baseQuery} WHERE c.dealer_id = ?`, [req.params.dealerId]);
    res.json({ dealerId: req.params.dealerId, customers: rows.map(customerRowToStatus) });
}));

module.exports = router;
