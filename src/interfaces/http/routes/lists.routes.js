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

module.exports = router;
