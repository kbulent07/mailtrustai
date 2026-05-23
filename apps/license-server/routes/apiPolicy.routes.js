'use strict';

const express = require('express');
const { asyncH } = require('@mailtrustai/shared');
const { get, run, audit, isMaria } = require('../db');

const router = express.Router();

// Global varsayılan AI modelleri (admin_settings) — owner Merkezi Yönetim'den ayarlar.
async function _globalAiModels() {
    const o = await get("SELECT setting_value FROM admin_settings WHERE setting_key='ai_model_openai'");
    const c = await get("SELECT setting_value FROM admin_settings WHERE setting_key='ai_model_claude'");
    return {
        openai: (o?.setting_value || '').trim() || null,
        claude: (c?.setting_value || '').trim() || null
    };
}

// Müşteriye gidecek EFEKTİF AI modeli: müşteri-bazlı override (apiPolicy.body.aiModels)
// varsa onu, yoksa global default'u kullanır. Bu alan müşteride MODELI KİLİTLER —
// müşteri admini değiştiremez (yalnız owner Merkezi Yönetim'den).
async function _effectiveAiModels(overrideBody) {
    const globals  = await _globalAiModels();
    const override = (overrideBody && typeof overrideBody.aiModels === 'object') ? overrideBody.aiModels : {};
    return {
        openai: (override.openai || '').trim() || globals.openai || null,
        claude: (override.claude || '').trim() || globals.claude || null
    };
}

async function getApiPolicy(customerId) {
    const row  = await get('SELECT * FROM api_policies WHERE customer_id=?', [customerId]);
    const body = row ? JSON.parse(row.body_json) : {
        allowedProviders: ['openai', 'claude', 'virustotal', 'otx'],
        rateLimit: null,
        dailyQuota: null,
        monthlyQuota: null,
        centralApiProxyEnabled: false
    };
    // Efektif AI modelini (override ?? global) gövdeye yaz — müşteri bunu uygular/kilitler.
    body.aiModels = await _effectiveAiModels(body);
    return { customerId, version: row?.version || 0, body, updatedAt: row?.updated_at };
}

router.get('/config/:customerId/api-policy', asyncH(async (req, res) => {
    res.json(await getApiPolicy(req.params.customerId));
}));

router.post('/config/:customerId/api-policy', asyncH(async (req, res) => {
    const current = await get('SELECT version, body_json FROM api_policies WHERE customer_id=?', [req.params.customerId]);
    const nextVersion = (current?.version || 0) + 1;

    // AI model override yalnız owner ucundan (PUT /admin/customers/:id/ai-model) yönetilir.
    // Genel api-policy düzenlemesi mevcut aiModels override'ını EZMESİN: gelen body'deki
    // aiModels yok sayılır, kayıtlı RAW override korunur.
    const body = { ...(req.body || {}) };
    let storedAiModels;
    try { storedAiModels = JSON.parse(current?.body_json || '{}').aiModels; } catch { storedAiModels = undefined; }
    if (storedAiModels !== undefined) body.aiModels = storedAiModels;
    else delete body.aiModels;
    req.body = body;
    const sql = isMaria
        ? `INSERT INTO api_policies(customer_id,version,body_json,updated_at) VALUES(?,?,?,?)
           ON DUPLICATE KEY UPDATE version=VALUES(version), body_json=VALUES(body_json), updated_at=VALUES(updated_at)`
        : `INSERT INTO api_policies(customer_id,version,body_json,updated_at) VALUES(?,?,?,?)
           ON CONFLICT(customer_id) DO UPDATE SET version=excluded.version, body_json=excluded.body_json, updated_at=excluded.updated_at`;

    await run(sql, [req.params.customerId, nextVersion, JSON.stringify(req.body || {}), Date.now()]);
    await audit('admin', 'api-policy.update', req.params.customerId, { version: nextVersion });
    res.json({ ok: true, version: nextVersion });
}));

router.get('/config/:customerId/version', asyncH(async (req, res) => {
    const row = await get('SELECT version FROM api_policies WHERE customer_id=?', [req.params.customerId]);
    res.json({ customerId: req.params.customerId, version: row?.version || 0 });
}));

module.exports = { router, getApiPolicy };
