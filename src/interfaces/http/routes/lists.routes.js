// ============================================================
// HTTP routes: allowlist / blocklist
// ============================================================
const express = require('express');

const {
    loadLists, addToAllowlist, removeFromAllowlist,
    addToBlocklist, removeFromBlocklist
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

module.exports = router;
