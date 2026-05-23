'use strict';

// ─── Topup endpoint'leri DEPRECATED (D4 fix, "Topup Yok Politikası") ─────────
// Üretici POST endpoint'leri 410 Gone döner. Aşağıdaki testler:
//   1) POST /api/dealer/licenses/:id/topup       → 410 (oturumlu)
//   2) POST /api/dealer/topup-codes              → 410 (oturumlu)
//   3) Oturumsuz → 401 (auth önce çalışır, deprecation sonra)
//   4) Mevcut lisansların extra_scans alanı validate cevabına yansır
//      (eski data için bu davranış korunur)
//
// Eski "topup yapan ve kredi düşen" testler GIT HISTORY'de mevcut
// (commit 5096c0c öncesinde). D4 ile kaldırıldı.

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

// ─── Deprecation: POST /api/dealer/licenses/:id/topup → 410 ──────────────────

test('topup-deprecated: POST /dealer/licenses/:id/topup → 410 (oturumlu)', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'depr-pw-1';
        const pwHash = await bcrypt.hash(pw, 10);
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('depr-dlr1', 'Depr Bayi', 'd1@test', 10, pwHash, Date.now());

        const token = await login(port, 'depr-dlr1', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/licenses/any-id/topup',
                              { topupTier: 'T1' }, auth);
        assert.strictEqual(r.status, 410, `Beklenen 410 Gone, alınan: ${r.status} ${JSON.stringify(r.body)}`);
        assert.strictEqual(r.body.code, 'TOPUP_DEPRECATED');
        assert.match(r.body.policy || '', /topup-yok-politikasi/);

        // Kredi DEĞİŞMEDİ — 410 dönüşü kredi düşürmez (önce 410 dönülür, _withCreditRollback'e ulaşmaz)
        const dlr = db.prepare('SELECT credits FROM dealers WHERE id = ?').get('depr-dlr1');
        assert.strictEqual(dlr.credits, 10, 'Deprecated endpoint kredi kesinlikle düşürmemeli');
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

test('topup-deprecated: POST /dealer/topup-codes → 410 (oturumlu)', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'depr-pw-2';
        const pwHash = await bcrypt.hash(pw, 10);
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('depr-dlr2', 'Depr Bayi 2', 'd2@test', 5, pwHash, Date.now());

        const token = await login(port, 'depr-dlr2', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/topup-codes',
                              { tier: 'T2' }, auth);
        assert.strictEqual(r.status, 410, `Beklenen 410 Gone, alınan: ${r.status} ${JSON.stringify(r.body)}`);
        assert.strictEqual(r.body.code, 'TOPUP_DEPRECATED');

        const dlr = db.prepare('SELECT credits FROM dealers WHERE id = ?').get('depr-dlr2');
        assert.strictEqual(dlr.credits, 5, 'Deprecated endpoint kredi kesinlikle düşürmemeli');
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

test('topup-deprecated: oturumsuz POST /dealer/licenses/:id/topup → 401 (auth önce)', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const r = await http_(port, 'POST', '/api/dealer/licenses/any-id/topup',
                              { topupTier: 'T1' });
        assert.strictEqual(r.status, 401, `Beklenen 401, alınan: ${r.status}`);
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

// ─── Mevcut data: validate, eski lisansın extra_scans değerini limits'e ekler ─

test('topup-legacy: validate endpoint extra_scans değerini monthlyScanCount\'a ekler', async () => {
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
        db.prepare(`INSERT OR IGNORE INTO activations(id,license_id,instance_id,app_version,last_heartbeat_at,last_payload_json,activated_at)
                    VALUES(?,?,?,?,?,?,?)`)
            .run('tu-act2', 'tu-lic2', 'inst-tu2', '2.0.0', Date.now(), '{}', Date.now());

        const r = await http_(port, 'POST', '/api/license/validate',
                              { licenseKeyHash: keyHash, instanceId: 'inst-tu2' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.limits.monthlyScanCount, 350,
            `Beklenen 200 + 150 = 350, alınan: ${r.body.limits?.monthlyScanCount}`);
        assert.strictEqual(r.body.extraScans, 150);

        const act = db.prepare('SELECT extra_scans_sent FROM activations WHERE license_id = ? AND instance_id = ?')
            .get('tu-lic2', 'inst-tu2');
        assert.strictEqual(act.extra_scans_sent, 150);
    } finally {
        await new Promise((r) => srv.close(r));
    }
});

// ─── D1 mali risk fix doğrulaması ────────────────────────────────────────────
// Lisans üretiminde INSERT fail ederse kredi iade edilmeli (rollback).
// Bu testte aynı UUID ile iki concurrent INSERT yaparak unique violation tetikleriz.
// Mock kullanmadan: ilk lisansı manuel oluştur, sonra aynı id ile dealer endpoint'i çağır.
// NOT: id otomatik üretilir, unique violation güvenilir tetiklenemez → bu fix'in
// asıl doğrulaması statik kod analizi + manuel test ile. Burada sadece happy path
// hâlâ çalışıyor mu kontrolü.

test('rollback-fix: lisans üretimi happy path — D1 fix sonrası akış sağlam', async () => {
    await ready;
    const { srv, port } = await startApp();
    try {
        const pw     = 'rb-pw-1';
        const pwHash = await bcrypt.hash(pw, 10);
        db.prepare('INSERT OR IGNORE INTO dealers(id,name,email,credits,api_token_hash,created_at) VALUES(?,?,?,?,?,?)')
            .run('rb-dlr', 'RB Bayi', 'rb@test', 20, pwHash, Date.now());
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)')
            .run('rb-cust', 'rb-dlr', 'RB A.Ş.', 'rb@cust', Date.now());

        const token = await login(port, 'rb-dlr', pw);
        const auth  = { authorization: `Bearer ${token}` };

        const r = await http_(port, 'POST', '/api/dealer/licenses',
                              { customerId: 'rb-cust', plan: 'pro', tier: 'T3', validDays: 30 }, auth);

        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.ok, true);
        assert.strictEqual(r.body.tier, 'T3');
        assert.strictEqual(r.body.creditCost, 3);
        assert.strictEqual(r.body.remainingCredits, 17); // 20 - 3

        const dlr = db.prepare('SELECT credits FROM dealers WHERE id = ?').get('rb-dlr');
        assert.strictEqual(dlr.credits, 17, 'Kredi düşmedi');

        const log = db.prepare("SELECT * FROM dealer_credit_log WHERE dealer_id = ? AND reason = 'license.create'")
                      .get('rb-dlr');
        assert.ok(log, 'license.create log kaydı bulunamadı');
        assert.strictEqual(log.delta, -3);

        // Rollback log YOK (başarılı senaryo)
        const rbLog = db.prepare("SELECT * FROM dealer_credit_log WHERE dealer_id = ? AND reason = 'license.create.rollback'")
                        .get('rb-dlr');
        assert.strictEqual(rbLog, undefined, 'Başarılı senaryoda rollback log bulunmamalı');
    } finally {
        await new Promise((r) => srv.close(r));
    }
});
