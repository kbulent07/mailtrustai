'use strict';
// Customer-side merkezi sync client. Payload'ta SADECE operasyonel
// telemetri ve versiyon bilgileri bulunur. Mail içeriği, credentials,
// raw header, attachment isim/içerik HİÇBİR yere yazılmaz/gönderilmez.

const fs = require('fs');
const os = require('os');
const path = require('path');
const fetch = require('node-fetch');
const { logger, env, envInt, envBool, APP, scrubPII } = require('@mailtrustai/shared');
const { sha256, encryptJSON, decryptJSON } = require('@mailtrustai/security');
const licenseClient = require('@mailtrustai/license-client');

const DATA_DIR = env('DATA_DIR', path.join(process.cwd(), 'data'));
const STATE_PATH = path.join(DATA_DIR, 'central-sync-state.enc');
const POLICY_CACHE = path.join(DATA_DIR, 'central-policy.enc');
const LISTS_CACHE  = path.join(DATA_DIR, 'central-lists.enc');
const APICFG_CACHE = path.join(DATA_DIR, 'central-api-policy.enc');

const HEARTBEAT_KEYS = [
    'licenseKeyHash', 'customerId', 'dealerId', 'activationId', 'instanceId',
    'appVersion', 'buildVersion', 'nodeVersion', 'environment', 'hostnameHash',
    'lastHeartbeatAt', 'healthStatus', 'enabledFeatures', 'monthlyScanCount',
    'dailyScanCount', 'mailboxCount', 'userCount', 'licenseStatus', 'plan', 'tier',
    'localPolicyVersion', 'localWhitelistVersion', 'localBlacklistVersion',
    'localApiConfigVersion', 'errorSummary', 'services'
];

const SERVICE_KEYS = ['imapMonitor', 'smtpReporter', 'quarantine', 'aiProvider'];

function _ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {} }
function _readEnc(p, def = null) { try { return fs.existsSync(p) ? decryptJSON(fs.readFileSync(p, 'utf8')) : def; } catch (_) { return def; } }
function _writeEnc(p, obj) { _ensureDir(); fs.writeFileSync(p, encryptJSON(obj), { mode: 0o600 }); }

function getState() { return _readEnc(STATE_PATH, { localPolicyVersion: 0, localWhitelistVersion: 0, localBlacklistVersion: 0, localApiConfigVersion: 0, pendingAcks: [] }); }
function setState(s) { _writeEnc(STATE_PATH, s); }
function getPolicy() { return _readEnc(POLICY_CACHE, null); }
function getLists()  { return _readEnc(LISTS_CACHE,  { whitelist: { domains: [], senders: [] }, blacklist: { domains: [], senders: [], urls: [], attachmentHashes: [] } }); }
function getApiPolicy() { return _readEnc(APICFG_CACHE, null); }

async function _fetch(method, syncUrl, p, body) {
    const url = `${syncUrl.replace(/\/+$/, '')}${p}`;
    const opts = { method, headers: { 'content-type': 'application/json' }, timeout: 15000 };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    if (!res.ok) {
        const e = new Error(`central ${p} ${res.status}: ${text.slice(0, 200)}`);
        e.status = res.status; throw e;
    }
    try { return JSON.parse(text); } catch (_) { return {}; }
}
async function _withRetry(fn, label) {
    const max = envInt('MSA_CENTRAL_SYNC_RETRIES', 3);
    let delay = 1000;
    for (let i = 0; i <= max; i++) {
        try { return await fn(); }
        catch (e) {
            if (i === max) { logger.warn(`[central-sync] ${label} başarısız (final):`, e.message); throw e; }
            logger.warn(`[central-sync] ${label} retry ${i + 1}/${max}:`, e.message);
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(delay * 2, 30000);
        }
    }
}

function _baseTelemetry({ counters = {}, services = {} } = {}) {
    const lic = licenseClient.getSnapshot() || {};
    const envLicenseKey = env('MSA_LICENSE_KEY', '');
    const state = getState();
    return {
        licenseKeyHash: lic.licenseKeyHash || (envLicenseKey ? sha256(envLicenseKey) : null),
        customerId: lic.customerId || null,
        dealerId: lic.dealerId || null,
        activationId: lic.activationId || null,
        instanceId: lic.instanceId || licenseClient.instanceFingerprint(),
        appVersion: APP.VERSION,
        buildVersion: APP.BUILD,
        nodeVersion: process.versions.node,
        environment: env('NODE_ENV', 'production'),
        hostnameHash: sha256(os.hostname()),
        healthStatus: services.healthStatus || 'ok',
        enabledFeatures: lic.features || {},
        plan: lic.plan || null,
        tier: lic.tier || null,
        licenseStatus: lic.licenseStatus || null,
        // Sayaçlar (mail içeriği değil, agregat)
        monthlyScanCount: counters.monthlyScanCount || 0,
        dailyScanCount:   counters.dailyScanCount   || 0,
        mailboxCount:     counters.mailboxCount     || 0,
        userCount:        counters.userCount        || 0,
        // Versiyon hash'leri
        localPolicyVersion:    state.localPolicyVersion    || 0,
        localWhitelistVersion: state.localWhitelistVersion || 0,
        localBlacklistVersion: state.localBlacklistVersion || 0,
        localApiConfigVersion: state.localApiConfigVersion || 0,
        // Servis durumu (boolean özet, credential YOK)
        services: {
            imapMonitor:   services.imapMonitor   || 'stopped',
            smtpReporter:  services.smtpReporter  || 'not_configured',
            quarantine:    services.quarantine    || 'disabled',
            aiProvider:    services.aiProvider    || 'not_configured'
        },
        errorSummary: services.errorSummary ? String(services.errorSummary).slice(0, 200) : null,
        lastHeartbeatAt: new Date().toISOString()
    };
}

function sanitizeHeartbeatPayload(raw) {
    const cleaned = scrubPII(raw || {});
    const out = {};
    for (const key of HEARTBEAT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(cleaned, key)) out[key] = cleaned[key];
    }
    const svc = {};
    for (const key of SERVICE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(out.services || {}, key)) svc[key] = out.services[key];
    }
    out.services = svc;
    if (!out.enabledFeatures || typeof out.enabledFeatures !== 'object') out.enabledFeatures = {};
    return out;
}

async function bootstrapCustomer({ syncUrl, gather }) {
    return _withRetry(async () => {
        const payload = sanitizeHeartbeatPayload(_baseTelemetry(gather ? await gather() : {}));
        const res = await _fetch('POST', syncUrl, '/api/customer-sync/bootstrap', payload);
        if (res.policy)    { _writeEnc(POLICY_CACHE,  res.policy);    }
        if (res.lists)     { _writeEnc(LISTS_CACHE,   res.lists);     }
        if (res.apiPolicy) { _writeEnc(APICFG_CACHE,  res.apiPolicy); }
        const s = getState();
        if (res.policy)    s.localPolicyVersion    = res.policy.version    || s.localPolicyVersion;
        if (res.lists)     { s.localWhitelistVersion = res.lists.whitelist?.version || s.localWhitelistVersion; s.localBlacklistVersion = res.lists.blacklist?.version || s.localBlacklistVersion; }
        if (res.apiPolicy) s.localApiConfigVersion = res.apiPolicy.version || s.localApiConfigVersion;
        setState(s);
        return res;
    }, 'bootstrap');
}

async function sendHeartbeat({ syncUrl, gather }) {
    return _withRetry(async () => {
        const payload = sanitizeHeartbeatPayload(_baseTelemetry(gather ? await gather() : {}));
        return await _fetch('POST', syncUrl, '/api/customer-sync/heartbeat', payload);
    }, 'heartbeat');
}

async function pullCentralUpdates({ syncUrl }) {
    return _withRetry(async () => {
        const state = getState();
        const lic = licenseClient.getSnapshot() || {};
        const q = new URLSearchParams({
            customerId: String(lic.customerId || ''),
            instanceId: String(lic.instanceId || licenseClient.instanceFingerprint()),
            policyV: String(state.localPolicyVersion || 0),
            whitelistV: String(state.localWhitelistVersion || 0),
            blacklistV: String(state.localBlacklistVersion || 0),
            apiPolicyV: String(state.localApiConfigVersion || 0)
        }).toString();
        const res = await _fetch('GET', syncUrl, `/api/customer-sync/pull?${q}`);
        const acks = [];
        if (res.policy)    { _writeEnc(POLICY_CACHE,  res.policy);    state.localPolicyVersion    = res.policy.version;    acks.push({ kind: 'policy',    version: res.policy.version }); }
        if (res.lists) {
            const cur = getLists();
            const merged = {
                whitelist: { ...cur.whitelist, ...(res.lists.whitelist || {}) },
                blacklist: { ...cur.blacklist, ...(res.lists.blacklist || {}) },
                version: res.lists.version
            };
            _writeEnc(LISTS_CACHE, merged);
            if (res.lists.whitelist?.version) { state.localWhitelistVersion = res.lists.whitelist.version; acks.push({ kind: 'whitelist', version: res.lists.whitelist.version }); }
            if (res.lists.blacklist?.version) { state.localBlacklistVersion = res.lists.blacklist.version; acks.push({ kind: 'blacklist', version: res.lists.blacklist.version }); }
        }
        if (res.apiPolicy) { _writeEnc(APICFG_CACHE,  res.apiPolicy); state.localApiConfigVersion = res.apiPolicy.version; acks.push({ kind: 'apiPolicy', version: res.apiPolicy.version }); }
        setState(state);
        return { applied: acks, raw: res };
    }, 'pull');
}

async function ackCentralUpdate({ syncUrl, applied }) {
    if (!applied || !applied.length) return { ok: true, empty: true };
    return _withRetry(async () => {
        const lic = licenseClient.getSnapshot() || {};
        return await _fetch('POST', syncUrl, '/api/customer-sync/ack', {
            customerId: lic.customerId || null,
            instanceId: lic.instanceId || licenseClient.instanceFingerprint(),
            applied
        });
    }, 'ack');
}

// Convenience aliases for the function names from the spec
const syncPolicy    = pullCentralUpdates;
const syncLists     = pullCentralUpdates;
const syncApiPolicy = pullCentralUpdates;

// Periyodik runner — customer server.js bunu boot'ta başlatır.
function startPeriodicSync({ syncUrl, gather, heartbeatSeconds = 300, pullSeconds = 900, enabled = true }) {
    if (!enabled) { logger.info('[central-sync] devre dışı (MSA_CENTRAL_SYNC_ENABLED=false)'); return { stop() {} }; }
    if (!syncUrl) { logger.warn('[central-sync] MSA_CENTRAL_SYNC_URL boş, sync atlandı'); return { stop() {} }; }
    let stopped = false;
    const hb = setInterval(() => { if (!stopped) sendHeartbeat({ syncUrl, gather }).catch(e => logger.warn('hb:', e.message)); }, heartbeatSeconds * 1000);
    const pl = setInterval(async () => {
        if (stopped) return;
        try { const r = await pullCentralUpdates({ syncUrl }); if (r.applied.length) await ackCentralUpdate({ syncUrl, applied: r.applied }); }
        catch (e) { logger.warn('pull/ack:', e.message); }
    }, pullSeconds * 1000);
    // İlk açılış: hemen bir bootstrap dene
    bootstrapCustomer({ syncUrl, gather }).catch(e => logger.warn('bootstrap (deferred-fallback):', e.message));
    return { stop() { stopped = true; clearInterval(hb); clearInterval(pl); } };
}

module.exports = {
    bootstrapCustomer, sendHeartbeat, pullCentralUpdates, ackCentralUpdate,
    syncPolicy, syncLists, syncApiPolicy,
    sanitizeHeartbeatPayload, HEARTBEAT_KEYS,
    getState, getPolicy, getLists, getApiPolicy,
    startPeriodicSync
};
