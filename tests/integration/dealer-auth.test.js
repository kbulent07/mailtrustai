'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-da-'));
if (!process.env.LICENSE_DB_CLIENT) {
    process.env.LICENSE_DB_CLIENT = 'sqlite';
}
if (String(process.env.LICENSE_DB_CLIENT).toLowerCase() === 'sqlite' && !process.env.LICENSE_DB_PATH) {
    process.env.LICENSE_DB_PATH = path.join(process.env.DATA_DIR, 'test.sqlite');
}

const bcrypt = require('bcrypt');
const { db, ready } = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
const dealerAuth = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'dealerAuth.routes'));
const express = require('express');
const http = require('http');

test('dealer auth dogru sifreyle 200, yanlisla 401', async () => {
    await ready;
    const hash = bcrypt.hashSync('s3cr3t!', 10);
    db.prepare('INSERT OR REPLACE INTO dealers(id,name,email,api_token_hash,credits,created_at) VALUES(?,?,?,?,?,?)')
        .run('dlr-auth', 'Test', 't@t', hash, 0, Date.now());

    const app = express();
    app.use(express.json());
    app.use('/api', dealerAuth);

    await new Promise((resolve) => {
        const srv = http.createServer(app).listen(0, async () => {
            const port = srv.address().port;
            const ok = await fetch(`http://127.0.0.1:${port}/api/dealer/auth/verify`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ dealerId: 'dlr-auth', password: 's3cr3t!' })
            });
            assert.strictEqual(ok.status, 200);
            const okJson = await ok.json();
            assert.strictEqual(okJson.dealerId, 'dlr-auth');

            const bad = await fetch(`http://127.0.0.1:${port}/api/dealer/auth/verify`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ dealerId: 'dlr-auth', password: 'wrong' })
            });
            assert.strictEqual(bad.status, 401);

            srv.close(resolve);
        });
    });
});
