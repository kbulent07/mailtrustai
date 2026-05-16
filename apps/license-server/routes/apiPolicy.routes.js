'use strict';

const express = require('express');
const { asyncH } = require('@mailtrustai/shared');
const { get, run, audit, isMaria } = require('../db');

const router = express.Router();

async function getApiPolicy(customerId) {
    const row = await get('SELECT * FROM api_policies WHERE customer_id=?', [customerId]);
    if (!row) {
        return {
            customerId,
            version: 0,
            body: {
                allowedProviders: ['openai', 'claude', 'virustotal', 'otx'],
                rateLimit: null,
                dailyQuota: null,
                monthlyQuota: null,
                centralApiProxyEnabled: false
            }
        };
    }
    return { customerId, version: row.version, body: JSON.parse(row.body_json), updatedAt: row.updated_at };
}

router.get('/config/:customerId/api-policy', asyncH(async (req, res) => {
    res.json(await getApiPolicy(req.params.customerId));
}));

router.post('/config/:customerId/api-policy', asyncH(async (req, res) => {
    const current = await get('SELECT version FROM api_policies WHERE customer_id=?', [req.params.customerId]);
    const nextVersion = (current?.version || 0) + 1;
    const sql = isMaria
        ? `INSERT INTO api_policies(customer_id,version,body_json,updated_at) VALUES(?,?,?,?)
           ON DUPLICATE KEY UPDATE version=VALUES(version), body_json=VALUES(body_json), updated_at=VALUES(updated_at)`
        : `INSERT INTO api_policies(customer_id,version,body_json,updated_at) VALUES(?,?,?,?)
           ON CONFLICT(customer_id) DO UPDATE SET version=excluded.version, body_json=excluded.body_json, updated_at=excluded.updated_at`;

    await run(sql, [req.params.customerId, nextVersion, JSON.stringify(req.body || {}), Date.now()]);
    await audit('admin', 'api-policy.update', req.params.customerId, { version: nextVersion });
    res.json({ ok: true, version: nextVersion });
}));

router.get('/config/:customerId/version', asyncH(async (req, res) => {
    const row = await get('SELECT version FROM api_policies WHERE customer_id=?', [req.params.customerId]);
    res.json({ customerId: req.params.customerId, version: row?.version || 0 });
}));

module.exports = { router, getApiPolicy };
