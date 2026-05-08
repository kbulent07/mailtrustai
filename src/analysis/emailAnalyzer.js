// ============================================================
// E-POSTA ANALİZ OLUŞTURUCU
// buildEmailAnalysisResult ve tüm yardımcı fonksiyonlar
// ============================================================
const crypto = require('crypto');

const { analyzeHeaders } = require('./headerAnalyzer');
const { analyzeContent } = require('./contentAnalyzer');
const { analyzeLinks, resolveShortUrls, applyResolvedUrlFindings, extractUrls } = require('./linkAnalyzer');
const { analyzeAttachments } = require('./attachmentAnalyzer');
const { calculateScore, resolveLevel, levelMeta } = require('./scorer');
const { scanAttachments: vtScan } = require('../integrations/virustotal');
const { analyzeWithClaude } = require('../integrations/claude');
const { analyzeWithOpenAI, OPENAI_MODEL } = require('../integrations/openai');
const { isAllowlisted, isBlocklisted } = require('../storage/allowlistStore');
const { isThreatDomain, isThreatUrl } = require('../integrations/threatIntel');
const { sendWebhook } = require('../integrations/webhook');
const { state } = require('../services/appState');

// ─── SONUÇ META YENİDEN HESAPLAMA ────────────────────────
function recalculateResultMeta(result) {
    result.level = resolveLevel(result.score, result.findings || []);
    const meta = levelMeta(result.level);
    result.color   = meta.color;
    result.labelTR = meta.labelTR;
    result.labelEN = meta.labelEN;

    result.summary = {
        critical: result.findings.filter(f => f.severity === 'critical').length,
        warning:  result.findings.filter(f => f.severity === 'warning').length,
        info:     result.findings.filter(f => f.severity === 'info').length,
        safe:     result.findings.filter(f => f.severity === 'safe').length,
        total:    result.findings.length
    };

    result.breakdown = {
        ...(result.breakdown || {}),
        ai: calculateOpenAIScoreBoost(result.openaiAnalysis || {}, result.findings || [])
    };
}

// ─── VİRÜSTOTAL BULGULARI UYGULA ─────────────────────────
function applyVirusTotalInsights(result, entries = []) {
    if (!entries.length) return;

    entries.forEach(entry => {
        if (!entry.checked) {
            result.findings.push({
                severity: 'info',
                category: 'virusTotal',
                message: `Virüs tarama sorgusu tamamlanamadı — ${entry.filename}: ${entry.error || 'bilinmeyen hata'}`
            });
            return;
        }

        if (!entry.found) {
            result.findings.push({
                severity: 'info',
                category: 'virusTotal',
                message: `Virüs tarama veritabanında henüz kayıt yok — ${entry.filename}`
            });
            return;
        }

        const malicious  = entry.stats?.malicious  || 0;
        const suspicious = entry.stats?.suspicious || 0;
        const total      = entry.stats?.total      || 0;

        if (malicious > 0) {
            result.score = Math.min(100, result.score + 20);
            result.findings.push({
                severity: 'critical',
                category: 'virusTotal',
                message: `Virüs tarama: ${entry.filename} zararlı olarak işaretlendi (${malicious}/${total} motor)`
            });
        } else if (suspicious > 0) {
            result.score = Math.min(100, result.score + 10);
            result.findings.push({
                severity: 'warning',
                category: 'virusTotal',
                message: `Virüs tarama: ${entry.filename} şüpheli olarak işaretlendi (${suspicious}/${total} motor)`
            });
        } else {
            result.findings.push({
                severity: 'safe',
                category: 'virusTotal',
                message: `Virüs tarama temiz — ${entry.filename}${total > 0 ? ` (${total} motorda tehdit tespit edilmedi)` : ''}`
            });
        }
    });

    recalculateResultMeta(result);
}

// ─── OPENAI BULGULARI UYGULA ──────────────────────────────

/**
 * AI skor katkısını statik analizle çakışma (double counting) ağırlığı
 * ile azaltır.
 *
 * Mantık: Statik analiz (header / content / link / attachment) zaten belirli
 * sinyal kategorilerini puanladıysa, AI aynı tehdidi tekrar tespit ettiğinde
 * katkısı orantılı azalır. AI yalnızca "yeni bilgi" ürettiği ölçüde puan ekler.
 *
 * Çakışma matrisi:
 *   Statik aciliyet bulgusu   + AI urgencyRisk=high        → %20 kesinti
 *   Statik kimlik harvesting  + AI credentialRisk=high     → %20 kesinti
 *   Statik BEC içerik sinyali + AI category=bec            → %20 kesinti
 *   Statik kritik link        + AI category=phishing       → %15 kesinti
 *   Statik SPF/DKIM/DMARC fail+ AI impersonationRisk=high  → %15 kesinti
 *   Statik VT zararlı bulgusu + AI category=malware_delivery→ %15 kesinti
 *
 * Minimum ağırlık: 0.35 (AI en az %35 katkısını korur — tümüyle sıfırlanmaz)
 */
function calculateAiOverlapWeight(staticFindings, analysis) {
    if (!staticFindings || !staticFindings.length) return 1.0;

    let penalty = 0;

    const has = (category, severities, msgPattern) =>
        staticFindings.some(f =>
            f.category === category &&
            (severities.includes(f.severity)) &&
            (msgPattern ? msgPattern.test(f.message || '') : true)
        );

    // Aciliyet kalıpları statik içerik analizörü tarafından zaten yakalandı
    if (has('content', ['critical', 'warning'], /aciliyet/i) && analysis.urgencyRisk === 'high') {
        penalty += 0.20;
    }
    // Kimlik / hassas veri talebi hem statik hem AI tarafından görüldü
    if (has('content', ['critical'], /kimlik|hassas\s*veri/i) && analysis.credentialRisk === 'high') {
        penalty += 0.20;
    }
    // BEC sinyali: hem header/content statik analizi hem AI
    if (
        (has('content', ['critical'], /BEC|banka.*IBAN|IBAN.*değiş/i) ||
         has('header',  ['critical', 'warning'], /BEC/i)) &&
        analysis.category === 'bec'
    ) {
        penalty += 0.20;
    }
    // Kritik link bulgusu + AI phishing tespiti
    if (has('link', ['critical'], null) && analysis.category === 'phishing') {
        penalty += 0.15;
    }
    // SPF/DKIM/DMARC başarısız + AI kimliğe bürünme riski
    if (
        has('header', ['critical'], /SPF BAŞARISIZ|DMARC BAŞARISIZ/i) &&
        analysis.impersonationRisk === 'high'
    ) {
        penalty += 0.15;
    }
    // VT zararlı bulgusu + AI malware_delivery
    if (has('virusTotal', ['critical'], null) && analysis.category === 'malware_delivery') {
        penalty += 0.15;
    }
    // Sextortion statik + AI extortion
    if (has('content', ['critical'], /sextortion|gasp|bitcoin/i) && analysis.category === 'extortion') {
        penalty += 0.20;
    }

    // Toplam kesintiyi %65 ile sınırla — AI her zaman en az %35 katkı sağlar
    const weight = Math.max(0.35, 1 - Math.min(penalty, 0.65));
    return weight;
}

function calculateOpenAIScoreBoost(analysis, staticFindings = []) {
    const baseByThreat = { safe: 0, low: 4, medium: 10, high: 18, critical: 26 };
    const base = baseByThreat[analysis.threatLevel] || 0;
    const confidenceMultiplier = Math.max(0.45, Math.min(1, (analysis.confidence || 0) / 100));
    const intentMultiplier     = Math.max(0.5,  Math.min(1.15, (analysis.maliciousIntentScore || 0) / 100));
    const rawBoost = Math.round(base * confidenceMultiplier * intentMultiplier);

    // Çakışma ağırlığını uygula
    const overlapWeight = calculateAiOverlapWeight(staticFindings, analysis);
    const finalBoost    = Math.round(rawBoost * overlapWeight);

    if (rawBoost !== finalBoost) {
        console.log(
            `[Scorer] AI puanı çakışma düzeltmesi: ${rawBoost} → ${finalBoost} ` +
            `(ağırlık: ${overlapWeight.toFixed(2)}, kategori: ${analysis.category})`
        );
    }

    return finalBoost;
}

function currentLangSummary(analysis) {
    return analysis.summaryTR || analysis.summaryEN || '';
}

function severityFromThreatLevel(threatLevel) {
    if (threatLevel === 'critical' || threatLevel === 'high') return 'critical';
    if (threatLevel === 'medium'   || threatLevel === 'low')  return 'warning';
    return 'safe';
}

function applyOpenAIInsights(result, analysis) {
    // Statik analiz bulgularını çakışma hesaplamasına ilet
    const scoreBoost = calculateOpenAIScoreBoost(analysis, result.findings || []);
    if (scoreBoost > 0) result.score = Math.min(100, result.score + scoreBoost);

    const summary  = currentLangSummary(analysis);
    const severity = severityFromThreatLevel(analysis.threatLevel);
    const confidenceText = `${analysis.confidence}% confidence`;

    result.findings.unshift({
        severity,
        category: 'ai',
        message: `AI verdict: ${analysis.category} / ${analysis.threatLevel} (${confidenceText})`
    });

    if (summary) {
        result.findings.push({
            severity: severity === 'critical' ? 'warning' : severity,
            category: 'ai',
            message: `AI summary: ${summary}`
        });
    }

    (analysis.redFlagsTR || []).slice(0, 3).forEach(flag => {
        result.findings.push({ severity, category: 'ai', message: `AI uyarı: ${flag}` });
    });

    recalculateResultMeta(result);
}

// ─── EK YARDIMCILARI ─────────────────────────────────────
function resolveAttachmentVtSkipReason(rows) {
    if (rows.some(r => r.vtSkipReason === 'imap-part-unavailable'))  return 'imap-part-unavailable';
    if (rows.some(r => r.vtSkipReason === 'quarantined-upstream'))   return 'quarantined-upstream';
    if (rows.some(r => r.vtSkipReason === 'image-local-scan'))       return 'image-local-scan';
    return 'not-eligible';
}

function buildQuarantinedAttachmentRows(quarantinedAttachments) {
    return quarantinedAttachments.map(item => ({
        filename:           item.filename,
        size:               item.size || 0,
        contentType:        item.contentType || 'application/octet-stream',
        issues:             ['gateway-quarantined-malware'],
        hash:               null,
        archiveEntries:     [],
        archiveScan:        null,
        vtEligible:         false,
        vtSkipReason:       item.vtBlockedReason || 'quarantined-upstream',
        localScanner:       'mail-gateway',
        imageAnalysis:      null,
        quarantined:        true,
        quarantineSource:   item.source    || 'mail-gateway',
        quarantineDetection:item.detection || '',
        quarantineAction:   item.action    || ''
    }));
}

// ─── ANA ANALİZ FONKSİYONU ───────────────────────────────
async function buildEmailAnalysisResult(parsedData, license) {
    const contentLevel = license.features?.contentAnalysis || 'basic';
    const linkLimit    = license.features?.linkLimit || 5;

    const headerResult     = analyzeHeaders(parsedData);
    const contentResult    = analyzeContent(parsedData, contentLevel);
    const linkResult       = analyzeLinks(parsedData, linkLimit);
    const attachmentResult = analyzeAttachments(parsedData.attachments || []);

    const result = calculateScore(headerResult, contentResult, linkResult, attachmentResult);
    result.emailMeta = {
        from:                   parsedData.from,
        to:                     parsedData.to,
        subject:                parsedData.subject,
        date:                   parsedData.date,
        attachmentCount:        parsedData.attachmentCount,
        quarantinedAttachments: parsedData.quarantinedAttachments || [],
        spf:                    parsedData.spf,
        dkim:                   parsedData.dkim,
        dmarc:                  parsedData.dmarc
    };
    result.attachmentDetails = [
        ...(attachmentResult.results || []),
        ...buildQuarantinedAttachmentRows(parsedData.quarantinedAttachments || [])
    ];
    result.vtStatus = {
        available:  !!license.features?.virusTotal,
        configured: !!state.vtApiKey,
        checked:    false,
        reason: !license.features?.virusTotal
            ? 'license-disabled'
            : (!state.vtApiKey ? 'missing-api-key' : 'ready')
    };
    result.id        = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    result.timestamp = new Date().toISOString();
    result.breakdown = {
        ...(result.breakdown || {}),
        linkCount: (linkResult.urls || []).length
    };

    // ─── VirusTotal ───────────────────────────────────────
    const vtCandidates = (attachmentResult.results || []).filter(item => item.vtEligible !== false);
    if (license.features?.virusTotal && state.vtApiKey && vtCandidates.length > 0) {
        result.virusTotal = await vtScan(vtCandidates.map(item => {
            const src = (parsedData.attachments || []).find(a => {
                const sameHash = item.hash && a.content &&
                    item.hash === crypto.createHash('sha256').update(a.content).digest('hex');
                return sameHash || a.filename === item.filename;
            });
            return { ...item, content: src?.content, contentType: src?.contentType, filename: src?.filename || item.filename };
        }), state.vtApiKey);
        result.vtStatus.checked = true;
        result.vtStatus.reason  = 'completed';
        applyVirusTotalInsights(result, result.virusTotal);
    } else if ((attachmentResult.results || []).some(item => item.vtEligible === false)) {
        result.vtStatus.checked = false;
        result.vtStatus.reason  = resolveAttachmentVtSkipReason(attachmentResult.results || []);
    } else if (attachmentResult.results?.length > 0 && license.features?.virusTotal && !state.vtApiKey) {
        result.findings.push({
            severity: 'warning',
            category: 'virusTotal',
            message: 'Virüs tarama API anahtarı tanımlı değil. Yalnızca yerel ek kontrolleri çalıştırıldı.'
        });
    }

    // ─── Allowlist / Blocklist ────────────────────────────
    const senderEmail  = (parsedData.from?.[0]?.address || '').toLowerCase();
    const senderDomain = senderEmail.split('@')[1] || '';
    if (senderEmail) {
        if (isAllowlisted(senderEmail)) {
            // Ekde virüs/şüpheli dosya varsa güvenilir listesi skoru azaltmaz —
            // tehdit gerçek, gönderen güvensiz sayılır.
            const vtMalicious  = (result.virusTotal || []).some(vt => (vt.stats?.malicious  || 0) > 0);
            const vtSuspicious = (result.virusTotal || []).some(vt => (vt.stats?.suspicious || 0) > 0);
            const hasAttachmentVirus = vtMalicious || vtSuspicious;

            if (hasAttachmentVirus) {
                // Güvenilir gönderen ama zararlı ek — uyarı ekle, skora dokunma
                result.findings.unshift({
                    severity: 'critical', category: 'header',
                    message: `Gönderen güvenilir listede (${senderEmail}) ancak ekte ${vtMalicious ? 'zararlı' : 'şüpheli'} dosya tespit edildi — güvensiz olarak işaretleniyor`
                });
                // Skoru azaltmıyoruz; mevcut yüksek skor ve seviye korunuyor
            } else {
                result.findings.unshift({
                    severity: 'safe', category: 'header',
                    message: `Gönderen güvenilir listede: ${senderEmail.includes('@') ? senderEmail : senderDomain} — güvenilir olarak işaretlenmiş`
                });
                result.score = Math.max(0, result.score - 20);
            }
            recalculateResultMeta(result);
        } else if (isBlocklisted(senderEmail)) {
            result.findings.unshift({
                severity: 'critical', category: 'header',
                message: `Gönderen engellenenler listesinde: ${senderEmail.includes('@') ? senderEmail : senderDomain} — yönetici tarafından engellenmiş`
            });
            result.score = Math.min(100, result.score + 30);
            recalculateResultMeta(result);
        }
    }

    // ─── Tehdit istihbaratı ───────────────────────────────
    const allUrls = extractUrls((parsedData.text || '') + ' ' + (parsedData.html || ''));
    let threatIntelHits = 0;
    for (const url of allUrls.slice(0, 50)) {
        if (threatIntelHits >= 3) break;
        if (isThreatUrl(url)) {
            result.findings.push({
                severity: 'critical', category: 'link',
                message: `Tehdit istihbaratı eşleşmesi (URL): ${url.length > 80 ? url.slice(0, 77) + '...' : url}`
            });
            result.score = Math.min(100, result.score + 15);
            threatIntelHits++;
            continue;
        }
        const urlDomain = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
        if (urlDomain && isThreatDomain(urlDomain)) {
            result.findings.push({
                severity: 'critical', category: 'link',
                message: `Tehdit istihbaratı eşleşmesi (domain): ${urlDomain}`
            });
            result.score = Math.min(100, result.score + 15);
            threatIntelHits++;
        }
    }

    // ─── URL kısaltıcı çözümleme (Pro+) ──────────────────
    if (license.features?.virusTotal) {
        const resolved = await resolveShortUrls(allUrls, 5);
        if (resolved.length > 0) applyResolvedUrlFindings(result.findings, resolved);
    }

    // ─── Webhook ─────────────────────────────────────────
    sendWebhook(result).catch(() => {});

    // ─── Claude AI ───────────────────────────────────────
    if (state.claudeApiKey) {
        const claudeResult = await analyzeWithClaude(
            state.claudeApiKey,
            parsedData.text || parsedData.textAsHtml || '',
            parsedData.subject
        );
        if (claudeResult.success) result.claudeAnalysis = claudeResult.findings;
    }

    // ─── OpenAI ──────────────────────────────────────────
    if (state.openaiApiKey) {
        const openaiResult = await analyzeWithOpenAI(
            state.openaiApiKey,
            { parsedData, linkUrls: linkResult.urls || [], attachmentDetails: attachmentResult.results || [] },
            state.openaiModel
        );
        if (openaiResult.success) {
            result.openaiAnalysis = { ...openaiResult.analysis, _model: state.openaiModel || OPENAI_MODEL };
            applyOpenAIInsights(result, openaiResult.analysis);
        } else {
            result.openaiError = openaiResult.error;
        }
    }

    return result;
}

// ─── SADECE EK TARAMA SONUCU ─────────────────────────────
function buildAttachmentOnlyResult(file, attachmentResult) {
    const empty  = { findings: [], score: 0 };
    const result = calculateScore(empty, empty, empty, attachmentResult);
    result.emailMeta = {
        from: [], to: [],
        subject: `Standalone attachment scan: ${file.filename}`,
        date: new Date().toISOString(),
        attachmentCount: 1
    };
    result.attachmentDetails = attachmentResult.results || [];
    result.vtStatus = {
        available:  true,
        configured: !!state.vtApiKey,
        checked:    false,
        reason:     state.vtApiKey ? 'ready' : 'missing-api-key'
    };
    result.id        = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    result.timestamp = new Date().toISOString();
    return result;
}

module.exports = {
    buildEmailAnalysisResult,
    buildAttachmentOnlyResult,
    applyVirusTotalInsights,
    applyOpenAIInsights,
    recalculateResultMeta
};
