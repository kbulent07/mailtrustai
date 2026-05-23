// ============================================================
// ORTAK MAIL TARAMA MOTORU
// Upload, manuel IMAP ve scan-mailbox akislari ayni analiz servisini kullanir.
//
// PERFORMANS / MALİ KORUMA (B4 fix):
//   In-flight request coalescing: aynı Message-ID iki paralel monitör
//   tarafından (scanMailboxMonitor + websocket.js) eş zamanlı analiz edilirse,
//   yalnız BİR kez AI/VT çağrısı yapılır. İkinci çağrı aynı sonucu paylaşır.
//   AI/VT quota tasarrufu: ~50% (her iki monitör çalışırken).
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

// ─── In-flight + kısa-ömürlü cache ──────────────────────────────────────────
// Key: `${account}::${messageId}` — account scope ile farklı kutular çakışmaz.
// Value: Promise<result> (çözülmüş veya devam eden).
// TTL: 5 dk — iki monitörün aynı maili kısa süre içinde işleme şansı.
const _analysisInflight = new Map();
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;

function _cacheKey(account, messageId) {
    if (!messageId) return null;
    return `${account || '_'}::${String(messageId)}`;
}

/**
 * Result objesini güvenli derin klonla — sonucu paylaşan çağrıların birbirinin
 * scanSource/account/extraFields mutasyonlarını görmesini engeller.
 */
function _cloneResult(result) {
    try {
        // structuredClone Node 17+ — fallback JSON
        return typeof structuredClone === 'function' ? structuredClone(result) : JSON.parse(JSON.stringify(result));
    } catch (_) {
        return JSON.parse(JSON.stringify(result));
    }
}

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
    // B4 fix: in-flight cache — paralel monitörler tek analizi paylaşır.
    // Only Message-ID varsa cache anahtarı oluşturulur (upload akışında yok).
    const key = _cacheKey(account, parsedData?.messageId);
    if (key) {
        const inflight = _analysisInflight.get(key);
        if (inflight) {
            // Başka çağrı zaten çalışıyor (veya yakın zamanda bitmiş) — bekle, paylaş.
            // NOT: result'ı klonla ki bu çağrının extraFields/scanSource'u önceki
            // result'a yansımasın.
            try {
                const shared = await inflight;
                const cloned = _cloneResult(shared);
                return finalizeAnalysisResult(cloned, {
                    license, scanSource, account, extraFields, persist, incrementCounts
                });
            } catch (_) {
                // Önceki promise fail ettiyse: cache'i temizle ve yeniden dene.
                _analysisInflight.delete(key);
            }
        }
    }

    // Cache miss → asıl analizi tetikle
    const computePromise = buildEmailAnalysisResult(parsedData, license);
    if (key) {
        _analysisInflight.set(key, computePromise);
        // TTL sonrası cache'i temizle (memory koruması)
        const t = setTimeout(() => _analysisInflight.delete(key), ANALYSIS_CACHE_TTL_MS);
        if (typeof t.unref === 'function') t.unref();
    }

    let result;
    try {
        result = await computePromise;
    } catch (err) {
        // Cache'i hemen temizle — bir sonraki çağrı taze deneme yapabilsin
        if (key) _analysisInflight.delete(key);
        throw err;
    }

    return finalizeAnalysisResult(result, {
        license, scanSource, account, extraFields, persist, incrementCounts
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
