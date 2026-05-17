'use strict';
const { env, envInt, fetchJSON, assertSafeUrl, logger } = require('@mailtrustai/shared');

function _base() {
    const url = (env('LICENSE_SERVER_URL') || '').replace(/\/+$/, '');
    if (!url) {
        const e = new Error('LICENSE_SERVER_URL tanımlı değil'); e.status = 503; throw e;
    }
    try { assertSafeUrl(url); } catch (e) {
        logger.error('[dealer] LICENSE_SERVER_URL geçersiz:', e.message);
        const err = new Error('LICENSE_SERVER_URL geçersiz'); err.status = 500; throw err;
    }
    return url;
}
function _token() { return env('DEALER_API_TOKEN') || ''; }
function _timeout() { return envInt('LICENSE_SERVER_TIMEOUT_MS', 15000); }

async function _req(method, p, body) {
    return fetchJSON(`${_base()}${p}`, {
        method,
        body,
        headers: { authorization: `Bearer ${_token()}` },
        timeoutMs: _timeout()
    });
}

// Auth çağrısı dealer'ın kendi password'unu license-server'a yollar; bearer GEREKMEZ.
async function verifyDealer(dealerId, password) {
    return fetchJSON(`${_base()}/api/dealer/auth/verify`, {
        method: 'POST',
        body: { dealerId, password },
        timeoutMs: Math.min(_timeout(), 10000)
    });
}

module.exports = {
    verifyDealer,
    createCustomer: (body) => _req('POST', '/api/license/customers', body),
    createLicense:  (body) => _req('POST', '/api/license/create', body),
    revokeLicense:  (body) => _req('POST', '/api/license/revoke', body),
    renewLicense:   (body) => _req('POST', '/api/license/renew', body),
    listCustomerLicenses: (id, dealerId) => _req('GET',
        `/api/license/customer/${encodeURIComponent(id)}?dealerId=${encodeURIComponent(dealerId || '')}`),
    dealerCustomersStatus: (dealerId) => _req('GET', `/api/central/dealers/${encodeURIComponent(dealerId)}/customers/status`),
    customerStatus:        (id) => _req('GET', `/api/central/customers/${encodeURIComponent(id)}/status`),
    auditForDealer:        (dealerId) => _req('GET', `/api/license/audit?dealerId=${encodeURIComponent(dealerId)}`),
    audit:                 () => _req('GET', '/api/license/audit')
};
