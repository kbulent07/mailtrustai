'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-pg-'));
const { writeCache } = require('@mailtrustai/license-client');
const policyClient   = require('@mailtrustai/policy-client');
const centralSync    = require('@mailtrustai/central-sync');

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
    const oldGetLists = centralSync.getLists;
    centralSync.getLists = () => ({
        whitelist: { domains: ['banka.com'], senders: ['safe@banka.com'] },
        blacklist: { domains: ['fraud.com'], senders: ['evil@fraud.com'] }
    });

    const r = policyClient.evaluateAddress({
        domain: 'banka.com', sender: 'a@banka.com',
        localWhitelist: [], localBlacklist: ['banka.com']
    });
    assert.strictEqual(r.decision, 'deny');
    assert.strictEqual(r.source, 'local-blacklist');

    centralSync.getLists = oldGetLists;
});

test('merge precedence: local whitelist > local blacklist > central blacklist > central whitelist', () => {
    const oldGetLists = centralSync.getLists;
    centralSync.getLists = () => ({
        whitelist: { domains: ['allow.example'], senders: ['allow@sender.test'] },
        blacklist: { domains: ['deny.example'], senders: ['deny@sender.test'] }
    });

    const case1 = policyClient.evaluateAddress({
        domain: 'allow.example',
        sender: 'deny@sender.test',
        localWhitelist: ['allow.example'],
        localBlacklist: ['allow.example']
    });
    assert.strictEqual(case1.decision, 'allow');
    assert.strictEqual(case1.source, 'local-whitelist');

    const case2 = policyClient.evaluateAddress({
        domain: 'deny.example',
        sender: 'allow@sender.test',
        localWhitelist: [],
        localBlacklist: ['deny.example']
    });
    assert.strictEqual(case2.decision, 'deny');
    assert.strictEqual(case2.source, 'local-blacklist');

    const case3 = policyClient.evaluateAddress({
        domain: 'deny.example',
        sender: 'x@y.test',
        localWhitelist: [],
        localBlacklist: []
    });
    assert.strictEqual(case3.decision, 'deny');
    assert.strictEqual(case3.source, 'central-blacklist');

    const case4 = policyClient.evaluateAddress({
        domain: 'allow.example',
        sender: 'x@y.test',
        localWhitelist: [],
        localBlacklist: []
    });
    assert.strictEqual(case4.decision, 'allow');
    assert.strictEqual(case4.source, 'central-whitelist');

    const case5 = policyClient.evaluateAddress({
        domain: 'neutral.example',
        sender: 'neutral@sender.test',
        localWhitelist: [],
        localBlacklist: []
    });
    assert.strictEqual(case5.decision, 'neutral');
    assert.strictEqual(case5.source, 'none');

    centralSync.getLists = oldGetLists;
});

test('api policy yoksa provider izinli kabul edilir (backward compatible)', () => {
    const oldGetApiPolicy = centralSync.getApiPolicy;
    centralSync.getApiPolicy = () => null;

    const result = policyClient.evaluateApiPolicy('openai');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, 'no-policy');

    centralSync.getApiPolicy = oldGetApiPolicy;
});

test('api policy allowedProviders disinda kalan provider engellenir', () => {
    const oldGetApiPolicy = centralSync.getApiPolicy;
    centralSync.getApiPolicy = () => ({
        allowedProviders: ['openai', 'virustotal'],
        rateLimit: 60,
        dailyQuota: 1000,
        monthlyQuota: 20000,
        centralApiProxyEnabled: false
    });

    const denied = policyClient.evaluateApiPolicy('claude');
    assert.strictEqual(denied.allowed, false);
    assert.strictEqual(denied.reason, 'provider-not-allowed');

    const allowed = policyClient.evaluateApiPolicy('OpenAI');
    assert.strictEqual(allowed.allowed, true);
    assert.strictEqual(allowed.rateLimit, 60);
    assert.strictEqual(allowed.dailyQuota, 1000);
    assert.strictEqual(allowed.monthlyQuota, 20000);

    centralSync.getApiPolicy = oldGetApiPolicy;
});

test('api policy proxy ayarlari customer tarafina dogru yansir', () => {
    const oldGetApiPolicy = centralSync.getApiPolicy;
    centralSync.getApiPolicy = () => ({
        allowedProviders: ['openai'],
        centralApiProxyEnabled: true,
        centralApiProxyEndpoint: 'https://central.example/proxy',
        rateLimit: 20,
        dailyQuota: 250,
        monthlyQuota: 5000
    });

    const result = policyClient.evaluateApiPolicy('openai');
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.centralApiProxyEnabled, true);
    assert.strictEqual(result.centralApiProxyEndpoint, 'https://central.example/proxy');
    assert.strictEqual(result.rateLimit, 20);
    assert.strictEqual(result.dailyQuota, 250);
    assert.strictEqual(result.monthlyQuota, 5000);

    centralSync.getApiPolicy = oldGetApiPolicy;
});
