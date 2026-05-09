// ============================================================
// USE-CASE: IMAP üzerinden tek mesajın manuel taranması (/imap/scan)
// ============================================================
const { fetchAndParseEmail } = require('../../imap/scanner');
const { buildEmailAnalysisResult } = require('../../analysis/emailAnalyzer');
const { sendEnterpriseRiskAlert } = require('../../services/reportService');
const { recordScan } = require('../../storage/scanHistory');
const { state, incrementScanCounts } = require('../../services/appState');

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

    const result = await buildEmailAnalysisResult(parsed.data, license);
    result.scanSource = 'imap-manual';
    result.licenseKey = license.licenseKey || '';
    result.account    = account.email;

    const riskAlert = await sendEnterpriseRiskAlert({
        result, license, to: account.email, reason: 'manual-imap-scan'
    });
    if (riskAlert) result.riskAlert = riskAlert;

    state.scanHistory = recordScan(result);
    incrementScanCounts();
    return { ok: true, result };
}

module.exports = { runManualImapScan };
