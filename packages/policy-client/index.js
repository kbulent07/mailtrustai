'use strict';
// Customer-side policy / list / API policy değerlendirme katmanı.
// Merkezi sync sonuçlarını local override'lar ile birleştirir,
// analyzer ve mail paketlerine sade bir karar arayüzü sunar.

const licenseClient = require('@mailtrustai/license-client');
const centralSync   = require('@mailtrustai/central-sync');

function isFeatureEnabled(feature) {
    // 1) license features
    if (!licenseClient.featureEnabled(feature)) return false;
    // 2) central policy override (varsa)
    const p = centralSync.getPolicy();
    if (p && p.featureOverrides && Object.prototype.hasOwnProperty.call(p.featureOverrides, feature)) {
        return !!p.featureOverrides[feature];
    }
    return true;
}

function getLimits() {
    const snap = licenseClient.getSnapshot() || {};
    const p = centralSync.getPolicy();
    return { ...(snap.limits || {}), ...((p && p.limits) || {}) };
}

// Domain/sender whitelist & blacklist merge — central + local.
// Yerel allowlistStore / trustedDomainStore opsiyonel olarak verilebilir.
function evaluateAddress({ domain, sender, localWhitelist = [], localBlacklist = [] }) {
    const lists = centralSync.getLists();
    const cw = (lists.whitelist?.domains || []).map(s => s.toLowerCase());
    const cb = (lists.blacklist?.domains || []).map(s => s.toLowerCase());
    const cws = (lists.whitelist?.senders || []).map(s => s.toLowerCase());
    const cbs = (lists.blacklist?.senders || []).map(s => s.toLowerCase());
    const lw = localWhitelist.map(s => s.toLowerCase());
    const lb = localBlacklist.map(s => s.toLowerCase());
    const d = (domain || '').toLowerCase();
    const s = (sender || '').toLowerCase();

    // Conflict resolution: LOCAL whitelist > LOCAL blacklist > CENTRAL blacklist > CENTRAL whitelist.
    // Müşterinin kendi listesi merkezden gelene baskındır; merkez ise default'tur.
    if (lw.includes(d) || lw.includes(s)) return { decision: 'allow', source: 'local-whitelist' };
    if (lb.includes(d) || lb.includes(s)) return { decision: 'deny',  source: 'local-blacklist' };
    if (cbs.includes(s) || cb.includes(d)) return { decision: 'deny', source: 'central-blacklist' };
    if (cws.includes(s) || cw.includes(d)) return { decision: 'allow', source: 'central-whitelist' };
    return { decision: 'neutral', source: 'none' };
}

function isAttachmentHashBlocked(sha256Hex) {
    if (!sha256Hex) return false;
    const lists = centralSync.getLists();
    const arr = (lists.blacklist?.attachmentHashes || []).map(s => String(s).toLowerCase());
    return arr.includes(String(sha256Hex).toLowerCase());
}

// API policy değerlendirme — kullanıcıya provider/quota izinleri.
function evaluateApiPolicy(provider) {
    const ap = centralSync.getApiPolicy();
    if (!ap) return { allowed: true, reason: 'no-policy' }; // policy yoksa: izinli (geriye uyumlu)
    const a = (ap.allowedProviders || []).map(s => s.toLowerCase());
    if (a.length && !a.includes(String(provider).toLowerCase())) return { allowed: false, reason: 'provider-not-allowed' };
    return {
        allowed: true,
        rateLimit:   ap.rateLimit   || null,
        dailyQuota:  ap.dailyQuota  || null,
        monthlyQuota:ap.monthlyQuota|| null,
        centralApiProxyEnabled: !!ap.centralApiProxyEnabled,
        centralApiProxyEndpoint: ap.centralApiProxyEndpoint || null
    };
}

module.exports = { isFeatureEnabled, getLimits, evaluateAddress, isAttachmentHashBlocked, evaluateApiPolicy };
