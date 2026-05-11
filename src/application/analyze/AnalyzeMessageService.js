// ============================================================
// ORTAK MAIL TARAMA MOTORU
// Upload, manuel IMAP ve scan-mailbox akislari ayni analiz servisini kullanir.
// ============================================================
const {
    buildEmailAnalysisResult,
    buildAttachmentOnlyResult,
    applyVirusTotalInsights
} = require('../../analysis/emailAnalyzer');
const { analyzeAttachments } = require('../../analysis/attachmentAnalyzer');
const { scanAttachments: vtScan } = require('../../integrations/virustotal');
const { recordScan } = require('../../storage/scanHistory');
const { state, incrementScanCounts } = require('../../services/appState');

function finalizeAnalysisResult(result, {
    license = {},
    scanSource = 'upload',
    account = '',
    extraFields = {},
    persist = true,
    incrementCounts = true
} = {}) {
    result.scanSource = scanSource;
    result.licenseKey = license.licenseKey || '';
    if (account) result.account = account;
    Object.assign(result, extraFields || {});

    if (persist) {
        state.scanHistory = recordScan(result);
    }
    if (incrementCounts) {
        incrementScanCounts(license);
    }
    return result;
}

async function analyzeParsedEmailData({
    parsedData,
    license = {},
    scanSource = 'upload',
    account = '',
    extraFields = {},
    persist = true,
    incrementCounts = true
}) {
    const result = await buildEmailAnalysisResult(parsedData, license);
    return finalizeAnalysisResult(result, {
        license,
        scanSource,
        account,
        extraFields,
        persist,
        incrementCounts
    });
}

async function analyzeStandaloneAttachmentFile({
    file,
    license = {},
    scanSource = 'upload',
    persist = true,
    incrementCounts = true
}) {
    const att = {
        filename: file.filename,
        contentType: file.mimetype,
        size: file.size,
        content: file.buffer
    };
    const attachmentResult = analyzeAttachments([att]);
    const result = buildAttachmentOnlyResult(att, attachmentResult);

    const vtCandidates = (attachmentResult.results || []).filter((item) => item.vtEligible !== false);
    if (state.vtApiKey && vtCandidates.length) {
        result.virusTotal = await vtScan(vtCandidates.map((item) => ({
            ...item,
            content: file.buffer,
            contentType: file.mimetype,
            filename: file.filename
        })), state.vtApiKey);
        result.vtStatus.checked = true;
        result.vtStatus.reason = 'completed';
        applyVirusTotalInsights(result, result.virusTotal);
    } else if (attachmentResult.results?.some((item) => item.vtEligible === false)) {
        result.vtStatus.checked = false;
        result.vtStatus.reason = 'image-local-scan';
    } else if (attachmentResult.results?.length > 0) {
        result.findings.push({
            severity: 'warning',
            category: 'virusTotal',
            message: 'Virüs tarama API anahtarı tanımlı değil. Yalnızca yerel ek kontrolleri çalıştırıldı.'
        });
    }

    return finalizeAnalysisResult(result, {
        license,
        scanSource,
        persist,
        incrementCounts
    });
}

module.exports = {
    analyzeParsedEmailData,
    analyzeStandaloneAttachmentFile,
    finalizeAnalysisResult
};
