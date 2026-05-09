// ============================================================
// HTTP routes: tehdit istihbaratı feed istatistik & yenileme
// ============================================================
const express = require('express');

const { getThreatIntelStats, refreshFeed: refreshThreatIntel } =
    require('../../../integrations/threatIntel');
const { requireAdminAuth } = require('../../../middleware/adminAuth');

const router = express.Router();

router.get('/threat-intel/stats', (req, res) => res.json(getThreatIntelStats()));

router.post('/threat-intel/refresh', requireAdminAuth, async (req, res) => {
    try {
        await refreshThreatIntel();
        res.json({ success: true, stats: getThreatIntelStats() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
