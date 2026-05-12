// ============================================================
// HTTP routes: IMAP hesabı yönetimi ve manuel inbox tarama
// ============================================================
const express = require('express');

const { testConnection, addAccount, removeAccount, updateAccount, loadCredentials } =
    require('../../../imap/connection');
const { listEmails }              = require('../../../imap/scanner');
const { testSmtpConnection }      = require('../../../smtp/sender');
const { runManualImapScan }       =
    require('../../../application/analyze/AnalyzeImapMailService');
const { checkLicense, checkDailyLimit, checkMonthlyLimit } =
    require('../../../services/appState');

const router = express.Router();

router.post('/imap/test', async (req, res) => {
    res.json(await testConnection(req.body));
});

router.post('/imap/accounts', async (req, res) => {
    if (!req.body?.email || !req.body?.host)
        return res.status(400).json({ error: 'Email and host are required' });

    const existing = loadCredentials().find(a => a.email === req.body.email);
    const requestedPassword = req.body?.password;
    const keepExistingPassword = requestedPassword === '__KEEP_EXISTING_PASSWORD__';
    const password = (!requestedPassword || keepExistingPassword) ? existing?.password : requestedPassword;
    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }

    const accounts = addAccount({
        ...req.body,
        password,
        autoSummaryReport: req.body.autoSummaryReport === true || req.body.autoSummaryReport === 'true'
    });
    res.json({ success: true, count: accounts.length });
});

router.delete('/imap/accounts/:email', (req, res) => {
    res.json({ success: true, count: removeAccount(req.params.email).length });
});

router.get('/imap/accounts', (req, res) => {
    res.json(loadCredentials().map(a => ({
        email: a.email, host: a.host, port: a.port,
        autoSummaryReport: a.autoSummaryReport === true,
        rejectUnauthorized: a.rejectUnauthorized !== false,
        moveHighRiskToQuarantine: a.moveHighRiskToQuarantine === true
    })));
});

router.patch('/imap/accounts/:email/report', (req, res) => {
    const email   = decodeURIComponent(req.params.email);
    const updated = updateAccount(email, { autoSummaryReport: req.body.enabled === true || req.body.enabled === 'true' });
    if (!updated) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, email, autoSummaryReport: updated.autoSummaryReport === true });
});

router.post('/imap/list', async (req, res) => {
    const license = checkLicense(req);
    if (!license.features?.imapConnection)
        return res.status(403).json({ error: 'IMAP tarama Enterprise lisansı gerektirir' });

    const { email, folder, limit } = req.body;
    const account = loadCredentials().find(a => a.email === email);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const result = await listEmails(account, folder, limit);
    res.status(result.success ? 200 : 400).json(result);
});

router.post('/imap/scan', async (req, res) => {
    const license = checkLicense(req);
    if (!license.features?.inboxScan)   return res.status(403).json({ error: 'Inbox tarama Enterprise lisansı gerektirir' });
    if (!checkDailyLimit(license))      return res.status(429).json({ error: 'Daily scan limit reached' });
    if (!checkMonthlyLimit(license))    return res.status(429).json({ error: 'Monthly scan limit reached' });

    const { email, uid, folder } = req.body;
    const account = loadCredentials().find(a => a.email === email);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const out = await runManualImapScan({ account, uid, folder, license });
    if (!out.ok) return res.status(out.status).json(out.body);
    res.json(out.result);
});

router.post('/smtp/test', async (req, res) => {
    res.json(await testSmtpConnection(req.body));
});

module.exports = router;
