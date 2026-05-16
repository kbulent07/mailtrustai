'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-ls-'));
process.env.LICENSE_DB_CLIENT = 'sqlite';
process.env.LICENSE_DB_PATH = path.join(process.env.DATA_DIR, 'test.sqlite');
process.env.LICENSE_SIGNING_SECRET = 'test-secret';
process.env.DEALER_API_SECRET = 'test-admin';

const { generateLicenseKey } = require('@mailtrustai/license-core');
const { db, ready } = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
const licenseRoutes = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'license.routes'));
const customerSync = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'customerSync.routes'));
const central = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'central.routes'));

const express = require('express');
const http = require('http');

function startApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', customerSync);
    app.use('/api', licenseRoutes);
    app.use('/api', central);
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    return new Promise((resolve) => {
        const srv = http.createServer(app).listen(0, () => resolve({ srv, port: srv.address().port }));
    });
}

async function http_(port, method, routePath, body) {
    const response = await fetch(`http://127.0.0.1:${port}${routePath}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: json };
}

test('license activate -> validate -> heartbeat -> bootstrap -> pull akisi', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const { key, keyHash } = generateLicenseKey({ customerId: 'cust1', dealerId: 'dlr1', plan: 'pro' });
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,created_at) VALUES(?,?,?,?)').run('dlr1', 'Test Dealer', 'd@d', Date.now());
        db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cust1', 'dlr1', 'ACME', 'a@b', Date.now());
        db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('lic1', 'cust1', 'dlr1', keyHash, key.slice(0, 8), 'pro', 'pro', 'active', Date.now(), Date.now() + 86400000 * 365, 3, JSON.stringify({ imapMonitor: true }), JSON.stringify({ monthlyScanCount: 20000 }));

        const activate = await http_(port, 'POST', '/api/license/activate', { licenseKey: key, instanceId: 'inst-test', appVersion: '2.0.0' });
        assert.strictEqual(activate.status, 200);
        assert.strictEqual(activate.body.customerId, 'cust1');
        assert.strictEqual(activate.body.plan, 'pro');

        const validate = await http_(port, 'POST', '/api/license/validate', { licenseKeyHash: keyHash });
        assert.strictEqual(validate.status, 200);
        assert.strictEqual(validate.body.licenseStatus, 'active');

        const heartbeat = await http_(port, 'POST', '/api/license/heartbeat', { licenseKeyHash: keyHash, instanceId: 'inst-test' });
        assert.strictEqual(heartbeat.status, 200);

        const bootstrap = await http_(port, 'POST', '/api/customer-sync/bootstrap', {
            licenseKeyHash: keyHash,
            instanceId: 'inst-test',
            appVersion: '2.0.0',
            monthlyScanCount: 7,
            enabledFeatures: { imapMonitor: true }
        });
        assert.strictEqual(bootstrap.status, 200);
        assert.ok(bootstrap.body.policy);
        assert.ok(bootstrap.body.lists);
        assert.ok(bootstrap.body.apiPolicy);

        const pull = await http_(port, 'GET', '/api/customer-sync/pull?customerId=cust1&policyV=0&whitelistV=0&blacklistV=0&apiPolicyV=0');
        assert.strictEqual(pull.status, 200);

        const status = await http_(port, 'GET', '/api/central/customers/cust1/status');
        assert.strictEqual(status.status, 200);
        assert.ok(status.body.instances.length >= 1);
        assert.ok(['online', 'stale', 'offline', 'never'].includes(status.body.instances[0].onlineStatus));
    } finally {
        srv.close();
    }
});

test('heartbeat PII alani icerirse 422 doner', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const { key, keyHash } = generateLicenseKey({ customerId: 'cust2', plan: 'pro' });
        db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cust2', null, 'X', 'x@y', Date.now());
        db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('lic2', 'cust2', null, keyHash, key.slice(0, 8), 'pro', 'pro', 'active', Date.now(), Date.now() + 86400000, 3, '{}', '{}');
        const response = await http_(port, 'POST', '/api/customer-sync/heartbeat', { licenseKeyHash: keyHash, instanceId: 'i', mailBody: 'gizli!' });
        assert.strictEqual(response.status, 422);
    } finally {
        srv.close();
    }
});
