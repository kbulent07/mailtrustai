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

module.exports = router;
