// ============================================================
// HTTP routes: Trusted (OTX whitelist) domain yönetimi
// Admin guard: requireAdminAuth
// ============================================================
const express = require('express');
const { requireAdminAuth } = require('../../../middleware/adminAuth');
const {
    listTrustedDomains,
    addTrustedDomain,
    addTrustedDomainsBulk,
    removeTrustedDomain,
    setEnabled
} = require('../../../storage/trustedDomainStore');

const router = express.Router();

router.get('/admin/trusted-domains', requireAdminAuth, (req, res) => {
    res.json(listTrustedDomains());
});

router.post('/admin/trusted-domains', requireAdminAuth, (req, res) => {
    const { domain, category, note } = req.body || {};
    try {
        const out = addTrustedDomain({ domain, category, note, addedBy: 'admin' });
        res.json(out);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.post('/admin/trusted-domains/bulk', requireAdminAuth, (req, res) => {
    const { domains, category } = req.body || {};
    if (!Array.isArray(domains) || !domains.length) {
        return res.status(400).json({ error: 'domains[] zorunludur' });
    }
    const out = addTrustedDomainsBulk(domains, { category, addedBy: 'admin' });
    res.json(out);
});

router.delete('/admin/trusted-domains/:domain', requireAdminAuth, (req, res) => {
    const out = removeTrustedDomain(decodeURIComponent(req.params.domain));
    res.json(out);
});

router.patch('/admin/trusted-domains/:domain/toggle', requireAdminAuth, (req, res) => {
    setEnabled(decodeURIComponent(req.params.domain), req.body?.enabled !== false);
    res.json({ success: true });
});

module.exports = router;
