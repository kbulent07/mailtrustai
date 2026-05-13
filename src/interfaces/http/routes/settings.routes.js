// ============================================================
// HTTP routes: API anahtarları, OTX testi, durum, webhook
// ============================================================
const express = require('express');
const bcrypt  = require('bcrypt');

const { loadSettings, saveSettings } = require('../../../storage/settingsStore');
const { state } = require('../../../services/appState');
const { requireAdminAuth } = require('../../../middleware/adminAuth');
const { OPENAI_MODEL, AVAILABLE_OPENAI_MODELS } = require('../../../integrations/openai');
const { getThreatIntelStats } = require('../../../integrations/threatIntel');
const { testWebhook } = require('../../../integrations/webhook');
const { recordAudit } = require('../../../storage/auditLog');

const router = express.Router();

// /settings/keys — Hassas alanlar (adminPassword, API key'ler) yalnız admin
// oturumuyla değiştirilebilir. Outer guard customer/license-key kabul ettiği
// için ayrıca requireAdminAuth lazım — aksi halde customer token sahibi admin
// şifresini değiştirebilir (privilege escalation).
router.post('/settings/keys', requireAdminAuth, async (req, res) => {
    const updateKey = (current, incoming) => {
        if (incoming === undefined) return current;
        if (incoming === ':clear') return '';
        if (typeof incoming === 'string' && incoming.trim() === '') return current;
        return incoming;
    };
    state.vtApiKey     = updateKey(state.vtApiKey,     req.body.vtApiKey);
    state.claudeApiKey = updateKey(state.claudeApiKey, req.body.claudeApiKey);
    state.openaiApiKey = updateKey(state.openaiApiKey, req.body.openaiApiKey);
    state.otxApiKey    = updateKey(state.otxApiKey,    req.body.otxApiKey);

    if (req.body.openaiModel !== undefined) {
        state.openaiModel = req.body.openaiModel === ':clear'
            ? '' : (String(req.body.openaiModel || '').trim() || state.openaiModel);
    }

    const current = loadSettings();
    let adminPassword = current.adminPassword;
    if (req.body.adminPassword !== undefined) {
        adminPassword = req.body.adminPassword ? await bcrypt.hash(req.body.adminPassword, 10) : '';
    }

    // Risk modu (classic | shadow | ai-judge)
    let riskMode = current.riskMode || 'classic';
    if (req.body.riskMode !== undefined) {
        const valid = ['classic', 'shadow', 'ai-judge'];
        riskMode = valid.includes(req.body.riskMode) ? req.body.riskMode : 'classic';
    }

    saveSettings({ ...current,
        vtApiKey: state.vtApiKey, claudeApiKey: state.claudeApiKey,
        openaiApiKey: state.openaiApiKey, openaiModel: state.openaiModel,
        otxApiKey: state.otxApiKey,
        companyProfile: { ...(current.companyProfile || {}), ...(req.body.companyProfile || {}) },
        adminPassword,
        riskMode
    });
    recordAudit({
        req,
        actorType: 'customer',
        actorId: 'settings',
        action: 'settings.keys.update',
        details: {
            vtConfigured: !!state.vtApiKey,
            claudeConfigured: !!state.claudeApiKey,
            openaiConfigured: !!state.openaiApiKey,
            otxConfigured: !!state.otxApiKey,
            openaiModel: state.openaiModel || OPENAI_MODEL,
            companyProfileUpdated: !!req.body.companyProfile,
            adminPasswordChanged: req.body.adminPassword !== undefined && !!req.body.adminPassword
        }
    });

    res.json({
        success: true,
        vtConfigured:    !!state.vtApiKey,
        claudeConfigured:!!state.claudeApiKey,
        openaiConfigured:!!state.openaiApiKey,
        openaiModel:     state.openaiModel || OPENAI_MODEL,
        otxConfigured:   !!state.otxApiKey,
        companyProfile:  loadSettings().companyProfile || {},
        riskMode:        riskMode
    });
});

// OTX bağlantı testi
router.post('/settings/otx/test', async (req, res) => {
    const { queryIndicator } = require('../../../integrations/otx');
    const apiKey = req.body.otxApiKey || state.otxApiKey;
    if (!apiKey) return res.status(400).json({ error: 'OTX API anahtarı tanımlı değil' });
    const result = await queryIndicator('IPv4', '8.8.8.8', apiKey);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: `OTX API bağlantısı başarılı — pulse sayısı: ${result.pulseCount ?? '?'}` });
});

router.get('/settings/status', (req, res) => {
    const settings = loadSettings();
    const threatIntel = getThreatIntelStats();
    res.json({
        vtConfigured:    !!state.vtApiKey,
        claudeConfigured:!!state.claudeApiKey,
        openaiConfigured:!!state.openaiApiKey,
        openaiModel:     state.openaiModel || OPENAI_MODEL,
        availableModels: AVAILABLE_OPENAI_MODELS,
        otxConfigured:   !!state.otxApiKey,
        abuseFeedAvailable: !!threatIntel.available,
        abuseFeedUpdatedAt: threatIntel.updatedAt,
        companyProfile:  settings.companyProfile || {},
        riskMode:        settings.riskMode || 'classic'
    });
});

router.get('/settings/webhook', (req, res) => {
    const s = loadSettings();
    res.json({
        webhookEnabled:  s.webhookEnabled || false,
        webhookUrl:      s.webhookUrl || '',
        webhookMinLevel: s.webhookMinLevel || 'low'
    });
});

// SSRF korumalı webhook URL doğrulayıcı — private/loopback IP'leri reddet
function _isWebhookUrlSafe(rawUrl) {
    if (!rawUrl) return { ok: true, url: '' };  // boş = devre dışı
    let u;
    try { u = new URL(rawUrl); } catch { return { ok: false, error: 'Geçersiz URL' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return { ok: false, error: 'Yalnız http(s) protokolü kabul edilir' };
    }
    const host = u.hostname.toLowerCase();
    // IPv4 private/loopback/link-local + IPv6 loopback/private
    const blocked = [
        /^localhost$/, /^127\./, /^10\./, /^192\.168\./,
        /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\.0\.0\.0$/,
        /^::1$/, /^fc[0-9a-f]{2}:/i, /^fd[0-9a-f]{2}:/i, /^fe80:/i,
        // AWS/GCP/Azure metadata
        /^169\.254\.169\.254$/, /^metadata\.google\.internal$/
    ];
    if (blocked.some(rx => rx.test(host))) {
        return { ok: false, error: `Yerel/özel adres webhook olarak kullanılamaz: ${host}` };
    }
    return { ok: true, url: u.toString() };
}

router.post('/settings/webhook', requireAdminAuth, (req, res) => {
    const safety = _isWebhookUrlSafe(String(req.body.webhookUrl || '').trim());
    if (!safety.ok) return res.status(400).json({ error: safety.error });

    const current = loadSettings();
    saveSettings({ ...current,
        webhookEnabled:  !!req.body.webhookEnabled,
        webhookUrl:      safety.url,
        webhookMinLevel: ['safe','low','medium','high'].includes(req.body.webhookMinLevel) ? req.body.webhookMinLevel : 'low'
    });
    recordAudit({
        req,
        actorType: 'customer',
        actorId: 'settings',
        action: 'settings.webhook.update',
        details: { enabled: !!req.body.webhookEnabled, minLevel: req.body.webhookMinLevel || 'low' }
    });
    res.json({ success: true });
});

router.post('/settings/webhook/test', requireAdminAuth, async (req, res) => {
    const url = req.body.webhookUrl || loadSettings().webhookUrl;
    if (!url) return res.status(400).json({ error: 'Webhook URL gerekli' });
    const safety = _isWebhookUrlSafe(url);
    if (!safety.ok) return res.status(400).json({ error: safety.error });
    res.json(await testWebhook(safety.url));
});

module.exports = router;
