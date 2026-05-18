// ============================================================
// HTTP routes: sağlık kontrolü (auth gerektirmez — Docker/k8s probe için)
// ============================================================
const express = require('express');
const router  = express.Router();

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        version: require('../../../../package.json').version,
        timestamp: new Date().toISOString()
    });
});

// /api/system/status — UI servis durumu karti icin.
// Auth gerektirmez (hassas bilgi yok, healthcheck katmaninda).
// RAM/uptime/Node/Platform.
function _formatUptime(s) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}g ${h}sa ${m}dk`;
    if (h > 0) return `${h}sa ${m}dk`;
    return `${m}dk`;
}

router.get('/system/status', (req, res) => {
    const mem = process.memoryUsage();
    const upSec = Math.floor(process.uptime());
    res.json({
        status:       'ok',
        uptimeSec:    upSec,
        uptimeLabel:  _formatUptime(upSec),
        startedAt:    new Date(Date.now() - upSec * 1000).toISOString(),
        memoryMB:     Math.round(mem.rss / 1024 / 1024),
        heapMB:       Math.round(mem.heapUsed / 1024 / 1024),
        nodeVersion:  process.version,
        platform:     `${process.platform} (${process.arch})`,
        version:      require('../../../../package.json').version
    });
});

module.exports = router;
