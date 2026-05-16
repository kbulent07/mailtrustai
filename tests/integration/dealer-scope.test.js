'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-ds-'));
process.env.LICENSE_DB_CLIENT = 'sqlite';
process.env.LICENSE_DB_PATH = path.join(process.env.DATA_DIR, 'test.sqlite');

const { db, ready } = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
const central = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'central.routes'));
const express = require('express');
const http = require('http');

test('/api/central/dealers/:id/customers/status sadece o bayinin musterilerini doner', async () => {
    await ready;
    db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,created_at) VALUES(?,?,?,?)').run('dlr-1', 'D1', 'd1@x', Date.now());
    db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,created_at) VALUES(?,?,?,?)').run('dlr-2', 'D2', 'd2@x', Date.now());
    db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cA', 'dlr-1', 'A', 'a@a', Date.now());
    db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cB', 'dlr-2', 'B', 'b@b', Date.now());

    const app = express();
    app.use('/api', central);

    await new Promise((resolve) => {
        const srv = http.createServer(app).listen(0, async () => {
            const port = srv.address().port;
            const response = await fetch(`http://127.0.0.1:${port}/api/central/dealers/dlr-1/customers/status`);
            const json = await response.json();
            assert.ok(json.customers.find((customer) => customer.customerId === 'cA'));
            assert.strictEqual(json.customers.find((customer) => customer.customerId === 'cB'), undefined);
            srv.close(resolve);
        });
    });
});

test('dealer status online/stale/offline hesaplar ve hassas alanlari disarida birakir', async () => {
    await ready;
    const now = Date.now();
    db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,created_at) VALUES(?,?,?,?)').run('dlr-z', 'DZ', 'dz@x', now);

    db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cOn', 'dlr-z', 'Online Co', 'on@x', now);
    db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cSt', 'dlr-z', 'Stale Co', 'st@x', now);
    db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cOff', 'dlr-z', 'Offline Co', 'off@x', now);

    db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run('lOn', 'cOn', 'dlr-z', 'h-on', 'm-on', 'pro', 'pro', 'active', now, now + 86400000, 3, '{}', '{}');
    db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run('lSt', 'cSt', 'dlr-z', 'h-st', 'm-st', 'pro', 'pro', 'active', now, now + 86400000, 3, '{}', '{}');
    db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run('lOff', 'cOff', 'dlr-z', 'h-off', 'm-off', 'pro', 'pro', 'active', now, now + 86400000, 3, '{}', '{}');

    db.prepare(`INSERT INTO activations(id,license_id,instance_id,app_version,last_heartbeat_at,last_payload_json,activated_at)
                VALUES(?,?,?,?,?,?,?)`)
        .run('aOn', 'lOn', 'inst-on', '2.0.0', now - 60 * 1000, JSON.stringify({
            monthlyScanCount: 42,
            enabledFeatures: { imapMonitor: true },
            healthStatus: 'ok',
            mailBody: 'NOPE',
            credentials: { imapPassword: 'NOPE' }
        }), now);
    db.prepare(`INSERT INTO activations(id,license_id,instance_id,app_version,last_heartbeat_at,last_payload_json,activated_at)
                VALUES(?,?,?,?,?,?,?)`)
        .run('aSt', 'lSt', 'inst-stale', '2.0.0', now - 10 * 60 * 1000, JSON.stringify({ healthStatus: 'warn' }), now);
    db.prepare(`INSERT INTO activations(id,license_id,instance_id,app_version,last_heartbeat_at,last_payload_json,activated_at)
                VALUES(?,?,?,?,?,?,?)`)
        .run('aOff', 'lOff', 'inst-off', '2.0.0', now - 40 * 60 * 1000, JSON.stringify({ healthStatus: 'down' }), now);

    const app = express();
    app.use('/api', central);

    await new Promise((resolve) => {
        const srv = http.createServer(app).listen(0, async () => {
            const port = srv.address().port;
            const response = await fetch(`http://127.0.0.1:${port}/api/central/dealers/dlr-z/customers/status`);
            const json = await response.json();
            const byId = Object.fromEntries((json.customers || []).map((item) => [item.customerId, item]));

            assert.strictEqual(byId.cOn.onlineStatus, 'online');
            assert.strictEqual(byId.cSt.onlineStatus, 'stale');
            assert.strictEqual(byId.cOff.onlineStatus, 'offline');

            assert.strictEqual(byId.cOn.monthlyScanCount, 42);
            assert.ok(byId.cOn.enabledFeatures && byId.cOn.enabledFeatures.imapMonitor === true);

            assert.strictEqual(byId.cOn.mailBody, undefined);
            assert.strictEqual(byId.cOn.credentials, undefined);
            assert.strictEqual(byId.cOn.sender, undefined);
            assert.strictEqual(byId.cOn.recipient, undefined);
            srv.close(resolve);
        });
    });
});
