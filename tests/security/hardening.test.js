'use strict';
// Derin audit Bulgu #3 (audit injection), #8 (proto pollution),
// #12 (walk depth DoS) için regression testler.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-hd-'));
process.env.LICENSE_DB_CLIENT = 'sqlite';
process.env.LICENSE_DB_PATH = path.join(process.env.DATA_DIR, 'test.sqlite');
process.env.LICENSE_SIGNING_SECRET = 'test-secret';
process.env.DEALER_API_SECRET = 'test-admin';

const { generateLicenseKey } = require('@mailtrustai/license-core');
const { db, ready } = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
const licenseRoutes = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'license.routes'));
const customerSync = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'customerSync.routes'));
const { safeJSONReviver, hardenPrototypes, safeJSON } = require('@mailtrustai/shared');

const express = require('express');
const http = require('http');

function startApp() {
    const app = express();
    app.use(express.json({ reviver: safeJSONReviver }));
    app.use('/api', customerSync);
    app.use('/api', licenseRoutes);
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    return new Promise((resolve) => {
        const srv = http.createServer(app).listen(0, () => resolve({ srv, port: srv.address().port }));
    });
}

async function http_(port, method, route, body) {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, body: j };
}

test('audit injection: /customer-sync/ack actor attacker-controlled OLAMAZ', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const { keyHash } = generateLicenseKey({ customerId: 'real-cust', plan: 'pro' });
        db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
            .run('real-cust', null, 'Real', null, Date.now());
        db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            'lic-inj', 'real-cust', null, keyHash, 'mask', 'pro', 'pro', 'active', Date.now(), Date.now() + 86400000, 3, '{}', '{}');
        db.prepare(`INSERT INTO activations(id,license_id,instance_id,activated_at,last_heartbeat_at)
                    VALUES(?,?,?,?,?)`).run('act-inj', 'lic-inj', 'inst-x', Date.now(), Date.now());

        // Saldırgan başka bir customerId enjekte etmeye çalışır.
        const ack = await http_(port, 'POST', '/api/customer-sync/ack', {
            customerId: 'spoofed-victim',
            instanceId: 'inst-x',
            licenseKeyHash: keyHash,
            applied: []
        });
        assert.strictEqual(ack.status, 403, 'mismatched customerId 403 olmali');

        // Doğru customerId ile audit kaydı atılır, actor DB'den geldiği için
        // her zaman real-cust olur.
        const ok = await http_(port, 'POST', '/api/customer-sync/ack', {
            instanceId: 'inst-x',
            licenseKeyHash: keyHash,
            applied: [{ kind: 'policy', version: 1 }]
        });
        assert.strictEqual(ok.status, 200);
        const row = db.prepare("SELECT actor FROM audit_log WHERE action='customer.ack' ORDER BY id DESC LIMIT 1").get();
        assert.strictEqual(row.actor, 'real-cust', 'actor DB\'den gelen customer_id olmali, body\'den degil');
    } finally {
        srv.close();
    }
});

test('prototype pollution: __proto__ payload reviver tarafindan silinir', async () => {
    hardenPrototypes(); // idempotent
    await ready;
    const { srv, port } = await startApp();
    try {
        // Body'de __proto__ injection — reviver bunu undefined yapar.
        const r = await fetch(`http://127.0.0.1:${port}/api/customer-sync/heartbeat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"licenseKeyHash":"x","instanceId":"y","__proto__":{"polluted":true}}'
        });
        // 404 dönmesi normal (lisans yok) ama Object.prototype kirlenmemiş olmali.
        assert.ok([400, 404].includes(r.status));
        const probe = {};
        assert.strictEqual(probe.polluted, undefined, 'Object.prototype kirlenmis!');
    } finally {
        srv.close();
    }
});

test('walk depth: cok derin nested object 413 doner', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        // 20 katmanli nested
        let nested = { v: 1 };
        for (let i = 0; i < 20; i++) nested = { x: nested };
        const r = await http_(port, 'POST', '/api/customer-sync/heartbeat', {
            licenseKeyHash: 'a'.repeat(64),
            instanceId: 'i',
            data: nested
        });
        assert.strictEqual(r.status, 413, 'derin payload 413 olmali');
    } finally {
        srv.close();
    }
});

test('safeJSON: bozuk string fallback doner, throw etmez', () => {
    assert.strictEqual(safeJSON('not-json', null), null);
    assert.deepStrictEqual(safeJSON('{"a":1}', {}), { a: 1 });
    assert.deepStrictEqual(safeJSON('', { d: 1 }), { d: 1 });
    assert.deepStrictEqual(safeJSON(null, {}), {});
});

test('licenseKeyHash format validation: sha256 hex disinda 400 doner', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const r = await http_(port, 'POST', '/api/license/validate', {
            licenseKeyHash: 'not-a-hash',
            instanceId: 'i'
        });
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error || '', /sha256/);
    } finally {
        srv.close();
    }
});

test('heartbeat: server-side whitelist — bilinmeyen alan DB\'ye yazilmaz', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const { keyHash } = generateLicenseKey({ customerId: 'cust-wl', plan: 'pro' });
        db.prepare('INSERT INTO customers(id,created_at) VALUES(?,?)').run('cust-wl', Date.now());
        db.prepare(`INSERT INTO licenses(id,customer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('lic-wl', 'cust-wl', keyHash, 'm', 'pro', 'pro', 'active', Date.now(), 3, '{}', '{}');
        db.prepare('INSERT INTO activations(id,license_id,instance_id,activated_at,last_heartbeat_at) VALUES(?,?,?,?,?)')
            .run('act-wl', 'lic-wl', 'inst-wl', Date.now(), Date.now());

        const r = await http_(port, 'POST', '/api/customer-sync/heartbeat', {
            licenseKeyHash: keyHash,
            instanceId: 'inst-wl',
            appVersion: '2.0.0',
            monthlyScanCount: 5,
            // Spoofing girişimi: keyfi alan
            attackerInjected: 'malicious',
            adminFlag: true
        });
        assert.strictEqual(r.status, 200);

        const row = db.prepare("SELECT last_payload_json FROM activations WHERE id='act-wl'").get();
        const stored = JSON.parse(row.last_payload_json);
        assert.strictEqual(stored.appVersion, '2.0.0');
        assert.strictEqual(stored.monthlyScanCount, 5);
        assert.strictEqual(stored.attackerInjected, undefined, 'whitelist disindaki alan DB\'ye sizmamali');
        assert.strictEqual(stored.adminFlag, undefined);
    } finally {
        srv.close();
    }
});
