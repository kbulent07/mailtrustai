// ============================================================
// USE-CASE: WebSocket "stop-monitor" mesajı için orchestration
// ============================================================
const { removeAutoMonitor } = require('../../storage/autoMonitorState');

/**
 * @param {object} args
 * @param {string} args.email
 * @param {Map<string, any>} args.monitors  - WS layer'daki email→monitor map'i
 */
async function stopAutoMonitor({ email, monitors }) {
    if (!email) return;
    const monitor = monitors.get(email);
    if (monitor) {
        await monitor.stop();
        monitors.delete(email);
    }
    removeAutoMonitor(email);
}

module.exports = { stopAutoMonitor };
