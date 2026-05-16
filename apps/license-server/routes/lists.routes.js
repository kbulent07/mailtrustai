'use strict';

const express = require('express');
const { asyncH } = require('@mailtrustai/shared');
const { get, run, audit, isMaria } = require('../db');

const router = express.Router();

async function getList(customerId, kind) {
    const row = await get('SELECT * FROM lists WHERE customer_id=? AND kind=?', [customerId, kind]);
    if (!row) {
        return {
            customerId,
            kind,
            version: 0,
            body: kind === 'whitelist'
                ? { domains: [], senders: [] }
                : { domains: [], senders: [], urls: [], attachmentHashes: [] }
        };
    }
    return { customerId, kind, version: row.version, body: JSON.parse(row.body_json), updatedAt: row.updated_at };
}

async function setList(customerId, kind, body) {
    const current = await get('SELECT version FROM lists WHERE customer_id=? AND kind=?', [customerId, kind]);
    const nextVersion = (current?.version || 0) + 1;
    const sql = isMaria
        ? `INSERT INTO lists(customer_id,kind,version,body_json,updated_at) VALUES(?,?,?,?,?)
           ON DUPLICATE KEY UPDATE version=VALUES(version), body_json=VALUES(body_json), updated_at=VALUES(updated_at)`
        : `INSERT INTO lists(customer_id,kind,version,body_json,updated_at) VALUES(?,?,?,?,?)
           ON CONFLICT(customer_id,kind) DO UPDATE SET version=excluded.version, body_json=excluded.body_json, updated_at=excluded.updated_at`;

    await run(sql, [customerId, kind, nextVersion, JSON.stringify(body), Date.now()]);
    await audit('admin', `lists.${kind}.update`, customerId, { version: nextVersion });
    return nextVersion;
}

router.get('/lists/:customerId/whitelist', asyncH(async (req, res) => {
    res.json(await getList(req.params.customerId, 'whitelist'));
}));

router.post('/lists/:customerId/whitelist', asyncH(async (req, res) => {
    const version = await setList(req.params.customerId, 'whitelist', req.body || {});
    res.json({ ok: true, version });
}));

router.get('/lists/:customerId/blacklist', asyncH(async (req, res) => {
    res.json(await getList(req.params.customerId, 'blacklist'));
}));

router.post('/lists/:customerId/blacklist', asyncH(async (req, res) => {
    const version = await setList(req.params.customerId, 'blacklist', req.body || {});
    res.json({ ok: true, version });
}));

router.get('/lists/:customerId/versions', asyncH(async (req, res) => {
    const whitelist = await get('SELECT version FROM lists WHERE customer_id=? AND kind=?', [req.params.customerId, 'whitelist']);
    const blacklist = await get('SELECT version FROM lists WHERE customer_id=? AND kind=?', [req.params.customerId, 'blacklist']);
    res.json({
        customerId: req.params.customerId,
        whitelistVersion: whitelist?.version || 0,
        blacklistVersion: blacklist?.version || 0
    });
}));

module.exports = { router, getList, setList };
