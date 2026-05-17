'use strict';
// Bulgu #5: /license/customer/:id ve /license/audit dealer scope ile
// kısıtlanmalı; aksi halde bayi başka bayinin verisine erişebilir.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-dsl-'));
process.env.LICENSE_DB_CLIENT = 'sqlite';
process.env.LICENSE_DB_PATH = path.join(process.env.DATA_DIR, 'test.sqlite');
process.env.LICENSE_SIGNING_SECRET = 'test-secret';
process.env.DEALER_API_SECRET = 'test-admin';

const { db, ready } = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
const licenseRoutes = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'license.routes'));
const express = require('express');
const http = require('http');

function startApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', licenseRoutes);
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    return new Promise((resolve) => {
        const srv = http.createServer(app).listen(0, () => resolve({ srv, port: srv.address().port }));
    });
}

async function http_(port, method, routePath) {
    const r = await fetch(`http://127.0.0.1:${port}${routePath}`, { method });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, body: json };
}

test('/license/customer/:id dealerId query yoksa 400 doner', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const r = await http_(port, 'GET', '/api/license/customer/cust-x');
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error || '', /dealerId/);
    } finally {
        srv.close();
    }
});

test('/license/customer/:id farkli dealerId ile bos liste doner (bayi izolasyonu)', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        // dealerA'ya ait bir lisans hazirlayalim
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,created_at) VALUES(?,?,?)').run('dealerA', 'A', Date.now());
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,created_at) VALUES(?,?,?)').run('dealerB', 'B', Date.now());
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,created_at) VALUES(?,?,?)').run('cust-iz', 'dealerA', Date.now());
        db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            'lic-iz', 'cust-iz', 'dealerA', 'hash-iz', 'mask', 'pro', 'pro', 'active', Date.now(), Date.now() + 86400000, 3, '{}', '{}');

        const a = await http_(port, 'GET', '/api/license/customer/cust-iz?dealerId=dealerA');
        assert.strictEqual(a.status, 200);
        assert.strictEqual(a.body.licenses.length, 1);

        const b = await http_(port, 'GET', '/api/license/customer/cust-iz?dealerId=dealerB');
        assert.strictEqual(b.status, 200);
        assert.strictEqual(b.body.licenses.length, 0, 'dealerB dealerA musterisini gormemeli');
    } finally {
        srv.close();
    }
});

test('/license/audit dealerId ile filtrelenir', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        // dealerC icin bir lisans olustur (audit kaydi atilsin)
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,created_at) VALUES(?,?,?)').run('dealerC', 'C', Date.now());
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,created_at) VALUES(?,?,?)').run('dealerD', 'D', Date.now());

        // dealerC tarafindan license create
        await fetch(`http://127.0.0.1:${port}/api/license/create`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ customerId: 'cust-au', dealerId: 'dealerC', plan: 'pro', validDays: 30 })
        });

        const c = await http_(port, 'GET', '/api/license/audit?dealerId=dealerC');
        assert.strictEqual(c.status, 200);
        assert.ok(Array.isArray(c.body.entries));
        assert.ok(c.body.entries.length >= 1, 'dealerC kendi audit kayitlarini gormeli');

        const d = await http_(port, 'GET', '/api/license/audit?dealerId=dealerD');
        assert.strictEqual(d.status, 200);
        // dealerD baska bayinin kayitlarini gormemeli
        for (const e of d.body.entries) {
            assert.notStrictEqual(e.actor, 'dealerC');
        }
    } finally {
        srv.close();
    }
});
