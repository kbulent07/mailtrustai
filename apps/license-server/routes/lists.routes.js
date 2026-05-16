'use strict';
const express = require('express');
const { asyncH } = require('@mailtrustai/shared');
const { db, audit } = require('../db');

const router = express.Router();

function getList(customerId, kind) {
    const r = db.prepare('SELECT * FROM lists WHERE customer_id=? AND kind=?').get(customerId, kind);
    if (!r) return { customerId, kind, version: 0, body: kind === 'whitelist'
        ? { domains: [], senders: [] }
        : { domains: [], senders: [], urls: [], attachmentHashes: [] } };
    return { customerId, kind, version: r.version, body: JSON.parse(r.body_json), updatedAt: r.updated_at };
}
function setList(customerId, kind, body) {
    const cur = db.prepare('SELECT version FROM lists WHERE customer_id=? AND kind=?').get(customerId, kind);
    const nextV = (cur?.version || 0) + 1;
    db.prepare(`INSERT INTO lists(customer_id,kind,version,body_json,updated_at) VALUES(?,?,?,?,?)
                ON CONFLICT(customer_id,kind) DO UPDATE SET version=excluded.version, body_json=excluded.body_json, updated_at=excluded.updated_at`)
      .run(customerId, kind, nextV, JSON.stringify(body), Date.now());
    audit('admin', `lists.${kind}.update`, customerId, { version: nextV });
    return nextV;
}

router.get('/lists/:customerId/whitelist', asyncH((req, res) => res.json(getList(req.params.customerId, 'whitelist'))));
router.post('/lists/:customerId/whitelist', asyncH((req, res) => {
    const v = setList(req.params.customerId, 'whitelist', req.body || {});
    res.json({ ok: true, version: v });
}));
router.get('/lists/:customerId/blacklist', asyncH((req, res) => res.json(getList(req.params.customerId, 'blacklist'))));
router.post('/lists/:customerId/blacklist', asyncH((req, res) => {
    const v = setList(req.params.customerId, 'blacklist', req.body || {});
    res.json({ ok: true, version: v });
}));
router.get('/lists/:customerId/versions', asyncH((req, res) => {
    const wl = db.prepare('SELECT version FROM lists WHERE customer_id=? AND kind=?').get(req.params.customerId, 'whitelist');
    const bl = db.prepare('SELECT version FROM lists WHERE customer_id=? AND kind=?').get(req.params.customerId, 'blacklist');
    res.json({ customerId: req.params.customerId, whitelistVersion: wl?.version || 0, blacklistVersion: bl?.version || 0 });
}));

module.exports = { router, getList };
