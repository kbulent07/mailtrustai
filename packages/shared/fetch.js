'use strict';
// Ortak HTTP istemcisi — gerçek request timeout (AbortController),
// SSRF koruması (URL şema kontrolü), retry-safe error sınıflandırması.

const fetch = require('node-fetch');
const { logger } = require('./index');

const ALLOWED_PROTOS = new Set(['http:', 'https:']);

function assertSafeUrl(rawUrl) {
    let u;
    try { u = new URL(rawUrl); }
    catch (_) { const e = new Error(`geçersiz URL: ${rawUrl}`); e.code = 'BAD_URL'; throw e; }
    if (!ALLOWED_PROTOS.has(u.protocol)) {
        const e = new Error(`yasak protokol: ${u.protocol}`); e.code = 'BAD_PROTO'; throw e;
    }
    return u;
}

/**
 * fetchJSON: timeout'lu, JSON-aware HTTP istemcisi.
 * - timeoutMs: gerçek istek zaman aşımı (AbortController)
 * - headers: ek başlıklar
 * - method, body otomatik JSON serialize
 */
async function fetchJSON(rawUrl, { method = 'GET', body, headers = {}, timeoutMs = 15000 } = {}) {
    assertSafeUrl(rawUrl);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const opts = {
            method,
            headers: { 'content-type': 'application/json', ...headers },
            signal: ac.signal
        };
        if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body);

        const res = await fetch(rawUrl, opts);
        const text = await res.text();
        let json = null;
        if (text) { try { json = JSON.parse(text); } catch (_) { /* not json */ } }

        if (!res.ok) {
            const err = new Error(`${method} ${rawUrl} ${res.status}: ${text.slice(0, 200)}`);
            err.status = res.status;
            err.body = json;
            throw err;
        }
        return json || {};
    } catch (e) {
        if (e.name === 'AbortError') {
            const err = new Error(`request timeout: ${rawUrl} (${timeoutMs}ms)`);
            err.code = 'TIMEOUT';
            throw err;
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { fetchJSON, assertSafeUrl };
