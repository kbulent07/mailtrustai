'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-ds-'));
process.env.LICENSE_DB_PATH = path.join(process.env.DATA_DIR, 'test.sqlite');

const { db } = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'db'));
const central = require(path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'routes', 'central.routes'));
const express = require('express');
const http = require('http');

test("/api/central/dealers/:id/customers/status sadece o bayinin müşterilerini döner", async () => {
    db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cA','dlr-1','A','a@a',Date.now());
    db.prepare('INSERT INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run('cB','dlr-2','B','b@b',Date.now());
    const app = express();
    app.use('/api', central);
    await new Promise(resolve => {
        const srv = http.createServer(app).listen(0, async () => {
            const port = srv.address().port;
            const res = await fetch(`http://127.0.0.1:${port}/api/central/dealers/dlr-1/customers/status`);
            const j = await res.json();
            assert.ok(j.customers.find(c => c.customerId === 'cA'));
            assert.strictEqual(j.customers.find(c => c.customerId === 'cB'), undefined);
            srv.close(resolve);
        });
    });
});
