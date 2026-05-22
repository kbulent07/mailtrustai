'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcrypt');

if (!process.env.DATA_DIR) {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-tu-'));
}
if (!process.env.LICENSE_DB_CLIENT) {
    process.env.LICENSE_DB_CLIENT = 'sqlite';
}
if (String(process.env.LICENSE_DB_CLIENT).toLowerCase() === 'sqlite' && !process.env.LICENSE_DB_PATH) {
    process.env.LICENSE_DB_PATH = path.join(process.env.DATA_DIR, 'test.sqlite');
}
if (!process.env.LICENSE_SIGNING_SECRET) process.env.LICENSE_SIGNING_SECRET = 'test-secret';
if (!process.env.DEALER_API_SECRET)      process.env.DEALER_API_SECRET = 'test-admin';

const { db, ready } = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
const dealerRoutes  = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'dealer.routes'));
const licenseRoutes = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'license.routes'));
const { generateLicenseKey } = require('@mailtrustai/license-core');
const express = require('express');
const http    = require('http');

function startApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', dealerRoutes);
    app.use('/api', licenseRoutes);
    app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    return new Promise((resolve) => {
        const srv = http.createServer(app).listen(0, () => resolve({ srv, port: srv.address().port }));
    });
}

async function http_(port, method, routePath, body, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${routePath}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: json };
}

async function login(port, dealerId, password) {
    const r = await http_(port, 'POST', '/api/dealer/login', { dealerId, password });
    assert.strictEqual(r.status, 200, `Login başarısız: ${JSON.stringify(r.body)}`);
    return r.body.sessionToken;
}

// ─── Mutlu yol ────────────────────────────────────────────────────────────────

test('topup: mutlu yol — kredi düşer, extra_scans artar, credit log yazılır', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'happy-path-pw-123';
        const pwHash = await bcrypt.hash(pw, 10);

        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('tu-dlr1', 'Topup Bayi', 'tu1@test', 5, pwHash, Date.now());
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
            .run('tu-cust1', 'tu-dlr1', 'Topup A.Ş.', 'a@tu1', Date.now());
        db.prepare(`INSERT OR IGNORE INTO licenses
                    (id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,extra_scans)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('tu-lic1', 'tu-cust1', 'tu-dlr1', 'hash-tu1', 'XXXX…0001',
                 'pro', 'T2', 'active', Date.now(), Date.now() + 86400000 * 365, 3, '{}',
                 JSON.stringify({ monthlyScanCount: 100 }), 0);

        const token = await login(port, 'tu-dlr1', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/licenses/tu-lic1/topup', { topupTier: 'T2' }, auth);
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.ok,               true);
        assert.strictEqual(r.body.topupTier,        'T2');
        assert.strictEqual(r.body.scanAmount,       100);
        assert.strictEqual(r.body.newExtraScans,    100);
        assert.strictEqual(r.body.remainingCredits, 4);

        // DB doğrulama
        const lic = db.prepare('SELECT extra_scans FROM licenses WHERE id = ?').get('tu-lic1');
        assert.strictEqual(lic.extra_scans, 100, 'extra_scans DB\'de güncellenmedi');

        const dlr = db.prepare('SELECT credits FROM dealers WHERE id = ?').get('tu-dlr1');
        assert.strictEqual(dlr.credits, 4, 'kredi düşmedi');

        const log = db.prepare("SELECT * FROM dealer_credit_log WHERE dealer_id = ? AND reason = 'scan.topup'").get('tu-dlr1');
        assert.ok(log, 'scan.topup log kaydı bulunamadı');
        assert.strictEqual(log.delta,   -1);
        assert.strictEqual(log.balance,  4);
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

// ─── Validate endpoint extra_scans'ı limits'e ekler ──────────────────────────

test('topup: validate endpoint extra_scans değerini monthlyScanCount\'a ekler', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const { key, keyHash } = generateLicenseKey({ customerId: 'tu-cust2', dealerId: 'tu-dlr2', plan: 'pro' });

        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,created_at) VALUES(?,?,?,?,?)')
            .run('tu-dlr2', 'Val Bayi', 'tu2@test', 0, Date.now());
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
            .run('tu-cust2', 'tu-dlr2', 'Val A.Ş.', 'v@tu2', Date.now());
        db.prepare(`INSERT OR IGNORE INTO licenses
                    (id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,extra_scans)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('tu-lic2', 'tu-cust2', 'tu-dlr2', keyHash, key.slice(0, 8),
                 'pro', 'T3', 'active', Date.now(), Date.now() + 86400000 * 365, 3, '{}',
                 JSON.stringify({ monthlyScanCount: 200 }), 150);
        // validate, aktivasyon kaydı gerektirir
        db.prepare(`INSERT OR IGNORE INTO activations(id,license_id,instance_id,app_version,last_heartbeat_at,last_payload_json,activated_at)
                    VALUES(?,?,?,?,?,?,?)`)
            .run('tu-act2', 'tu-lic2', 'inst-tu2', '2.0.0', Date.now(), '{}', Date.now());

        // validate → limits.monthlyScanCount = 200 + 150 = 350
        const r = await http_(port, 'POST', '/api/license/validate', { licenseKeyHash: keyHash, instanceId: 'inst-tu2' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.limits.monthlyScanCount, 350,
            `Beklenen 350, alınan: ${r.body.limits?.monthlyScanCount}`);
        assert.strictEqual(r.body.extraScans, 150);
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

// ─── Hata senaryoları ─────────────────────────────────────────────────────────

test('topup: oturumsuz istek → 401', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const r = await http_(port, 'POST', '/api/dealer/licenses/herhangi-id/topup', { topupTier: 'T1' });
        assert.strictEqual(r.status, 401);
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

test('topup: yetersiz kredi → 402 INSUFFICIENT_CREDITS', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'insuf-pw-456';
        const pwHash = await bcrypt.hash(pw, 10);

        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('tu-dlr3', 'Kredsiz Bayi', 'tu3@test', 0, pwHash, Date.now());
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
            .run('tu-cust3', 'tu-dlr3', 'Kredsiz A.Ş.', 'k@tu3', Date.now());
        db.prepare(`INSERT OR IGNORE INTO licenses
                    (id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,extra_scans)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('tu-lic3', 'tu-cust3', 'tu-dlr3', 'hash-tu3', 'XXXX…0003',
                 'pro', 'T1', 'active', Date.now(), Date.now() + 86400000 * 365, 3, '{}', '{}', 0);

        const token = await login(port, 'tu-dlr3', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/licenses/tu-lic3/topup', { topupTier: 'T1' }, auth);
        assert.strictEqual(r.status, 402);
        assert.strictEqual(r.body.code, 'INSUFFICIENT_CREDITS');

        // extra_scans artmamış olmalı
        const lic = db.prepare('SELECT extra_scans FROM licenses WHERE id = ?').get('tu-lic3');
        assert.strictEqual(lic.extra_scans, 0, 'Kredi yokken extra_scans artmamalı');
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

test('topup: başka bayiye ait lisans → 403', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'pw-cross-dealer';
        const pwHash = await bcrypt.hash(pw, 10);

        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('tu-dlr4a', 'Bayi 4A', 'tu4a@test', 5, pwHash, Date.now());
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('tu-dlr4b', 'Bayi 4B', 'tu4b@test', 5, pwHash, Date.now());
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
            .run('tu-cust4b', 'tu-dlr4b', 'B A.Ş.', 'b@tu4', Date.now());
        db.prepare(`INSERT OR IGNORE INTO licenses
                    (id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,extra_scans)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('tu-lic4b', 'tu-cust4b', 'tu-dlr4b', 'hash-tu4b', 'XXXX…0004b',
                 'pro', 'T1', 'active', Date.now(), Date.now() + 86400000 * 365, 3, '{}', '{}', 0);

        // Bayi 4A ile giriş yap, 4B'nin lisansına topup dene
        const token = await login(port, 'tu-dlr4a', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/licenses/tu-lic4b/topup', { topupTier: 'T1' }, auth);
        assert.strictEqual(r.status, 403);

        // 4A'nın kredisi azalmamış olmalı
        const dlr = db.prepare('SELECT credits FROM dealers WHERE id = ?').get('tu-dlr4a');
        assert.strictEqual(dlr.credits, 5, 'Yetkisiz topup sonrası kredi azalmamalı');
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

test('topup: pasif (revoked) lisans → 400', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'pw-revoked-789';
        const pwHash = await bcrypt.hash(pw, 10);

        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('tu-dlr5', 'Pasif Bayi', 'tu5@test', 5, pwHash, Date.now());
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
            .run('tu-cust5', 'tu-dlr5', 'Pasif A.Ş.', 'p@tu5', Date.now());
        db.prepare(`INSERT OR IGNORE INTO licenses
                    (id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,extra_scans)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('tu-lic5', 'tu-cust5', 'tu-dlr5', 'hash-tu5', 'XXXX…0005',
                 'pro', 'T1', 'revoked', Date.now(), Date.now() + 86400000 * 365, 3, '{}', '{}', 0);

        const token = await login(port, 'tu-dlr5', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/licenses/tu-lic5/topup', { topupTier: 'T1' }, auth);
        assert.strictEqual(r.status, 400);
        assert.ok(r.body.error.includes('aktif'), `Beklenen 'aktif' içeren hata, alınan: ${r.body.error}`);
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

test('topup: geçersiz tier (T99) → 400', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'pw-bad-tier-abc';
        const pwHash = await bcrypt.hash(pw, 10);

        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('tu-dlr6', 'BadTier Bayi', 'tu6@test', 5, pwHash, Date.now());
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
            .run('tu-cust6', 'tu-dlr6', 'BadTier A.Ş.', 'b@tu6', Date.now());
        db.prepare(`INSERT OR IGNORE INTO licenses
                    (id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json,extra_scans)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run('tu-lic6', 'tu-cust6', 'tu-dlr6', 'hash-tu6', 'XXXX…0006',
                 'pro', 'T1', 'active', Date.now(), Date.now() + 86400000 * 365, 3, '{}', '{}', 0);

        const token = await login(port, 'tu-dlr6', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/licenses/tu-lic6/topup', { topupTier: 'T99' }, auth);
        assert.strictEqual(r.status, 400);
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

test('topup: var olmayan lisans → 404', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'pw-notfound-xyz';
        const pwHash = await bcrypt.hash(pw, 10);

        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('tu-dlr7', 'Ghost Bayi', 'tu7@test', 5, pwHash, Date.now());

        const token = await login(port, 'tu-dlr7', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/licenses/lic-does-not-exist/topup', { topupTier: 'T1' }, auth);
        assert.strictEqual(r.status, 404);
    } finally {
        await new Promise((r) => srv.close(r));
    }
});
