// ============================================================
// HTTP routes: reseller'lar (admin yönetir)
// ============================================================
const express = require('express');

const { loadResellers, addReseller, removeReseller } =
    require('../../../storage/resellerStore');
const { requireAdminAuth } = require('../../../middleware/adminAuth');

const router = express.Router();

router.get('/resellers',    requireAdminAuth, (req, res) => res.json(loadResellers()));
router.post('/resellers',   requireAdminAuth, (req, res) => res.json(addReseller(req.body)));
router.delete('/resellers/:id', requireAdminAuth, (req, res) => {
    removeReseller(req.params.id);
    res.json({ success: true });
});

module.exports = router;
