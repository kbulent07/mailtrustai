'use strict';

const express = require('express');
const { asyncH, envInt } = require('@mailtrustai/shared');
const { get, run, audit, isMaria } = require('../db');

const router = express.Router();

const MAX_ENTRIES = envInt('LISTS_MAX_ENTRIES_PER_FIELD', 10000);
const MAX_BODY_BYTES = envInt('LISTS_MAX_BODY_BYTES', 1048576); // 1MB

function _isStringArray(arr) {
    return Array.isArray(arr) && arr.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 512);
}

function _validateListBody(kind, body) {
    if (!body || typeof body !== 'object') {
        const e = new Error('body objesi gerekli'); e.status = 400; throw e;
    }
    const allowedKeys = kind === 'whitelist'
        ? ['domains', 'senders']
        : ['domains', 'senders', 'urls', 'attachmentHashes'];

    for (const key of Object.keys(body)) {
        if (key === 'version') continue;
        if (!allowedKeys.includes(key)) {
            const e = new Error(`bilinmeyen alan: ${key}`); e.status = 400; throw e;
        }
        if (!_isStringArray(body[key])) {
            const e = new Error(`${key} string array olmalı (max 512 karakter)`); e.status = 400; throw e;
        }
        if (body[key].length > MAX_ENTRIES) {
            const e = new Error(`${key} çok büyük (${body[key].length} > ${MAX_ENTRIES})`); e.status = 413; throw e;
        }
    }

    const size = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (size > MAX_BODY_BYTES) {
        const e = new Error(`payload çok büyük: ${size} bytes (max ${MAX_BODY_BYTES})`); e.status = 413; throw e;
    }

    // Sadece izin verilen alanları sakla.
    const cleaned = {};
    for (const k of allowedKeys) cleaned[k] = Array.isArray(body[k]) ? body[k] : [];
    return cleaned;
}

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
    const cleaned = _validateListBody(kind, body);
    const current = await get('SELECT version FROM lists WHERE customer_id=? AND kind=?', [customerId, kind]);
    const nextVersion = (current?.version || 0) + 1;
    const sql = isMaria
        ? `INSERT INTO lists(customer_id,kind,version,body_json,updated_at) VALUES(?,?,?,?,?)
           ON DUPLICATE KEY UPDATE version=VALUES(version), body_json=VALUES(body_json), updated_at=VALUES(updated_at)`
        : `INSERT INTO lists(customer_id,kind,version,body_json,updated_at) VALUES(?,?,?,?,?)
           ON CONFLICT(customer_id,kind) DO UPDATE SET version=excluded.version, body_json=excluded.body_json, updated_at=excluded.updated_at`;

    await run(sql, [customerId, kind, nextVersion, JSON.stringify(cleaned), Date.now()]);
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
