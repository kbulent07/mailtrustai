// ============================================================
// HTTP routes: False Positive (FP) suggestion akışı
//   • POST /api/fp-suggestions          — kullanıcı tarama raporundan işaretler (license)
//   • GET  /api/admin/fp-suggestions    — bekleyen öneriler (admin)
//   • POST /api/admin/fp-suggestions/:domain/approve — trusted'a ekle (admin)
//   • POST /api/admin/fp-suggestions/:domain/reject  — reddet (admin)
// ============================================================
const express = require('express');
const { requireAdminAuth, verifyAdminToken } = require('../../../middleware/adminAuth');
const { checkLicense } = require('../../../services/appState');
const {
    addSuggestion, listPending, listAll, approve, reject, deleteSuggestion
} = require('../../../storage/fpSuggestionStore');

const router = express.Router();

// Kullanıcı tarafı: lisanslı her kullanıcı kendi taramasından FP raporlayabilir
// Admin Bearer token ile de çağrılabilir (istatistikler panelinden)
router.post('/fp-suggestions', (req, res) => {
    // Admin oturumu kontrolü — Bearer token varsa lisans zorunluluğunu atla
    const auth = req.headers['authorization'] || '';
    const isAdmin = auth.startsWith('Bearer ') && !!verifyAdminToken(auth.slice(7).trim());

    const license = checkLicense(req);
    if (!isAdmin && (!license || !license.valid)) {
        return res.status(401).json({ error: 'Lisans gerekli' });
    }

    const { domain, scanId, category, severity, message } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'domain zorunludur' });

    try {
        const out = addSuggestion({
            domain,
            scanId:   scanId || null,
            category: category || '',
            severity: severity || '',
            message:  message  || '',
            reporter: isAdmin ? 'admin' : (license.licenseKey || '').slice(0, 32)
        });
        res.json(out);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Admin tarafı
router.get('/admin/fp-suggestions', requireAdminAuth, (req, res) => {
    const all = req.query.all === '1';
    res.json(all ? listAll() : listPending());
});

router.post('/admin/fp-suggestions/:domain/approve', requireAdminAuth, (req, res) => {
    const { category, note } = req.body || {};
    const out = approve(decodeURIComponent(req.params.domain), { category, note });
    if (!out.ok) return res.status(404).json(out);
    res.json(out);
});

router.post('/admin/fp-suggestions/:domain/reject', requireAdminAuth, (req, res) => {
    res.json(reject(decodeURIComponent(req.params.domain)));
});

router.delete('/admin/fp-suggestions/:domain', requireAdminAuth, (req, res) => {
    const status = req.query.status || 'pending';
    res.json(deleteSuggestion(decodeURIComponent(req.params.domain), status));
});

module.exports = router;
