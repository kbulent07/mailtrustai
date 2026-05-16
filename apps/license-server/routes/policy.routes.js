'use strict';
const express = require('express');
const { asyncH } = require('@mailtrustai/shared');
const { db, audit } = require('../db');

const router = express.Router();

router.get('/policy/:customerId', asyncH((req, res) => {
    const r = db.prepare('SELECT * FROM policies WHERE customer_id=?').get(req.params.customerId);
    if (!r) return res.json({ customerId: req.params.customerId, version: 0, body: { featureOverrides: {}, limits: {} } });
    res.json({ customerId: r.customer_id, version: r.version, body: JSON.parse(r.body_json), updatedAt: r.updated_at });
}));

router.post('/policy/:customerId', asyncH((req, res) => {
    const cur = db.prepare('SELECT version FROM policies WHERE customer_id=?').get(req.params.customerId);
    const nextV = (cur?.version || 0) + 1;
    const body = req.body || {};
    db.prepare(`INSERT INTO policies(customer_id,version,body_json,updated_at) VALUES(?,?,?,?)
                ON CONFLICT(customer_id) DO UPDATE SET version=excluded.version, body_json=excluded.body_json, updated_at=excluded.updated_at`)
      .run(req.params.customerId, nextV, JSON.stringify(body), Date.now());
    audit('admin', 'policy.update', req.params.customerId, { version: nextV });
    res.json({ ok: true, version: nextV });
}));

router.get('/policy/:customerId/version', asyncH((req, res) => {
    const r = db.prepare('SELECT version FROM policies WHERE customer_id=?').get(req.params.customerId);
    res.json({ customerId: req.params.customerId, version: r?.version || 0 });
}));

module.exports = router;
