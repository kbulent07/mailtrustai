'use strict';
const fetch = require('node-fetch');
const { env } = require('@mailtrustai/shared');

function _base() { return (env('LICENSE_SERVER_URL') || '').replace(/\/+$/, ''); }
function _headers() { return { 'content-type': 'application/json', 'authorization': `Bearer ${env('DEALER_API_TOKEN') || ''}` }; }

async function _req(method, p, body) {
    const url = `${_base()}${p}`;
    const opts = { method, headers: _headers(), timeout: 15000 };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch (_) {}
    if (!res.ok) { const e = new Error(`license-server ${p} ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
    return j || {};
}

// Auth çağrısı dealer'ın kendi password'unu license-server'a yollar; bearer GEREKMEZ.
async function verifyDealer(dealerId, password) {
    const fetch = require('node-fetch');
    const url = `${_base()}/api/dealer/auth/verify`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dealerId, password }),
        timeout: 10000
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || 'auth failed'); e.status = res.status; throw e; }
    return j;
}

module.exports = {
    verifyDealer,
    createLicense:  (body) => _req('POST', '/api/license/create', body),
    revokeLicense:  (body) => _req('POST', '/api/license/revoke', body),
    renewLicense:   (body) => _req('POST', '/api/license/renew', body),
    listCustomerLicenses: (id) => _req('GET',  `/api/license/customer/${encodeURIComponent(id)}`),
    dealerCustomersStatus: (dealerId) => _req('GET', `/api/central/dealers/${encodeURIComponent(dealerId)}/customers/status`),
    customerStatus:        (id) => _req('GET', `/api/central/customers/${encodeURIComponent(id)}/status`),
    audit:                 () => _req('GET', '/api/license/audit')
};
