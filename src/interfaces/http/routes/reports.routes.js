// ============================================================
// HTTP routes: periyodik raporlar (settings + send + preview)
// ============================================================
const express = require('express');

const { loadSettings, saveSettings } = require('../../../storage/settingsStore');
const { loadScanHistory } = require('../../../storage/scanHistory');
const { normalizeReportRecipients, normalizePeriodicReportSettings } =
    require('../../../services/reportService');
const { sendPeriodicReport } =
    require('../../../application/reports/SendPeriodicReportService');
const { PERIODS, resolveRange, filterRowsForReport, summarizeRows } =
    require('../../../smtp/periodicReportBuilder');
const { recordAudit } = require('../../../storage/auditLog');

const router = express.Router();

router.get('/reports/settings', (req, res) => {
    res.json(normalizePeriodicReportSettings(loadSettings().periodicReports));
});

router.post('/reports/settings', (req, res) => {
    const current   = loadSettings();
    const existing  = normalizePeriodicReportSettings(current.periodicReports);
    const recipients = req.body.recipients !== undefined
        ? normalizeReportRecipients(req.body.recipients)
        : existing.recipients;
    const enabledRecipients = req.body.enabledRecipients !== undefined
        ? normalizeReportRecipients(req.body.enabledRecipients).filter(e => recipients.includes(e))
        : existing.enabledRecipients.filter(e => recipients.includes(e));
    const next = {
        ...existing, recipients, enabledRecipients,
        daily:    req.body.daily   !== false && req.body.daily   !== 'false',
        weekly:   req.body.weekly  !== false && req.body.weekly  !== 'false',
        monthly:  req.body.monthly !== false && req.body.monthly !== 'false',
        lastSent: existing.lastSent || {}
    };
    saveSettings({ ...current, periodicReports: next });
    recordAudit({
        req,
        actorType: 'customer',
        actorId: 'settings',
        action: 'reports.settings.update',
        details: { daily: next.daily, weekly: next.weekly, monthly: next.monthly, recipientCount: next.recipients.length }
    });
    res.json({ success: true, settings: next });
});

router.post('/reports/send', async (req, res) => {
    const period = String(req.body.period || 'daily');
    if (!PERIODS[period]) return res.status(400).json({ error: 'Invalid report period' });

    const out = await sendPeriodicReport(req.body);
    res.status(out.status).json(out.body);
});

router.get('/reports/preview/:period', (req, res) => {
    const period = String(req.params.period || 'daily');
    if (!PERIODS[period]) return res.status(400).json({ error: 'Invalid report period' });
    const targetMailbox = String(req.query.targetEmail || '').trim();
    const history = loadScanHistory();
    const range   = resolveRange(period);
    const rows    = filterRowsForReport(history, range.start, range.end, targetMailbox);
    res.json({
        period, targetMailbox,
        range: { start: range.start.toISOString(), end: range.end.toISOString() },
        stats: summarizeRows(rows), count: rows.length
    });
});

module.exports = router;
