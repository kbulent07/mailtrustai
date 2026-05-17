#!/usr/bin/env node
'use strict';
/**
 * License-server bootstrap CLI.
 *
 * Komutlar:
 *   node bootstrap.js create-dealer --id dlr-01 --name "Bayi A" --email a@b.com
 *   node bootstrap.js set-dealer-password --id dlr-01 --password "şifre"
 *   node bootstrap.js create-license --customerId cust-1 --dealerId dlr-01 --plan pro --validDays 365 [--companyName ACME]
 *   node bootstrap.js list-dealers
 *   node bootstrap.js list-licenses
 *
 * Bu script license-server host'unda lokal olarak çalıştırılır (auth GEREKMEZ).
 * Üretim sunucusunda erişimi root/operatör kullanıcısıyla sınırlayın.
 */
const { ready, get, all, run, isMaria } = require('../db');
const { generateLicenseKey, getPlan, PLAN_MATRIX } = require('@mailtrustai/license-core');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcrypt');

function arg(name, def) {
    const i = process.argv.indexOf(`--${name}`);
    return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : def;
}

(async () => {
    try {
        await ready;
        const cmd = process.argv[2];

        switch (cmd) {
            case 'create-dealer': {
                const id = arg('id'), name = arg('name'), email = arg('email');
                if (!id) { console.error('--id gerekli'); process.exit(1); }
                await run(
                    isMaria
                        ? `INSERT INTO dealers(id,name,email,credits,created_at) VALUES(?,?,?,?,?)
                           ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email)`
                        : `INSERT INTO dealers(id,name,email,credits,created_at) VALUES(?,?,?,?,?)
                           ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email`,
                    [id, name || id, email || '', 0, Date.now()]
                );
                console.log(`✓ dealer oluşturuldu/güncellendi: ${id}`);
                break;
            }
            case 'create-license': {
                const customerId = arg('customerId'), dealerId = arg('dealerId'), plan = arg('plan', 'pro');
                const validDays = Number(arg('validDays', '365'));
                const companyName = arg('companyName', '');
                if (!customerId) { console.error('--customerId gerekli'); process.exit(1); }
                if (!Number.isFinite(validDays) || validDays <= 0) { console.error('--validDays geçersiz'); process.exit(1); }
                if (!PLAN_MATRIX[plan]) {
                    console.error(`plan geçersiz: ${plan}. Geçerli: ${Object.keys(PLAN_MATRIX).join(', ')}`);
                    process.exit(1);
                }
                if (dealerId) {
                    const dlr = await get('SELECT id FROM dealers WHERE id=?', [dealerId]);
                    if (!dlr) { console.error(`dealer bulunamadı: ${dealerId}`); process.exit(1); }
                }

                await run(
                    isMaria
                        ? 'INSERT IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)'
                        : 'INSERT OR IGNORE INTO customers(id,dealer_id,company_name,email,created_at) VALUES(?,?,?,?,?)',
                    [customerId, dealerId || null, companyName, '', Date.now()]
                );

                const p = getPlan(plan);
                const { key, keyHash } = generateLicenseKey({ customerId, dealerId, plan });
                const id = uuid();
                const issuedAt = Date.now();
                const expiresAt = issuedAt + validDays * 86400 * 1000;

                await run(
                    `INSERT INTO licenses(id,customer_id,dealer_id,license_key_hash,license_key_masked,plan,tier,status,issued_at,expires_at,grace_days,features_json,limits_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [id, customerId, dealerId || null, keyHash, key.slice(0, 8) + '…' + key.slice(-4), plan, p.tier, 'active', issuedAt, expiresAt, p.graceDays, JSON.stringify(p.features), JSON.stringify(p.limits)]
                );

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
                if (password.length < 8) { console.error('parola en az 8 karakter olmalı'); process.exit(1); }
                const existing = await get('SELECT id FROM dealers WHERE id=?', [id]);
                if (!existing) { console.error(`dealer bulunamadı: ${id}`); process.exit(1); }
                const hash = bcrypt.hashSync(password, 10);
                await run('UPDATE dealers SET api_token_hash=? WHERE id=?', [hash, id]);
                console.log(`✓ ${id} için şifre güncellendi`);
                break;
            }
            case 'list-dealers': {
                const rows = await all('SELECT id,name,email,created_at FROM dealers');
                if (rows && rows.length > 0) console.table(rows);
                else console.log('Dealer bulunamadı');
                break;
            }
            case 'list-licenses': {
                const rows = await all('SELECT id,customer_id,dealer_id,plan,tier,status,license_key_masked,expires_at FROM licenses');
                if (rows && rows.length > 0) console.table(rows);
                else console.log('Lisans bulunamadı');
                break;
            }
            default:
                console.error('Komutlar: create-dealer | set-dealer-password | create-license | list-dealers | list-licenses');
                process.exit(1);
        }

        process.exit(0);
    } catch (error) {
        console.error('Hata:', error.message);
        process.exit(1);
    }
})();
