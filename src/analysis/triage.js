// ============================================================
// TRIAGE — AI Hâkim öncesi sınıflandırıcı (3 katman)
//
// Tier 1: Bariz tehdit  → AI'ya gönderme, kural sonucu yeterli
// Tier 2: Bariz güvenli → AI'ya gönderme, kural sonucu yeterli
// Tier 3: Kararsız      → AI hâkim çağrılır
//
// Felsefe: AI çağrısı pahalı + yavaş. Sadece gri bölgedeki mailler
// için kullan. ~%70 mail tier 1/2'de halledilir.
// ============================================================

/**
 * Triage karar fonksiyonu.
 * @param {Object} result - emailAnalyzer'dan gelen tam sonuç
 * @returns {Object} { tier: 1|2|3, reason: 'string', shouldAdjudicate: bool }
 */
function triage(result) {
    const findings = result.findings || [];
    const vt       = result.virusTotal || [];
    const otx      = result.otxData || {};
    const ai       = result.openaiAnalysis || null;

    // ─── TIER 1: Bariz tehdit ────────────────────────────────
    // VirusTotal'de zararlı tespit
    const vtMalicious = vt.reduce((n, e) => n + (e.stats?.malicious || 0), 0);
    if (vtMalicious > 0) {
        return {
            tier: 1,
            reason: `VirusTotal'de ${vtMalicious} antivirüs motoru zararlı tespit etti`,
            shouldAdjudicate: false
        };
    }

    // OTX'te malicious indicator
    const otxMalicious = (otx.indicators || []).filter(i => i.verdict === 'malicious').length;
    if (otxMalicious > 0) {
        return {
            tier: 1,
            reason: `OTX'te ${otxMalicious} zararlı gösterge işaretli`,
            shouldAdjudicate: false
        };
    }

    // Karantinaya alınmış zararlı ek
    const gatewayMalware = findings.some(f =>
        f.category === 'attachment' &&
        f.severity === 'critical' &&
        /zararlı olarak karantinaya|quarantined|infected|virus:/i.test(f.message || '')
    );
    if (gatewayMalware) {
        return {
            tier: 1,
            reason: 'Mail ağ geçidi zararlı ek karantinaya aldı',
            shouldAdjudicate: false
        };
    }

    // Blocklist'te gönderici (statik kara liste)
    const blocklistedSender = findings.some(f =>
        f.category === 'header' && /blocklist|kara liste/i.test(f.message || '')
    );
    if (blocklistedSender) {
        return {
            tier: 1,
            reason: 'Gönderici kara listede',
            shouldAdjudicate: false
        };
    }

    // ─── TIER 2: Bariz güvenli ───────────────────────────────
    // Hiç critical bulgu yok + auth tam başarılı + ek yok + suspicious link yok
    const hasCritical = findings.some(f => f.severity === 'critical');
    const hasWarning  = findings.some(f => f.severity === 'warning');
    const hasAttachments = (result.attachmentDetails || []).length > 0;
    const hasSuspiciousLinks = findings.some(f => f.category === 'link' && f.severity !== 'safe');
    const allowlistedSender = findings.some(f =>
        f.category === 'header' && /allowlist|güvenilir/i.test(f.message || '')
    );

    if (allowlistedSender && !hasCritical) {
        return {
            tier: 2,
            reason: 'Gönderici güvenilir listede + kritik bulgu yok',
            shouldAdjudicate: false
        };
    }

    // VT/OTX hiç sinyal vermemişse + hiç warning/critical bulgu yoksa + AI da safe/low dediyse
    const otxSuspicious = (otx.indicators || []).filter(i => i.verdict === 'suspicious').length;
    const aiThreatLevel = String(ai?.threatLevel || '').toLowerCase();
    const aiSaysSafe    = aiThreatLevel === 'safe' || aiThreatLevel === 'low';

    if (!hasCritical && !hasWarning && otxSuspicious === 0 && (!ai || aiSaysSafe)) {
        return {
            tier: 2,
            reason: 'Tüm kontroller temiz, kararsızlık sinyali yok',
            shouldAdjudicate: false
        };
    }

    // ─── TIER 3: Kararsız → AI hâkim ─────────────────────────
    const reasons = [];
    if (hasCritical) reasons.push('kritik bulgular var');
    if (hasWarning) reasons.push('uyarı seviyesinde bulgular var');
    if (otxSuspicious > 0) reasons.push(`OTX'te ${otxSuspicious} şüpheli gösterge`);
    if (hasSuspiciousLinks) reasons.push('şüpheli linkler');
    if (hasAttachments) reasons.push(`${result.attachmentDetails.length} ek dosya`);
    if (ai && !aiSaysSafe) reasons.push(`AI ön-değerlendirmesi: ${aiThreatLevel}`);

    return {
        tier: 3,
        reason: reasons.length ? reasons.join(' · ') : 'Karışık sinyaller',
        shouldAdjudicate: true
    };
}

module.exports = { triage };
