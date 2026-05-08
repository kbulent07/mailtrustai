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

module.exports = { calculateScore, resolveLevel, scoreToLevel, levelMeta };
