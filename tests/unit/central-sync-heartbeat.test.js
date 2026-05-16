'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { sanitizeHeartbeatPayload } = require('../../packages/central-sync');

test('sanitizeHeartbeatPayload yalnizca allowlist alanlarini birakir', () => {
    const payload = sanitizeHeartbeatPayload({
        licenseKeyHash: 'h1',
        customerId: 'c1',
        instanceId: 'i1',
        appVersion: '2.0.0',
        enabledFeatures: { imapMonitor: true },
        monthlyScanCount: 7,
        services: {
            imapMonitor: 'running',
            smtpReporter: 'configured',
            quarantine: 'enabled',
            aiProvider: 'configured',
            secretService: 'must-not-pass'
        },
        mailBody: 'secret',
        sender: 'x@y.z',
        credentials: { password: 'x' },
        randomField: 'drop-me'
    });

    assert.strictEqual(payload.licenseKeyHash, 'h1');
    assert.strictEqual(payload.customerId, 'c1');
    assert.strictEqual(payload.instanceId, 'i1');
    assert.strictEqual(payload.appVersion, '2.0.0');
    assert.deepStrictEqual(payload.enabledFeatures, { imapMonitor: true });
    assert.strictEqual(payload.monthlyScanCount, 7);

    assert.deepStrictEqual(payload.services, {
        imapMonitor: 'running',
        smtpReporter: 'configured',
        quarantine: 'enabled',
        aiProvider: 'configured'
    });

    assert.strictEqual(payload.mailBody, undefined);
    assert.strictEqual(payload.sender, undefined);
    assert.strictEqual(payload.credentials, undefined);
    assert.strictEqual(payload.randomField, undefined);
    assert.strictEqual(payload.services.secretService, undefined);
});
