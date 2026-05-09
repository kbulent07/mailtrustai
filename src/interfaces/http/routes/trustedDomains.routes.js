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
    importTrustedDomains,
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

// ─── Export ───────────────────────────────────────────────
router.get('/admin/trusted-domains/export', requireAdminAuth, (req, res) => {
    const domains = listTrustedDomains();
    const payload = {
        version:    1,
        exportedAt: new Date().toISOString(),
        source:     'keygen',
        count:      domains.length,
        domains:    domains.map(d => ({
            domain:   d.domain,
            category: d.category,
            note:     d.note || '',
            enabled:  d.enabled
        }))
    };
    const filename = `mailtrustai-trusted-domains-${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
});

// ─── Import ───────────────────────────────────────────────
router.post('/admin/trusted-domains/import', requireAdminAuth, (req, res) => {
    const { domains, merge = true } = req.body || {};
    if (!Array.isArray(domains) || !domains.length) {
        return res.status(400).json({ error: 'domains[] zorunludur' });
    }
    try {
        const result = importTrustedDomains(domains, { addedBy: 'import', merge });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ──────────────────────────────────────────────────────────
// KULLANICI YETKİSİYLE ERİŞİLEBİLEN ROUTE'LAR
// (Admin token veya müşteri token yeterli — ek requireAdminAuth yok)
// ──────────────────────────────────────────────────────────

// Kullanıcı: liste dışa aktar
router.get('/trusted-domains/export', (req, res) => {
    const domains = listTrustedDomains();
    const payload = {
        version:    1,
        exportedAt: new Date().toISOString(),
        source:     'user',
        count:      domains.length,
        domains:    domains.map(d => ({
            domain:   d.domain,
            category: d.category,
            note:     d.note || '',
            enabled:  d.enabled
        }))
    };
    const filename = `mailtrustai-trusted-domains-backup-${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
});

// Kullanıcı: içe aktar (merge=true varsayılan — kullanıcı domainleri silinmez)
router.post('/trusted-domains/import', (req, res) => {
    const { domains, merge = true } = req.body || {};
    if (!Array.isArray(domains) || !domains.length) {
        return res.status(400).json({ error: 'domains[] zorunludur' });
    }
    try {
        const result = importTrustedDomains(domains, { addedBy: 'user-import', merge });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;
