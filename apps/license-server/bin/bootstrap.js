#!/usr/bin/env node
'use strict';
/**
 * License-server bootstrap CLI.
 *
 * Komutlar:
 *   node bootstrap.js create-dealer --id dlr-01 --name "Bayi A" --email a@b.com
 *   node bootstrap.js create-license --customerId cust-1 --dealerId dlr-01 --plan pro --validDays 365 [--companyName ACME]
 *   node bootstrap.js list-dealers
 *   node bootstrap.js list-licenses
 *
 * Bu script license-server host'unda lokal olarak çalıştırılır (auth GEREKMEZ).
 * Üretim sunucusunda erişimi root/operatör kullanıcısıyla sınırlayın.
 */
const { db } = require('../db');
const { generateLicenseKey, getPlan } = require('@mailtrustai/license-core');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcrypt');

function arg(name, def) {
    const i = process.argv.indexOf(`--${name}`);
    return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : def;
}

const cmd = process.argv[2];
switch (cmd) {
    case 'create-dealer': {
        const id = arg('id'), name = arg('name'), email = arg('email');
        if (!id) { console.error('--id gerekli'); process.exit(1); }
        db.prepare('INSERT OR REPLACE INTO dealers(id,name,email,credits,created_at) VALUES(?,?,?,?,?)').run(id, name || id, email || '', 0, Date.now());
        console.log(`✓ dealer oluşturuldu: ${id}`);
        break;
    }
    case 'create-license': {
        const customerId = arg('customerId'), dealerId = arg('dealerId'), plan = arg('plan', 'pro');
        const validDays = Number(arg('validDays', '365'));
        const companyName = arg('companyName', '');
        if (!customerId) { console.error('--customerId gerekli'); process.exit(1); }
        db.prepare('INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)').run(customerId, dealerId || null, companyName, '', Date.now());
        const p = getPlan(plan);
        const { key, keyHash } = generateLicenseKey({ customerId, dealerId, plan });
        const id = uuid();
        const issuedAt = Date.now();
        const expiresAt = issuedAt + validDays * 86400 * 1000;
        db.prepare(`INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, customerId, dealerId || null, keyHash, key.slice(0,8) + '…' + key.slice(-4), plan, p.tier, 'active', issuedAt, expiresAt, p.graceDays, JSON.stringify(p.features), JSON.stringify(p.limits));
        console.log(`✓ lisans oluşturuldu`);
        console.log(`  licenseKey: ${key}`);
        console.log(`  plan:       ${plan} (${p.tier})`);
        console.log(`  expiresAt:  ${new Date(expiresAt).toISOString()}`);
        console.log(`  customerId: ${customerId}`);
        if (dealerId) console.log(`  dealerId:   ${dealerId}`);
        break;
    }
    case 'set-dealer-password': {
        const id = arg('id'), password = arg('password');
        if (!id || !password) { console.error('--id ve --password gerekli'); process.exit(1); }
        const hash = bcrypt.hashSync(password, 10);
        const r = db.prepare('UPDATE dealers SET api_token_hash=? WHERE id=?').run(hash, id);
        if (r.changes === 0) { console.error(`dealer bulunamadı: ${id}`); process.exit(1); }
        console.log(`✓ ${id} için şifre güncellendi`);
        break;
    }
    case 'list-dealers': {
        const rows = db.prepare('SELECT id,name,email,created_at FROM dealers').all();
        console.table(rows);
        break;
    }
    case 'list-licenses': {
        const rows = db.prepare('SELECT id,customer_id,dealer_id,plan,tier,status,license_key_masked,expires_at FROM licenses').all();
        console.table(rows);
        break;
    }
    default:
        console.error('Komutlar: create-dealer | create-license | list-dealers | list-licenses');
        process.exit(1);
}
