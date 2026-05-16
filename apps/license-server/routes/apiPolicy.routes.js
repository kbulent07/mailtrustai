'use strict';
const express = require('express');
const { asyncH } = require('@mailtrustai/shared');
const { db, audit } = require('../db');

const router = express.Router();

function getApiPolicy(customerId) {
    const r = db.prepare('SELECT * FROM api_policies WHERE customer_id=?').get(customerId);
    if (!r) return { customerId, version: 0, body: { allowedProviders: ['openai', 'claude', 'virustotal', 'otx'], rateLimit: null, dailyQuota: null, monthlyQuota: null, centralApiProxyEnabled: false } };
    return { customerId, version: r.version, body: JSON.parse(r.body_json), updatedAt: r.updated_at };
}

router.get('/config/:customerId/api-policy', asyncH((req, res) => res.json(getApiPolicy(req.params.customerId))));
router.post('/config/:customerId/api-policy', asyncH((req, res) => {
    const cur = db.prepare('SELECT version FROM api_policies WHERE customer_id=?').get(req.params.customerId);
    const nextV = (cur?.version || 0) + 1;
    db.prepare(`INSERT INTO api_policies(customer_id,version,body_json,updated_at) VALUES(?,?,?,?)
                ON CONFLICT(customer_id) DO UPDATE SET version=excluded.version, body_json=excluded.body_json, updated_at=excluded.updated_at`)
      .run(req.params.customerId, nextV, JSON.stringify(req.body || {}), Date.now());
    audit('admin', 'api-policy.update', req.params.customerId, { version: nextV });
    res.json({ ok: true, version: nextV });
}));
router.get('/config/:customerId/version', asyncH((req, res) => {
    const r = db.prepare('SELECT version FROM api_policies WHERE customer_id=?').get(req.params.customerId);
    res.json({ customerId: req.params.customerId, version: r?.version || 0 });
}));

module.exports = { router, getApiPolicy };
