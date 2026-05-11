// ============================================================
// USE-CASE: Yuklenen e-posta veya tek dosya eki analizi
// Ortak analiz motorunu upload akisina baglar.
// ============================================================
const {
    analyzeParsedEmailData,
    analyzeStandaloneAttachmentFile
} = require('./AnalyzeMessageService');

async function analyzeParsedEmail(parsedData, license, scanSource = 'upload') {
    return analyzeParsedEmailData({ parsedData, license, scanSource });
}

async function analyzeStandaloneAttachment(file, license) {
    return analyzeStandaloneAttachmentFile({ file, license, scanSource: 'upload' });
}

module.exports = {
    analyzeParsedEmail,
    analyzeStandaloneAttachment
};
