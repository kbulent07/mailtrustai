// ============================================================
// USE-CASE: Yüklenen e-posta veya tek dosya eki analizi
//   • analyzeParsedEmail() — EML/MSG parse sonucundan analiz
//   • analyzeStandaloneAttachment() — sadece ek (non-eml/non-msg)
// Davranış route ile birebir aynıdır; route yalnızca auth/lisans/IO yapar.
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

/**
 * EML/MSG parse sonucunu (parsedData) tam analiz akışından geçirir.
 * @param {object} parsedData - parser.parseEmail / parseUploadedEmail çıktısı (.data)
 * @param {object} license - appState.checkLicense sonucu
 * @param {string} [scanSource='upload']
 */
async function analyzeParsedEmail(parsedData, license, scanSource = 'upload') {
    const result = await buildEmailAnalysisResult(parsedData, license);
    result.scanSource = scanSource;
    result.licenseKey = license.licenseKey || '';
    state.scanHistory = recordScan(result);
    incrementScanCounts();
    return result;
}

/**
 * EML/MSG olmayan tek bir ek dosyasını yerel ve (varsa) VirusTotal ile tarar.
 * @param {{ filename:string, mimetype:string, size:number, buffer:Buffer }} file
 * @param {object} license
 */
async function analyzeStandaloneAttachment(file, license) {
    const att = {
        filename:    file.filename,
        contentType: file.mimetype,
        size:        file.size,
        content:     file.buffer
    };
    const attachmentResult = analyzeAttachments([att]);
    const result = buildAttachmentOnlyResult(att, attachmentResult);
    result.scanSource = 'upload';
    result.licenseKey = license.licenseKey || '';

    const vtCandidates = (attachmentResult.results || []).filter(item => item.vtEligible !== false);
    if (state.vtApiKey && vtCandidates.length) {
        result.virusTotal = await vtScan(vtCandidates.map(item => ({
            ...item,
            content:     file.buffer,
            contentType: file.mimetype,
            filename:    file.filename
        })), state.vtApiKey);
        result.vtStatus.checked = true;
        result.vtStatus.reason  = 'completed';
        applyVirusTotalInsights(result, result.virusTotal);
    } else if (attachmentResult.results?.some(item => item.vtEligible === false)) {
        result.vtStatus.checked = false;
        result.vtStatus.reason  = 'image-local-scan';
    } else if (attachmentResult.results?.length > 0) {
        result.findings.push({
            severity: 'warning',
            category: 'virusTotal',
            message:  'Virüs tarama API anahtarı tanımlı değil. Yalnızca yerel ek kontrolleri çalıştırıldı.'
        });
    }

    state.scanHistory = recordScan(result);
    incrementScanCounts();
    return result;
}

module.exports = {
    analyzeParsedEmail,
    analyzeStandaloneAttachment
};
