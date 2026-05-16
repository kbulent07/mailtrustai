'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-pg-'));
const { writeCache } = require('@mailtrustai/license-client');
const policyClient   = require('@mailtrustai/policy-client');

test('feature gate license features ile yönetilir', () => {
    writeCache({
        instanceId: 'i', features: { imapMonitor: true, deepAi: false, quarantine: true },
        plan: 'pro', tier: 'pro', licenseStatus: 'active',
        lastValidatedAt: Date.now(), graceDays: 3
    });
    assert.strictEqual(policyClient.isFeatureEnabled('imapMonitor'), true);
    assert.strictEqual(policyClient.isFeatureEnabled('deepAi'), false);
    assert.strictEqual(policyClient.isFeatureEnabled('quarantine'), true);
});

test('central whitelist + local blacklist conflict resolution', () => {
    const r = policyClient.evaluateAddress({
        domain: 'banka.com', sender: 'a@banka.com',
        localWhitelist: [], localBlacklist: ['banka.com']
    });
    assert.strictEqual(r.decision, 'deny');
    assert.strictEqual(r.source, 'local-blacklist');
});
