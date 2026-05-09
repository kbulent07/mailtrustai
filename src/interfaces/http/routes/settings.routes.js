// ============================================================
// HTTP routes: API anahtarları, OTX testi, durum, webhook
// ============================================================
const express = require('express');
const bcrypt  = require('bcrypt');

const { loadSettings, saveSettings } = require('../../../storage/settingsStore');
const { state } = require('../../../services/appState');
const { requireAdminAuth } = require('../../../middleware/adminAuth');
const { OPENAI_MODEL, AVAILABLE_OPENAI_MODELS } = require('../../../integrations/openai');
const { testWebhook } = require('../../../integrations/webhook');

const router = express.Router();

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

    saveSettings({ ...current,
        vtApiKey: state.vtApiKey, claudeApiKey: state.claudeApiKey,
        openaiApiKey: state.openaiApiKey, openaiModel: state.openaiModel,
        otxApiKey: state.otxApiKey,
        companyProfile: { ...(current.companyProfile || {}), ...(req.body.companyProfile || {}) },
        adminPassword
    });

    res.json({
        success: true,
        vtConfigured:    !!state.vtApiKey,
        claudeConfigured:!!state.claudeApiKey,
        openaiConfigured:!!state.openaiApiKey,
        openaiModel:     state.openaiModel || OPENAI_MODEL,
        otxConfigured:   !!state.otxApiKey,
        companyProfile:  loadSettings().companyProfile || {}
    });
});

// OTX bağlantı testi
router.post('/settings/otx/test', requireAdminAuth, async (req, res) => {
    const { queryIndicator } = require('../../../integrations/otx');
    const apiKey = req.body.otxApiKey || state.otxApiKey;
    if (!apiKey) return res.status(400).json({ error: 'OTX API anahtarı tanımlı değil' });
    const result = await queryIndicator('IPv4', '8.8.8.8', apiKey);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, message: `OTX API bağlantısı başarılı — pulse sayısı: ${result.pulseCount ?? '?'}` });
});

router.get('/settings/status', (req, res) => {
    const settings = loadSettings();
    res.json({
        vtConfigured:    !!state.vtApiKey,
        claudeConfigured:!!state.claudeApiKey,
        openaiConfigured:!!state.openaiApiKey,
        openaiModel:     state.openaiModel || OPENAI_MODEL,
        availableModels: AVAILABLE_OPENAI_MODELS,
        otxConfigured:   !!state.otxApiKey,
        companyProfile:  settings.companyProfile || {}
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

router.post('/settings/webhook', (req, res) => {
    const current = loadSettings();
    saveSettings({ ...current,
        webhookEnabled:  !!req.body.webhookEnabled,
        webhookUrl:      String(req.body.webhookUrl || '').trim(),
        webhookMinLevel: ['safe','low','medium','high'].includes(req.body.webhookMinLevel) ? req.body.webhookMinLevel : 'low'
    });
    res.json({ success: true });
});

router.post('/settings/webhook/test', async (req, res) => {
    const url = req.body.webhookUrl || loadSettings().webhookUrl;
    if (!url) return res.status(400).json({ error: 'Webhook URL gerekli' });
    res.json(await testWebhook(url));
});

module.exports = router;
