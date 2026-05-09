// ============================================================
// HTTP routes: Tam konfigürasyon yedeği (export / import)
// Admin guard: requireAdminAuth
// API anahtarları, şifreler ve lisans bilgisi HARIÇ tutulur.
// ============================================================
const express = require('express');
const { requireAdminAuth }              = require('../../../middleware/adminAuth');
const { loadSettings, saveSettings }    = require('../../../storage/settingsStore');
const { state }                         = require('../../../services/appState');
const { loadLists, importLists }        = require('../../../storage/allowlistStore');
const { listTrustedDomains, importTrustedDomains } = require('../../../storage/trustedDomainStore');

const router = express.Router();

// Hassas / kuruluma özgü alanlar — export/import'a dahil edilmez
const EXCLUDE = new Set([
    'vtApiKey', 'claudeApiKey', 'openaiApiKey', 'otxApiKey',
    'adminPassword', 'customerPassword', 'licenseKey'
]);

// ─── Export ───────────────────────────────────────────────────
router.get('/admin/config/export', requireAdminAuth, (req, res) => {
    const settings = loadSettings();
    const safeSettings = {};
    for (const [k, v] of Object.entries(settings)) {
        if (!EXCLUDE.has(k)) safeSettings[k] = v;
    }

    const lists         = loadLists();
    const trustedRaw    = listTrustedDomains();

    const payload = {
        version:    1,
        exportedAt: new Date().toISOString(),
        settings:   safeSettings,
        allowlist:  lists.allowlist,
        blocklist:  lists.blocklist,
        trustedDomains: trustedRaw.map(d => ({
            domain:   d.domain,
            category: d.category,
            note:     d.note || '',
            enabled:  d.enabled !== 0
        }))
    };

    const filename = `mailtrustai-config-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
});

// ─── Import ───────────────────────────────────────────────────
router.post('/admin/config/import', requireAdminAuth, (req, res) => {
    const { settings, allowlist, blocklist, trustedDomains, merge = true } = req.body || {};

    if (!settings && !Array.isArray(allowlist) && !Array.isArray(blocklist) && !Array.isArray(trustedDomains)) {
        return res.status(400).json({ error: 'İçe aktarılacak geçerli veri bulunamadı' });
    }

    const result = {};

    // ── Ayarları uygula ─────────────────────────────────────
    if (settings && typeof settings === 'object') {
        const current = loadSettings();
        const toApply = {};
        for (const [k, v] of Object.entries(settings)) {
            if (!EXCLUDE.has(k)) toApply[k] = v;
        }
        saveSettings({ ...current, ...toApply });
        // In-memory state güncelle
        if (toApply.openaiModel  !== undefined) state.openaiModel  = toApply.openaiModel  || '';
        if (toApply.customPrices !== undefined) state.customPrices = toApply.customPrices || null;
        result.settingsApplied = Object.keys(toApply).length;
    }

    // ── Allow / Blocklist ────────────────────────────────────
    if (Array.isArray(allowlist) || Array.isArray(blocklist)) {
        result.lists = importLists(
            { allowlist: allowlist || [], blocklist: blocklist || [] },
            { merge }
        );
    }

    // ── OTX Güvenilir Domainler ──────────────────────────────
    if (Array.isArray(trustedDomains) && trustedDomains.length) {
        result.trustedDomains = importTrustedDomains(
            trustedDomains,
            { addedBy: 'config-import', merge }
        );
    }

    res.json({ success: true, ...result });
});

module.exports = router;
