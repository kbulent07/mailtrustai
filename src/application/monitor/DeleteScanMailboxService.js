// ============================================================
// USE-CASE: Tarama posta kutusunu sil (monitör + ayar)
// ============================================================
const { loadSettings, saveSettings } = require('../../storage/settingsStore');
const { scanMailboxMonitors } = require('../../services/scanMailboxService');

async function deleteScanMailbox(imapEmail) {
    const monitor = scanMailboxMonitors.get(imapEmail);
    if (monitor) {
        await monitor.stop();
        scanMailboxMonitors.delete(imapEmail);
    }

    const current = loadSettings();
    saveSettings({
        ...current,
        scanMailboxes: (current.scanMailboxes || []).filter(s => s.imapEmail !== imapEmail)
    });
    return { success: true };
}

module.exports = { deleteScanMailbox };
