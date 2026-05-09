// ============================================================
// HTTP routes: scan-mailboxes (merkezi raporlama) + auto-monitor listesi
// ============================================================
const express = require('express');

const { loadSettings }            = require('../../../storage/settingsStore');
const { listAutoMonitors, removeAutoMonitor } =
    require('../../../storage/autoMonitorState');
const { upsertScanMailbox, patchScanMailbox } =
    require('../../../application/monitor/UpsertScanMailboxService');
const { deleteScanMailbox }       =
    require('../../../application/monitor/DeleteScanMailboxService');
const { checkLicense }            = require('../../../services/appState');

const router = express.Router();

// ─── Auto-monitor listesi ────────────────────────────────
router.get('/auto-monitors', (req, res) => {
    res.json(listAutoMonitors().map(({ email, updatedAt }) => ({ email, updatedAt: updatedAt || null })));
});

router.delete('/auto-monitors/:email', (req, res) => {
    removeAutoMonitor(decodeURIComponent(req.params.email));
    res.json({ success: true });
});

// ─── Scan mailboxes (merkezi raporlama mail hesabı) ──────
router.get('/scan-mailboxes', (req, res) => {
    const settings = loadSettings();
    res.json((settings.scanMailboxes || []).map(smb => ({
        ...smb,
        reportMode:   smb.reportMode === 'all' ? 'all' : 'risky',
        reportTo:     smb.reportTo || '',
        imapPassword: smb.imapPassword ? '****' : '',
        smtpPassword: smb.smtpPassword ? '****' : ''
    })));
});

router.post('/scan-mailboxes', async (req, res) => {
    const { imapHost, imapEmail, imapPassword } = req.body;
    if (!imapHost)     return res.status(400).json({ error: 'IMAP sunucu adresi zorunludur.' });
    if (!imapEmail)    return res.status(400).json({ error: 'E-posta adresi zorunludur.' });
    if (!imapPassword) return res.status(400).json({ error: 'IMAP şifresi zorunludur.' });

    const license = checkLicense(req);
    if (!license.features?.scanMailbox)
        return res.status(403).json({ error: 'Tarama Posta Kutusu Pro veya Enterprise lisansı gerektirir.' });

    const out = await upsertScanMailbox(req.body, license);
    if (!out.ok) return res.status(out.status).json(out.body);
    res.json(out.body);
});

router.delete('/scan-mailboxes/:email', async (req, res) => {
    const result = await deleteScanMailbox(decodeURIComponent(req.params.email));
    res.json(result);
});

router.patch('/scan-mailboxes/:email', async (req, res) => {
    const license = checkLicense(req);
    const out = await patchScanMailbox(decodeURIComponent(req.params.email), req.body, license);
    if (!out.ok) return res.status(out.status).json(out.body);
    res.json(out.body);
});

module.exports = router;
