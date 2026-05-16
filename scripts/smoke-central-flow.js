#!/usr/bin/env node
'use strict';

const { randomUUID } = require('node:crypto');
const fetch = require('node-fetch');
const { sha256 } = require('@mailtrustai/security');

const baseUrl = (process.env.LICENSE_SERVER_URL || 'http://localhost:3200').replace(/\/+$/, '');
const adminSecret = process.env.DEALER_API_SECRET || process.env.TOKEN_SECRET || 'dev-dealer-api-secret-change-me';
const givenLicenseKey = process.env.SMOKE_LICENSE_KEY || '';

function log(step, message, extra) {
    const payload = extra ? ` ${JSON.stringify(extra)}` : '';
    console.log(`[smoke-central] ${step}: ${message}${payload}`);
}

async function api(method, path, body, auth = false) {
    const headers = { 'content-type': 'application/json' };
    if (auth) headers.authorization = `Bearer ${adminSecret}`;
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!res.ok) {
        throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    }
    return json;
}

async function ensureLicenseKey() {
    if (givenLicenseKey) return givenLicenseKey;

    const customerId = `smoke-customer-${Date.now()}`;
    const payload = {
        customerId,
        dealerId: null,
        plan: 'pro',
        companyName: 'Smoke Customer',
        email: 'smoke@example.com',
        validDays: 30
    };
    const created = await api('POST', '/api/license/create', payload, true);
    if (!created.licenseKey) throw new Error('license/create response missing licenseKey');
    log('license.create', 'ok', { customerId, plan: created.plan, tier: created.tier });
    return created.licenseKey;
}

async function run() {
    const licenseKey = await ensureLicenseKey();
    const licenseKeyHash = sha256(licenseKey);
    const instanceId = `smoke-inst-${randomUUID().slice(0, 8)}`;

    const activate = await api('POST', '/api/license/activate', {
        licenseKey,
        instanceId,
        appVersion: 'smoke-1.0.0',
        buildVersion: 'smoke-build',
        nodeVersion: process.versions.node,
        environment: process.env.NODE_ENV || 'production'
    });
    log('license.activate', 'ok', { customerId: activate.customerId, activationId: activate.activationId });

    const bootstrap = await api('POST', '/api/customer-sync/bootstrap', {
        licenseKeyHash,
        customerId: activate.customerId,
        dealerId: activate.dealerId || null,
        activationId: activate.activationId,
        instanceId,
        appVersion: 'smoke-1.0.0',
        buildVersion: 'smoke-build',
        nodeVersion: process.versions.node,
        environment: process.env.NODE_ENV || 'production',
        hostnameHash: sha256('smoke-host'),
        lastHeartbeatAt: new Date().toISOString(),
        healthStatus: 'ok',
        enabledFeatures: activate.features || {},
        monthlyScanCount: 1,
        dailyScanCount: 1,
        mailboxCount: 1,
        userCount: 1,
        licenseStatus: activate.licenseStatus,
        plan: activate.plan,
        tier: activate.tier,
        localPolicyVersion: 0,
        localWhitelistVersion: 0,
        localBlacklistVersion: 0,
        localApiConfigVersion: 0,
        services: {
            imapMonitor: 'running',
            smtpReporter: 'configured',
            quarantine: 'enabled',
            aiProvider: 'configured'
        },
        errorSummary: null
    });
    log('customer-sync.bootstrap', 'ok', {
        policyVersion: bootstrap.policy?.version ?? 0,
        whitelistVersion: bootstrap.lists?.whitelist?.version ?? 0,
        blacklistVersion: bootstrap.lists?.blacklist?.version ?? 0,
        apiPolicyVersion: bootstrap.apiPolicy?.version ?? 0
    });

    const heartbeat = await api('POST', '/api/customer-sync/heartbeat', {
        licenseKeyHash,
        instanceId,
        appVersion: 'smoke-1.0.0',
        healthStatus: 'ok',
        enabledFeatures: activate.features || {},
        monthlyScanCount: 2,
        dailyScanCount: 2,
        mailboxCount: 1,
        userCount: 1,
        plan: activate.plan,
        tier: activate.tier,
        localPolicyVersion: bootstrap.policy?.version ?? 0,
        localWhitelistVersion: bootstrap.lists?.whitelist?.version ?? 0,
        localBlacklistVersion: bootstrap.lists?.blacklist?.version ?? 0,
        localApiConfigVersion: bootstrap.apiPolicy?.version ?? 0,
        services: {
            imapMonitor: 'running',
            smtpReporter: 'configured',
            quarantine: 'enabled',
            aiProvider: 'configured'
        }
    });
    log('customer-sync.heartbeat', 'ok', { serverTime: heartbeat.serverTime });

    const pull = await api(
        'GET',
        `/api/customer-sync/pull?customerId=${encodeURIComponent(activate.customerId)}&licenseKeyHash=${encodeURIComponent(licenseKeyHash)}&instanceId=${encodeURIComponent(instanceId)}&policyV=0&whitelistV=0&blacklistV=0&apiPolicyV=0`
    );
    log('customer-sync.pull', 'ok', {
        hasPolicy: !!pull.policy,
        hasLists: !!pull.lists,
        hasApiPolicy: !!pull.apiPolicy
    });

    const applied = [];
    if (pull.policy?.version) applied.push({ kind: 'policy', version: pull.policy.version });
    if (pull.lists?.whitelist?.version) applied.push({ kind: 'whitelist', version: pull.lists.whitelist.version });
    if (pull.lists?.blacklist?.version) applied.push({ kind: 'blacklist', version: pull.lists.blacklist.version });
    if (pull.apiPolicy?.version) applied.push({ kind: 'apiPolicy', version: pull.apiPolicy.version });

    const ack = await api('POST', '/api/customer-sync/ack', {
        customerId: activate.customerId,
        instanceId,
        applied
    });
    log('customer-sync.ack', 'ok', ack);

    console.log('[smoke-central] SUCCESS');
}

run().catch((err) => {
    console.error('[smoke-central] FAIL:', err.message);
    process.exit(1);
});
