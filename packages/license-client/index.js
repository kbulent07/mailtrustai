'use strict';
// Customer-side license istemcisi. license-core'a (key generator/imzalama)
// HİÇBİR şekilde dependency yoktur — customer image içine sızmamalıdır.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { logger, env, envInt, APP, scrubPII, fetchJSON } = require('@mailtrustai/shared');
const { encryptJSON, decryptJSON, sha256 } = require('@mailtrustai/security');

const DATA_DIR = env('DATA_DIR', path.join(process.cwd(), 'data'));
const CACHE_PATH = path.join(DATA_DIR, 'license-cache.enc');

function _ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {} }

function readCache() {
    try {
        if (!fs.existsSync(CACHE_PATH)) return null;
        return decryptJSON(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch (e) {
        logger.warn('license cache okunamadı:', e.message);
        return null;
    }
}
function writeCache(obj) {
    _ensureDir();
    fs.writeFileSync(CACHE_PATH, encryptJSON(obj), { mode: 0o600 });
}

function instanceFingerprint() {
    const fromEnv = env('MSA_INSTANCE_ID');
    if (fromEnv) return fromEnv;
    const cache = readCache();
    if (cache && cache.instanceId) return cache.instanceId;
    const seed = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model || '', String(os.totalmem())].join('|');
    return 'inst_' + sha256(seed).slice(0, 24);
}

async function _post(remoteUrl, pathPart, body) {
    const url = `${remoteUrl.replace(/\/+$/, '')}${pathPart}`;
    return fetchJSON(url, {
        method: 'POST',
        body,
        timeoutMs: envInt('MSA_LICENSE_REMOTE_TIMEOUT_MS', 15000)
    });
}

async function activate({ remoteUrl, licenseKey }) {
    const instanceId = instanceFingerprint();
    const r = await _post(remoteUrl, '/api/license/activate', {
        licenseKey,
        instanceId,
        appVersion: APP.VERSION,
        buildVersion: APP.BUILD,
        nodeVersion: process.versions.node,
        environment: env('NODE_ENV', 'production'),
        hostnameHash: sha256(os.hostname())
    });
    const cache = {
        instanceId,
        licenseKeyHash: sha256(licenseKey),
        activationId: r.activationId,
        customerId: r.customerId,
        dealerId: r.dealerId,
        plan: r.plan,
        tier: r.tier,
        features: r.features || {},
        limits: r.limits || {},
        expiresAt: r.expiresAt,
        graceDays: r.graceDays || 1,
        // Sunucu admin'i tarafından set edilmiş offline çalışma izni (gün).
        // graceCheck() bu varsa graceDays yerine kullanır → uzun süre offline çalışabilir.
        offlineGraceDaysOverride: (typeof r.offlineGraceDaysOverride === 'number' && r.offlineGraceDaysOverride >= 0)
            ? r.offlineGraceDaysOverride : null,
        licenseStatus: r.licenseStatus || 'active',
        lastValidatedAt: Date.now(),
        lastValidationOk: true
    };
    writeCache(cache);
    return cache;
}

async function validate({ remoteUrl, licenseKey }) {
    try {
        const r = await _post(remoteUrl, '/api/license/validate', {
            licenseKeyHash: sha256(licenseKey),
            instanceId: instanceFingerprint()
        });
        const prev = readCache() || {};
        const next = { ...prev, ...r, lastValidatedAt: Date.now(), lastValidationOk: true };
        writeCache(next);
        return { ok: true, status: r.licenseStatus, fromCache: false };
    } catch (e) {
        logger.warn('validate başarısız, grace kontrolüne düşülüyor:', e.message);
        return graceCheck();
    }
}

function graceCheck() {
    const cache = readCache();
    if (!cache) return { ok: false, status: 'unlicensed', fromCache: false };
    // Sunucu admin override'ı varsa graceDays yerine onu kullan (uzun offline mod).
    const days = (typeof cache.offlineGraceDaysOverride === 'number' && cache.offlineGraceDaysOverride >= 0)
        ? cache.offlineGraceDaysOverride
        : (cache.graceDays || 1);
    const ageMs = Date.now() - (cache.lastValidatedAt || 0);
    const limitMs = days * 24 * 60 * 60 * 1000;
    if (ageMs <= limitMs) {
        return {
            ok: true,
            status: cache.licenseStatus || 'active',
            fromCache: true,
            graceRemainingMs: limitMs - ageMs,
            // Hangi grace kullanılıyor görünür olsun (debug / panel feedback)
            graceSource: (cache.offlineGraceDaysOverride != null) ? 'admin-override' : 'plan-default'
        };
    }
    return { ok: false, status: 'grace_expired', fromCache: true };
}

function featureEnabled(feature) {
    const c = readCache();
    if (!c || !c.features) return false;
    return !!c.features[feature];
}

function getSnapshot() {
    const c = readCache();
    if (!c) return null;
    // Sızıntıya karşı PII scrub'lı snapshot
    return scrubPII({
        licenseStatus: c.licenseStatus, plan: c.plan, tier: c.tier,
        features: c.features, expiresAt: c.expiresAt,
        customerId: c.customerId, dealerId: c.dealerId,
        instanceId: c.instanceId, activationId: c.activationId,
        licenseKeyHash: c.licenseKeyHash
    });
}

module.exports = { activate, validate, graceCheck, featureEnabled, instanceFingerprint, getSnapshot, readCache, writeCache };
