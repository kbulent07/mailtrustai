'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// İzole DB
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-ls-'));
process.env.LICENSE_DB_PATH = path.join(process.env.DATA_DIR, 'test.sqlite');
process.env.LICENSE_SIGNING_SECRET = 'test-secret';
process.env.DEALER_API_SECRET = 'test-admin';

const { generateLicenseKey } = require('@mailtrustai/license-core');
const { sha256 } = require('@mailtrustai/security');
const { db } = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
const licenseRoutes = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'license.routes'));
const customerSync  = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'customerSync.routes'));
const central       = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'central.routes'));

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
async function http_(port, method, path_, body) {
    const res = await fetch(`http://127.0.0.1:${port}${path_}`, {
        method, headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, body: j };
}

test('license activate → validate → heartbeat → bootstrap → pull akışı', async () => {
    const { srv, port } = await startApp();
    try {
        // create license (direkt DB)
        const { key, keyHash } = generateLicenseKey({ customerId: 'cust1', dealerId: 'dlr1', plan: 'pro' });
        db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cust1', 'dlr1', 'ACME', 'a@b', Date.now());
        db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run('lic1', 'cust1', 'dlr1', keyHash, key.slice(0,8), 'pro','pro','active', Date.now(), Date.now() + 86400000*365, 3, JSON.stringify({ imapMonitor: true }), JSON.stringify({ monthlyScanCount: 20000 }));

        const act = await http_(port, 'POST', '/api/license/activate', { licenseKey: key, instanceId: 'inst-test', appVersion: '2.0.0' });
        assert.strictEqual(act.status, 200);
        assert.strictEqual(act.body.customerId, 'cust1');
        assert.strictEqual(act.body.plan, 'pro');

        const val = await http_(port, 'POST', '/api/license/validate', { licenseKeyHash: keyHash });
        assert.strictEqual(val.status, 200);
        assert.strictEqual(val.body.licenseStatus, 'active');

        const hb = await http_(port, 'POST', '/api/license/heartbeat', { licenseKeyHash: keyHash, instanceId: 'inst-test' });
        assert.strictEqual(hb.status, 200);

        const boot = await http_(port, 'POST', '/api/customer-sync/bootstrap', {
            licenseKeyHash: keyHash, instanceId: 'inst-test', appVersion: '2.0.0',
            monthlyScanCount: 7, enabledFeatures: { imapMonitor: true }
        });
        assert.strictEqual(boot.status, 200);
        assert.ok(boot.body.policy);
        assert.ok(boot.body.lists);
        assert.ok(boot.body.apiPolicy);

        const pull = await http_(port, 'GET', '/api/customer-sync/pull?customerId=cust1&policyV=0&whitelistV=0&blacklistV=0&apiPolicyV=0');
        assert.strictEqual(pull.status, 200);

        const status = await http_(port, 'GET', '/api/central/customers/cust1/status');
        assert.strictEqual(status.status, 200);
        assert.ok(status.body.instances.length >= 1);
        assert.ok(['online','stale','offline','never'].includes(status.body.instances[0].onlineStatus));
    } finally { srv.close(); }
});

test('heartbeat PII alanı içerirse 422 döner', async () => {
    const { srv, port } = await startApp();
    try {
        const { key, keyHash } = generateLicenseKey({ customerId: 'cust2', plan: 'pro' });
        db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cust2', null, 'X', 'x@y', Date.now());
        db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run('lic2', 'cust2', null, keyHash, key.slice(0,8), 'pro','pro','active', Date.now(), Date.now() + 86400000, 3, '{}', '{}');
        const r = await http_(port, 'POST', '/api/customer-sync/heartbeat', { licenseKeyHash: keyHash, instanceId: 'i', mailBody: 'gizli!' });
        assert.strictEqual(r.status, 422);
    } finally { srv.close(); }
});
