// ============================================================
// USE-CASE: Tarama posta kutusunu sil (monitör + ayar)
// ============================================================
const { loadSettings, saveSettings } = require('../../storage/settingsStore');
const { stopScanMailboxMonitor } = require('../../services/scanMailboxService');

async function deleteScanMailbox(imapEmail) {
    // Monitor'ü durdur + supervisor retry timer'ını iptal et
    stopScanMailboxMonitor(imapEmail);

    const current = loadSettings();
    saveSettings({
        ...current,
        scanMailboxes: (current.scanMailboxes || []).filter(s => s.imapEmail !== imapEmail)
    });
    return { success: true };
}

module.exports = { deleteScanMailbox };
