// ============================================================
// USE-CASE: IMAP üzerinden tek mesajın manuel taranması (/imap/scan)
// ============================================================
const { fetchAndParseEmail } = require('../../imap/scanner');
const { analyzeParsedEmailData } = require('./AnalyzeMessageService');
const { sendEnterpriseRiskAlert } = require('../../services/reportService');

/**
 * Bir IMAP hesabından belirtilen UID'li mesajı çeker, analiz eder ve
 * (Enterprise lisanslarda) hesap sahibine risk uyarısı gönderir.
 *
 * @returns {Promise<{ ok: true, result: object } | { ok: false, status: number, body: object }>}
 */
async function runManualImapScan({ account, uid, folder, license }) {
    const parsed = await fetchAndParseEmail(account, uid, folder);
    if (!parsed.success) {
        return { ok: false, status: 400, body: parsed };
    }

    const result = await analyzeParsedEmailData({
        parsedData: parsed.data,
        license,
        scanSource: 'imap-manual',
        account: account.email
    });

    const riskAlert = await sendEnterpriseRiskAlert({
        result, license, to: account.email, reason: 'manual-imap-scan'
    });
    if (riskAlert) result.riskAlert = riskAlert;
    return { ok: true, result };
}

module.exports = { runManualImapScan };
