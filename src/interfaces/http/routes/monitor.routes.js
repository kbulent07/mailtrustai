// ============================================================
// HTTP routes: scan-mailboxes (merkezi raporlama) + auto-monitor listesi
// ============================================================
const express = require('express');

const { loadSettings }            = require('../../../storage/settingsStore');
const { loadCredentials }         = require('../../../imap/connection');
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
    if (!imapEmail)    return res.status(400).json({ error: 'E-posta adresi zorunludur.' });
    if (!imapHost)     return res.status(400).json({ error: 'IMAP sunucu adresi zorunludur.' });

    // Şifre boşsa fallback sırası:
    //   1) Zaten scan-mailbox kaydı varsa, oradaki encrypted şifreyi yeniden kullan.
    //   2) Yoksa IMAP hesapları store'unda kayıtlı (decrypted) şifreyi al — kullanıcı zaten panele
    //      şifreyle girdi, ayar değişikliği için tekrar girmesine gerek yok.
    //   3) Hiçbiri yoksa hâlâ zorunlu (yeni IMAP hesabı + ilk kez aktivasyon).
    if (!imapPassword) {
        const settings = loadSettings();
        const existingScan = (settings.scanMailboxes || []).find(s => s.imapEmail === imapEmail);
        if (existingScan && existingScan.imapPassword) {
            req.body._existingEncryptedImapPassword = existingScan.imapPassword;
        } else {
            const imapAccount = loadCredentials().find(a => a.email === imapEmail);
            if (imapAccount && imapAccount.password) {
                req.body.imapPassword = imapAccount.password;
            } else {
                return res.status(400).json({ error: 'IMAP şifresi zorunludur.' });
            }
        }
    }

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
