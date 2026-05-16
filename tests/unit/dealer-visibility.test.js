'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { sanitizeCustomerStatusRow, sanitizeCustomerStatusList } = require('../../apps/dealer/customerVisibility');

test('sanitizeCustomerStatusRow sadece izinli alanlari tutar', () => {
    const row = sanitizeCustomerStatusRow({
        customerId: 'c1',
        companyName: 'ACME',
        plan: 'pro',
        onlineStatus: 'online',
        enabledFeatures: { imapMonitor: true },
        mailBody: 'secret',
        sender: 'secret@example.com',
        credentials: { password: 'x' },
        rawHeaders: 'x-test: 1'
    });

    assert.strictEqual(row.customerId, 'c1');
    assert.strictEqual(row.companyName, 'ACME');
    assert.strictEqual(row.plan, 'pro');
    assert.strictEqual(row.onlineStatus, 'online');
    assert.deepStrictEqual(row.enabledFeatures, { imapMonitor: true });

    assert.strictEqual(row.mailBody, undefined);
    assert.strictEqual(row.sender, undefined);
    assert.strictEqual(row.credentials, undefined);
    assert.strictEqual(row.rawHeaders, undefined);
});

test('sanitizeCustomerStatusList dizi seviyesinde filtre uygular', () => {
    const rows = sanitizeCustomerStatusList([
        { customerId: 'c1', mailBody: 'x', enabledFeatures: null },
        { customerId: 'c2', credentials: { x: 1 } }
    ]);

    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0].enabledFeatures, {});
    assert.deepStrictEqual(rows[1].enabledFeatures, {});
    assert.strictEqual(rows[0].mailBody, undefined);
    assert.strictEqual(rows[1].credentials, undefined);
});
