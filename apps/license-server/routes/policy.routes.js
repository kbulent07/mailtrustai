'use strict';

const express = require('express');
const { asyncH } = require('@mailtrustai/shared');
const { get, run, audit, isMaria } = require('../db');

const router = express.Router();

router.get('/policy/:customerId', asyncH(async (req, res) => {
    const row = await get('SELECT * FROM policies WHERE customer_id=?', [req.params.customerId]);
    if (!row) return res.json({ customerId: req.params.customerId, version: 0, body: { featureOverrides: {}, limits: {} } });
    res.json({ customerId: row.customer_id, version: row.version, body: JSON.parse(row.body_json), updatedAt: row.updated_at });
}));

router.post('/policy/:customerId', asyncH(async (req, res) => {
    const current = await get('SELECT version FROM policies WHERE customer_id=?', [req.params.customerId]);
    const nextVersion = (current?.version || 0) + 1;
    const sql = isMaria
        ? `INSERT INTO policies(customer_id,version,body_json,updated_at) VALUES(?,?,?,?)
           ON DUPLICATE KEY UPDATE version=VALUES(version), body_json=VALUES(body_json), updated_at=VALUES(updated_at)`
        : `INSERT INTO policies(customer_id,version,body_json,updated_at) VALUES(?,?,?,?)
           ON CONFLICT(customer_id) DO UPDATE SET version=excluded.version, body_json=excluded.body_json, updated_at=excluded.updated_at`;

    await run(sql, [req.params.customerId, nextVersion, JSON.stringify(req.body || {}), Date.now()]);
    await audit('admin', 'policy.update', req.params.customerId, { version: nextVersion });
    res.json({ ok: true, version: nextVersion });
}));

router.get('/policy/:customerId/version', asyncH(async (req, res) => {
    const row = await get('SELECT version FROM policies WHERE customer_id=?', [req.params.customerId]);
    res.json({ customerId: req.params.customerId, version: row?.version || 0 });
}));

module.exports = router;
