// ============================================================
// RISK SCORE CALCULATOR
// ============================================================

function calculateScore(headerResult, contentResult, linkResult, attachmentResult) {
    // Max: header=40, content=30, link=30, attachment=30 → total max ~100
    const raw = headerResult.score + contentResult.score + linkResult.score + attachmentResult.score;
    const score = Math.min(Math.round(raw), 100);

    const allFindings = [
        ...headerResult.findings, ...contentResult.findings,
        ...linkResult.findings, ...attachmentResult.findings
    ];

    // Skor (ham kural motoru çıktısı) ile seviye (findings/AI/OTX/VT'den
    // zorlanmış olabilir) BAĞIMSIZ tutuluyor. Daha önce clampScoreToLevel ile
    // skoru seviyeye yapay olarak çeken hack kaldırıldı — iki sayı farklı
    // şeyleri ölçüyor ve UI bunu açıkça gösteriyor.
    const level = resolveLevel(score, allFindings);
    const { color, labelTR, labelEN } = levelMeta(level);

    const summary = {
        critical: allFindings.filter(f => f.severity === 'critical').length,
        warning: allFindings.filter(f => f.severity === 'warning').length,
        info: allFindings.filter(f => f.severity === 'info').length,
        safe: allFindings.filter(f => f.severity === 'safe').length,
        total: allFindings.length
    };

    return { score, level, color, labelTR, labelEN, summary, findings: allFindings,
        breakdown: {
            header: headerResult.score, content: contentResult.score,
            link: linkResult.score, attachment: attachmentResult.score
        }
    };
}

function resolveLevel(score, findings = []) {
    const base = scoreToLevel(score);
    const forced = forcedLevelFromFindings(findings);
    return levelRank(forced) > levelRank(base) ? forced : base;
}

function forcedLevelFromFindings(findings = []) {
    const criticalAttachment = findings.some(f => f.category === 'attachment' && f.severity === 'critical');
    const warningAttachment  = findings.some(f => f.category === 'attachment' && f.severity === 'warning');
    const criticalLink       = findings.some(f => f.category === 'link'       && f.severity === 'critical');
    const warningLink        = findings.some(f => f.category === 'link'       && f.severity === 'warning');
    const vtCritical         = findings.some(f => f.category === 'virusTotal' && f.severity === 'critical');
    const vtWarning          = findings.some(f => f.category === 'virusTotal' && f.severity === 'warning');

    // ── OTX itibar sinyalleri ─────────────────────────────
    // OTX "malicious" verdict → yüksek risk (high) seviyesine zorla
    // OTX "suspicious" verdict → orta risk (medium) seviyesine zorla
    const otxCritical = findings.some(f => f.category === 'otx' && f.severity === 'critical');
    const otxWarning  = findings.some(f => f.category === 'otx' && f.severity === 'warning');

    const gatewayMalware = findings.some((finding) =>
        finding.category === 'attachment'
        && finding.severity === 'critical'
        && /zararlı olarak karantinaya|quarantined attachment as malware|infected|virus:/i.test(finding.message || '')
    );
    const aiVerdict = findings.find((finding) =>
        finding.category === 'ai' && /AI verdict:/i.test(finding.message || '')
    );
    const aiConfidenceMatch = aiVerdict?.message?.match(/\((\d+)% confidence\)/i);
    const aiConfidence = aiConfidenceMatch ? Number(aiConfidenceMatch[1]) : 0;
    const aiIndicatesCriticalFraud = !!aiVerdict && /\/ (high|critical) /i.test(aiVerdict.message || '');
    const aiIndicatesMediumFraud = !!aiVerdict
        && /\/ medium /i.test(aiVerdict.message || '')
        && /(phishing|bec|invoice_fraud|credential_theft|malware_delivery|extortion)/i.test(aiVerdict.message || '');
    const aiRedFlags = findings.filter((finding) => finding.category === 'ai' && /AI uyarı:/i.test(finding.message || '')).length;

    if (gatewayMalware)                                      return 'high';
    if (aiIndicatesCriticalFraud && aiConfidence >= 70)      return 'high';
    if (aiIndicatesMediumFraud && aiConfidence >= 75 && aiRedFlags >= 2) return 'medium';
    if (vtCritical || otxCritical)                           return 'high';
    if (criticalAttachment || criticalLink)                  return 'medium';
    if (vtWarning || otxWarning || warningAttachment || warningLink) return 'low';
    return 'safe';
}

function scoreToLevel(score) {
    if (score <= 25) return 'safe';
    if (score <= 50) return 'low';
    if (score <= 75) return 'medium';
    return 'high';
}

function levelMeta(level) {
    return {
        safe: { color: '#00e676', labelTR: 'Güvenli', labelEN: 'Safe' },
        low: { color: '#ffea00', labelTR: 'Düşük Risk', labelEN: 'Low Risk' },
        medium: { color: '#ff9100', labelTR: 'Orta Risk', labelEN: 'Medium Risk' },
        high: { color: '#ff1744', labelTR: 'Yüksek Risk', labelEN: 'High Risk' }
    }[level] || { color: '#00e676', labelTR: 'Güvenli', labelEN: 'Safe' };
}

function levelRank(level) {
    return { safe: 0, low: 1, medium: 2, high: 3 }[level] ?? 0;
}

// ────────────────────────────────────────────────────────────────
// KAPSAMLI SEVİYE — result objesindeki tüm sinyalleri (findings, OTX, VT, AI)
// dikkate alarak final seviyeyi belirler. reportBuilder.effectiveReportLevel
// ile aynı sonucu döner; analizör bunu sonuca yazınca web UI ile e-posta raporu
// her zaman aynı seviyeyi gösterir.
// ────────────────────────────────────────────────────────────────
function effectiveLevelFromResult(result) {
    const baseLevel    = result.level || 'safe';
    const findingLevel = _levelFromFindings(result.findings || []);
    const aiLevel      = _levelFromAi(result.openaiAnalysis);
    const vtLevel      = _levelFromVirusTotal(result.virusTotal || []);
    const otxLevel     = _levelFromOtx(result.otxData);

    const maxRank = Math.max(
        levelRank(baseLevel),
        levelRank(findingLevel),
        levelRank(aiLevel),
        levelRank(vtLevel),
        levelRank(otxLevel)
    );
    return ['safe', 'low', 'medium', 'high'][maxRank] || 'safe';
}

function _levelFromFindings(findings) {
    if (findings.some(f => f.severity === 'critical')) return 'high';
    if (findings.some(f => f.severity === 'warning'))  return 'low';
    return 'safe';
}

function _levelFromAi(ai) {
    const threat = String(ai?.threatLevel || '').toLowerCase();
    const confidence = Number(ai?.confidence || 0);
    if ((threat === 'critical' || threat === 'high') && confidence >= 65) return 'high';
    if (threat === 'medium' && confidence >= 60) return 'medium';
    if (threat === 'low' && confidence >= 50) return 'low';
    return 'safe';
}

function _levelFromVirusTotal(entries) {
    if (entries.some(e => (e.stats?.malicious || 0) > 0))  return 'high';
    if (entries.some(e => (e.stats?.suspicious || 0) > 0)) return 'medium';
    return 'safe';
}

function _levelFromOtx(otxData) {
    if (!otxData?.indicators) return 'safe';
    if (otxData.indicators.some(i => i.verdict === 'malicious'))  return 'high';
    if (otxData.indicators.some(i => i.verdict === 'suspicious')) return 'medium';
    return 'safe';
}

// ────────────────────────────────────────────────────────────────
// [DEPRECATED] clampScoreToLevel — Skor ile seviye farklı şeyleri ölçüyor;
// skoru seviyeye yapay olarak çekmek dürüstlük problemiydi. UI artık iki
// değeri yan yana gösteriyor ve fark varsa "neden" açıklaması ekliyor.
// Geriye dönük uyumluluk için fonksiyon duruyor (no-op). Kullanmayın.
function clampScoreToLevel(score /*, level */) {
    return Math.max(0, Math.min(100, Number(score) || 0));
}

// ────────────────────────────────────────────────────────────────
// Seviyenin neden ham skordan farklı olduğunu açıklayan kısa metin döner.
// Web UI ve e-posta raporu bunu kullanıcıya gösterir.
// Dönen: { reason: 'OTX phishing kampanyası ...', sources: ['otx', 'ai'] } veya null
// ────────────────────────────────────────────────────────────────
function levelEscalationReason(result) {
    const score = Number(result?.score || 0);
    const finalLevel = effectiveLevelFromResult(result || {});
    const scoreLevel = scoreToLevel(score);

    if (levelRank(finalLevel) <= levelRank(scoreLevel)) return null;

    const reasons = [];
    const sources = [];

    // OTX
    const otxIndicators = result?.otxData?.indicators || [];
    const otxMalicious = otxIndicators.filter(i => i.verdict === 'malicious');
    const otxSuspicious = otxIndicators.filter(i => i.verdict === 'suspicious');
    if (otxMalicious.length) {
        reasons.push(`OTX tehdit istihbaratında ${otxMalicious.length} zararlı gösterge işaretli`);
        sources.push('otx');
    } else if (otxSuspicious.length) {
        reasons.push(`OTX tehdit istihbaratında ${otxSuspicious.length} şüpheli gösterge işaretli`);
        sources.push('otx');
    }

    // VirusTotal
    const vt = result?.virusTotal || [];
    const vtMal = vt.reduce((n, e) => n + (e.stats?.malicious || 0), 0);
    const vtSus = vt.reduce((n, e) => n + (e.stats?.suspicious || 0), 0);
    if (vtMal > 0) {
        reasons.push(`VirusTotal'de ${vtMal} antivirüs motoru zararlı tespit etti`);
        sources.push('virustotal');
    } else if (vtSus > 0) {
        reasons.push(`VirusTotal'de ${vtSus} antivirüs motoru şüpheli işaretledi`);
        sources.push('virustotal');
    }

    // AI
    const ai = result?.openaiAnalysis;
    if (ai?.threatLevel) {
        const threat = String(ai.threatLevel).toLowerCase();
        const conf = Number(ai.confidence || 0);
        if (['high', 'critical', 'medium'].includes(threat) && conf >= 60) {
            reasons.push(`Yapay zekâ ${threat} seviye tehdit (%${conf} güvenle) tespit etti`);
            sources.push('ai');
        }
    }

    // Findings (kritik bulgular)
    const criticalFindings = (result?.findings || []).filter(f => f.severity === 'critical');
    if (criticalFindings.length && !sources.length) {
        reasons.push(`${criticalFindings.length} kritik bulgu tespit edildi`);
        sources.push('findings');
    }

    if (!reasons.length) {
        // Fallback: seviye yükseldi ama spesifik kaynak çıkaramadık
        reasons.push('Birden çok güvenlik sinyali birleşince risk seviyesi yükseltildi');
        sources.push('combined');
    }

    return {
        reason: reasons.join(' · '),
        sources,
        scoreLevel,
        finalLevel
    };
}

module.exports = {
    calculateScore, resolveLevel, scoreToLevel, levelMeta, levelRank,
    clampScoreToLevel, effectiveLevelFromResult, levelEscalationReason
};
