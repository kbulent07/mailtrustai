// ============================================================
// USE-CASE: Periyodik özet raporunu manuel olarak gönder
// (POST /api/reports/send)
//
// Mevcut services/reportService üzerindeki kararlı API'yi kullanır;
// yalnızca request input → service çağrısı orchestration'ını yapar.
// ============================================================
const {
    sendPeriodicSummaryReport,
    normalizeReportRecipients,
    getAutoSummaryReportRecipients
} = require('../../services/reportService');

/**
 * @param {object} input - request body
 * @returns Promise<{ status:number, body:object }>
 */
async function sendPeriodicReport(input) {
    const period        = String(input.period || 'daily');
    const targetMailbox = String(input.targetEmail || '').trim();

    const recipients = input.recipients !== undefined
        ? normalizeReportRecipients(input.recipients)
        : (targetMailbox ? [targetMailbox] : getAutoSummaryReportRecipients());

    const result = await sendPeriodicSummaryReport({
        period, recipients, targetMailbox, reason: 'manual'
    });
    return { status: result.success ? 200 : 400, body: result };
}

module.exports = { sendPeriodicReport };
