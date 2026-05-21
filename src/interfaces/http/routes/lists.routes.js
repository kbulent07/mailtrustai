// ============================================================
// HTTP routes: allowlist / blocklist
// ============================================================
const express = require('express');

const {
    loadLists, addToAllowlist, removeFromAllowlist,
    addToBlocklist, removeFromBlocklist, importLists
} = require('../../../storage/allowlistStore');

const router = express.Router();

router.get('/lists', (req, res) => res.json(loadLists()));

router.post('/lists/allowlist', (req, res) => {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain gerekli' });
    addToAllowlist(domain);
    res.json({ success: true, lists: loadLists() });
});

router.delete('/lists/allowlist/:domain', (req, res) => {
    removeFromAllowlist(decodeURIComponent(req.params.domain));
    res.json({ success: true, lists: loadLists() });
});

router.post('/lists/blocklist', (req, res) => {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain gerekli' });
    addToBlocklist(domain);
    res.json({ success: true, lists: loadLists() });
});

router.delete('/lists/blocklist/:domain', (req, res) => {
    removeFromBlocklist(decodeURIComponent(req.params.domain));
    res.json({ success: true, lists: loadLists() });
});

// ─── Export ────────────────────────────────────────────────────────────────
router.get('/lists/export', (req, res) => {
    const lists = loadLists();
    const payload = {
        version:    1,
        exportedAt: new Date().toISOString(),
        allowlist:  lists.allowlist,
        blocklist:  lists.blocklist
    };
    const filename = `mailtrustai-lists-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
});

// ─── Import ────────────────────────────────────────────────────────────────
router.post('/lists/import', (req, res) => {
    const { allowlist, blocklist, merge = true } = req.body || {};
    if (!Array.isArray(allowlist) && !Array.isArray(blocklist)) {
        return res.status(400).json({ error: 'allowlist veya blocklist dizisi zorunludur' });
    }
    try {
        const result = importLists({ allowlist: allowlist || [], blocklist: blocklist || [] }, { merge });
        res.json({ success: true, ...result, lists: loadLists() });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ─── Merkezden senkronize et ───────────────────────────────────────────────
// Central-sync paketi license-server'dan policy + lists pull eder. Bu endpoint
// merkez listelerini lokale MERGE eder — kullanicinin elle ekledigi girisler
// SILINMEZ, sadece yeni gelenler eklenir (importLists merge=true).
//
// Central format: { whitelist: { domains:[], senders:[] }, blacklist: { domains:[], senders:[], urls:[], attachmentHashes:[] } }
// Lokal format:   { allowlist: [...], blocklist: [...] }
// URL ve attachment hash'ler bu liste tipinde tutulmaz — eslestirme sadece
// domain + sender (email) icin.
router.post('/lists/sync-from-central', async (req, res) => {
    try {
        // central-sync paketi yalnizca apps/customer bagliminda yuklu — fallback ile
        // legacy/test ortamlarinda 503 doneriz.
        let centralSync;
        try { centralSync = require('@mailtrustai/central-sync'); }
        catch (_) {
            return res.status(503).json({ error: 'Merkez senkronizasyonu bu kurulumda etkin degil.' });
        }

        // Merkezden taze pull tetikle. syncUrl olmazsa MSA_CENTRAL_SYNC_URL veya
        // MSA_LICENSE_REMOTE_URL'den okunur.
        const syncUrl = process.env.MSA_CENTRAL_SYNC_URL
                     || process.env.MSA_LICENSE_REMOTE_URL
                     || '';
        if (syncUrl && typeof centralSync.syncLists === 'function') {
            try { await centralSync.syncLists({ syncUrl }); } catch (_) { /* cache fallback */ }
        }

        const cl = centralSync.getLists() || {};
        const wl = cl.whitelist || {};
        const bl = cl.blacklist || {};

        // Domain + sender → lokal liste girisleri (importLists kendi normalize'ini yapar)
        const incomingAllow = [
            ...(Array.isArray(wl.domains) ? wl.domains : []),
            ...(Array.isArray(wl.senders) ? wl.senders : [])
        ];
        const incomingBlock = [
            ...(Array.isArray(bl.domains) ? bl.domains : []),
            ...(Array.isArray(bl.senders) ? bl.senders : [])
        ];

        if (!incomingAllow.length && !incomingBlock.length) {
            return res.json({
                success: true,
                allowlistAdded: 0,
                blocklistAdded: 0,
                centralEmpty: true,
                lists: loadLists()
            });
        }

        // MERGE=true: lokal entries korunur, yenileri eklenir
        const result = importLists(
            { allowlist: incomingAllow, blocklist: incomingBlock },
            { merge: true }
        );

        res.json({
            success: true,
            ...result,
            centralCounts: {
                whitelistDomains: (wl.domains || []).length,
                whitelistSenders: (wl.senders || []).length,
                blacklistDomains: (bl.domains || []).length,
                blacklistSenders: (bl.senders || []).length
            },
            syncedAt: new Date().toISOString(),
            lists: loadLists()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
