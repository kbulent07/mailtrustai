// ============================================================
// RAPOR SERVİSİ — periyodik raporlar, enterprise uyarıları,
// zamanlama mantığı ve SMTP yapılandırması
// ============================================================
const { loadScanHistory } = require('../storage/scanHistory');
const { loadSettings, saveSettings } = require('../storage/settingsStore');
const { loadCredentials } = require('../imap/connection');
const { sendReportEmail } = require('../smtp/sender');
const { buildReportHtml, isRisky } = require('../smtp/reportBuilder');
const { PERIODS, buildPeriodicReportHtml, filterRowsForReport, resolveRange, summarizeRows } = require('../smtp/periodicReportBuilder');

let periodicReportInFlight = false;

// ─── YARDIMCI NORMALIZASYON ───────────────────────────────
function normalizeReportRecipients(value) {
    const raw = Array.isArray(value) ? value.join(',') : String(value || '');
    return [...new Set(raw
        .split(/[\s,;]+/)
        .map(item => item.trim())
        .filter(item => item && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
    )];
}

function normalizePeriodicReportSettings(settings = {}) {
    const recipients = normalizeReportRecipients(settings.recipients || []);
    const explicitEnabled = settings.enabledRecipients !== undefined;
    const enabledRecipients = explicitEnabled
        ? normalizeReportRecipients(settings.enabledRecipients).filter(e => recipients.includes(e))
        : recipients;
    return {
        recipients,
        enabledRecipients,
        daily:    settings.daily   !== false,
        weekly:   settings.weekly  !== false,
        monthly:  settings.monthly !== false,
        lastSent: settings.lastSent || {}
    };
}

function getAutoSummaryReportRecipients() {
    return loadCredentials()
        .filter(a => a.autoSummaryReport === true)
        .map(a => a.email)
        .filter(Boolean);
}

// ─── SMTP YAPILANDIRMASI ──────────────────────────────────
function getReportingSmtpConfig() {
    const settings = loadSettings();
    const mailbox  = (settings.scanMailboxes || []).find(item => item.enabled !== false && item.imapEmail);
    if (!mailbox) return null;

    const imapAccounts  = loadCredentials();
    const senderEmail   = mailbox.senderSmtpEmail || mailbox.imapEmail;
    const senderAccount = imapAccounts.find(a => a.email === senderEmail);
    if (!senderAccount) return null;

    const smtpHost = senderAccount.smtpHost || senderAccount.host || '';
    const smtpPort = Number(senderAccount.smtpPort) || 587;
    return {
        ...mailbox,
        smtpHost,
        smtpPort,
        smtpUser:                 senderAccount.email,
        smtpPassword:             senderAccount.password || '',
        smtpSecure:               smtpPort === 465,
        smtpRejectUnauthorized:   senderAccount.rejectUnauthorized !== false
    };
}

// ─── ENTERPRISE RİSK UYARISI ─────────────────────────────
async function sendEnterpriseRiskAlert({ result, license, to, reason }) {
    if (license.plan !== 'enterprise') return null;
    if (!to || !isRisky(result)) return null;

    const smtpConfig = getReportingSmtpConfig();
    if (!smtpConfig) {
        return { sent: false, reason, error: 'No enabled scan mailbox SMTP configuration found' };
    }

    const riskIcon = { high: '🔴', medium: '🟠', low: '🟡', safe: '🟢' }[result.level] || '⚠️';
    const subject  = `${riskIcon} [CW-Enerji Mail Guvenlik Raporu] ${result.labelTR || 'Riskli'} - ${result.emailMeta?.subject || '(Konu yok)'}`;
    const fromName = smtpConfig.smtpFromName || 'MailTrustAI';
    const from     = `"${fromName}" <${smtpConfig.smtpUser}>`;
    const htmlBody = buildReportHtml(result, smtpConfig.reportLang || 'tr');

    const sendResult = await sendReportEmail({ smtpConfig, to, from, subject, htmlBody });
    return {
        sent: sendResult.success,
        reason,
        to,
        ...(sendResult.success ? { messageId: sendResult.messageId } : { error: sendResult.error })
    };
}

// ─── PERİYODİK ÖZET RAPORU ───────────────────────────────
async function sendPeriodicSummaryReport({ period, recipients, targetMailbox = '', reason }) {
    const normalizedRecipients = normalizeReportRecipients(recipients);
    if (!normalizedRecipients.length) {
        return { success: false, error: 'No report recipients configured' };
    }

    const smtpConfig = getReportingSmtpConfig();
    if (!smtpConfig) {
        return { success: false, error: 'No enabled scan mailbox SMTP configuration found' };
    }

    const history     = loadScanHistory();
    const range       = resolveRange(period);
    const rows        = filterRowsForReport(history, range.start, range.end, targetMailbox);
    const stats       = summarizeRows(rows);
    const periodLabel = PERIODS[period]?.label || period;
    const fromName    = smtpConfig.smtpFromName || 'MailTrustAI';
    const from        = `"${fromName}" <${smtpConfig.smtpUser}>`;
    const subjectTarget = targetMailbox ? ` - ${targetMailbox}` : '';
    const riskRatio   = stats.total > 0 ? stats.risky / stats.total : 0;
    const summaryIcon = riskRatio >= 0.3 ? '🔴' : riskRatio >= 0.1 ? '🟠' : stats.risky > 0 ? '🟡' : '🟢';
    const subject     = `${summaryIcon} [CW-Enerji Mail Tarama Ozeti] ${periodLabel}${subjectTarget} - ${new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}`;
    const htmlBody    = buildPeriodicReportHtml({ period, history, generatedAt: new Date(), targetMailbox });

    const sendResult = await sendReportEmail({ smtpConfig, to: normalizedRecipients, from, subject, htmlBody });
    return {
        success: sendResult.success,
        reason,
        period,
        recipients: normalizedRecipients,
        targetMailbox,
        stats,
        range: { start: range.start.toISOString(), end: range.end.toISOString() },
        ...(sendResult.success ? { messageId: sendResult.messageId } : { error: sendResult.error })
    };
}

// ─── ZAMANLAMA ────────────────────────────────────────────
function getIsoWeekNumber(date) {
    const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function getIstanbulDateParts(date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
        hour12: false, weekday: 'short'
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    const hour = Number(parts.hour), minute = Number(parts.minute);
    const isoDay = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[parts.weekday] || 1;
    return {
        year, month, day, hour, minute, isoDay,
        week:    getIsoWeekNumber(new Date(Date.UTC(year, month - 1, day))),
        dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    };
}

function getScheduleDue(period, now) {
    const parts = getIstanbulDateParts(now);
    if (period === 'daily') {
        return { due: parts.hour >= 9, key: parts.dateKey };
    }
    if (period === 'weekly') {
        const pastMonday    = parts.isoDay > 1;
        const mondayMorning = parts.isoDay === 1 && (parts.hour > 9 || (parts.hour === 9 && parts.minute >= 10));
        return { due: pastMonday || mondayMorning, key: `${parts.year}-W${parts.week}` };
    }
    return {
        due: parts.day >= 1 && (parts.day > 1 || parts.hour > 9 || (parts.hour === 9 && parts.minute >= 20)),
        key: `${parts.year}-${String(parts.month).padStart(2, '0')}`
    };
}

async function runScheduledPeriodicReports() {
    if (periodicReportInFlight) return;
    periodicReportInFlight = true;

    try {
        const settings       = loadSettings();
        const reportSettings = normalizePeriodicReportSettings(settings.periodicReports);
        const recipients     = getAutoSummaryReportRecipients();
        if (!recipients.length) return;

        for (const period of Object.keys(PERIODS)) {
            if (period === 'yearly') continue;
            if (!reportSettings[period]) continue;

            const due = getScheduleDue(period, new Date());
            if (!due.due || reportSettings.lastSent?.[period] === due.key) continue;

            const results = [];
            for (const recipient of recipients) {
                results.push(await sendPeriodicSummaryReport({
                    period, recipients: [recipient], targetMailbox: recipient, reason: 'scheduled'
                }));
            }

            if (results.some(r => r.success)) {
                const latest       = loadSettings();
                const latestReport = normalizePeriodicReportSettings(latest.periodicReports);
                latestReport.lastSent = { ...(latestReport.lastSent || {}), [period]: due.key };
                saveSettings({ ...latest, periodicReports: latestReport });
                console.log(`[PeriodicReport] ${period} reports processed for ${recipients.join(', ')}`);
            } else {
                console.error(`[PeriodicReport] ${period} reports failed`);
            }
        }
    } finally {
        periodicReportInFlight = false;
    }
}

module.exports = {
    normalizeReportRecipients,
    normalizePeriodicReportSettings,
    getAutoSummaryReportRecipients,
    getReportingSmtpConfig,
    sendEnterpriseRiskAlert,
    sendPeriodicSummaryReport,
    runScheduledPeriodicReports,
    getScheduleDue
};
