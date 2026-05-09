// ============================================================
// EVIDENCE PACK — AI hâkime gönderilecek temiz, yapısal delil paketi.
//
// emailAnalyzer'ın ürettiği büyük result objesinden gürültüyü atıp,
// AI'nın karar vermesi için gerekli sinyalleri özlü bir JSON'a sıkıştırır.
// ============================================================

/**
 * @param {Object} result - tam analiz sonucu
 * @returns {Object} delil paketi (~1-2 KB)
 */
function buildEvidencePack(result) {
    const meta = result.emailMeta || {};
    const findings = result.findings || [];
    const attachments = result.attachmentDetails || [];
    const vt = result.virusTotal || [];
    const otx = result.otxData || {};
    const ai = result.openaiAnalysis || {};

    // Auth durumu
    const authMap = {};
    for (const f of findings.filter(f => f.category === 'header')) {
        const m = (f.message || '').toLowerCase();
        if (m.includes('spf'))   authMap.spf   = severityToStatus(f.severity);
        if (m.includes('dkim'))  authMap.dkim  = severityToStatus(f.severity);
        if (m.includes('dmarc')) authMap.dmarc = severityToStatus(f.severity);
    }

    // Linkler — sadece şüpheli + zararlı olanlar
    const suspiciousLinks = findings
        .filter(f => f.category === 'link' && f.severity !== 'safe')
        .slice(0, 6)
        .map(f => ({
            severity: f.severity,
            message:  truncate(f.message || '', 200)
        }));

    // Ekler — sadece tip + boyut + VT durumu
    const attachmentList = attachments.slice(0, 8).map(a => {
        const vtEntry = vt.find(v => v.filename === a.filename || v.sha256 === a.sha256);
        return {
            filename: truncate(a.filename || 'unnamed', 80),
            type:     a.contentType || 'unknown',
            sizeKB:   Math.round((a.size || 0) / 1024),
            vt:       vtEntry ? {
                checked:    true,
                malicious:  vtEntry.stats?.malicious  || 0,
                suspicious: vtEntry.stats?.suspicious || 0,
                total:      vtEntry.stats?.total      || 0
            } : { checked: false }
        };
    });

    // OTX sinyalleri
    const otxIndicators = (otx.indicators || []).slice(0, 6).map(i => ({
        type:     i.type || 'unknown',
        value:    truncate(i.value || '', 100),
        verdict:  i.verdict || 'unknown',
        pulses:   i.pulseCount || 0
    }));

    // İçerik sinyalleri (content + finding kategorilerinden)
    const contentSignals = [];
    for (const f of findings.filter(f => f.category === 'content' || f.category === 'ai')) {
        if (f.severity === 'safe') continue;
        contentSignals.push({
            severity: f.severity,
            message:  truncate(f.message || '', 200)
        });
    }

    return {
        version: 1,
        email: {
            from:    truncate(formatAddress(meta.from), 200),
            to:      truncate(formatAddress(meta.to), 200),
            subject: truncate(meta.subject || '', 250),
            date:    meta.date || result.timestamp || null,
            hasReplyTo: Boolean(meta.replyTo?.length),
            replyToDiffersFromFrom: replyToMismatch(meta)
        },
        authentication: {
            spf:   authMap.spf   || 'unknown',
            dkim:  authMap.dkim  || 'unknown',
            dmarc: authMap.dmarc || 'unknown'
        },
        ruleEngine: {
            score:    Number(result.score || 0),
            level:    result.level || 'safe',
            criticalCount: findings.filter(f => f.severity === 'critical').length,
            warningCount:  findings.filter(f => f.severity === 'warning').length
        },
        contentSignals: contentSignals.slice(0, 12),
        links: {
            totalCount:       (result.linkUrls || []).length,
            suspiciousCount:  suspiciousLinks.length,
            suspiciousSample: suspiciousLinks
        },
        attachments: {
            totalCount:    attachments.length,
            details:       attachmentList
        },
        externalIntel: {
            virusTotal: {
                checked:           vt.length,
                totalMalicious:    vt.reduce((n, e) => n + (e.stats?.malicious  || 0), 0),
                totalSuspicious:   vt.reduce((n, e) => n + (e.stats?.suspicious || 0), 0)
            },
            otx: {
                checked:    otxIndicators.length,
                malicious:  otxIndicators.filter(i => i.verdict === 'malicious').length,
                suspicious: otxIndicators.filter(i => i.verdict === 'suspicious').length,
                indicators: otxIndicators
            }
        },
        priorAi: ai.threatLevel ? {
            threatLevel: ai.threatLevel,
            category:    ai.category,
            confidence:  ai.confidence
        } : null
    };
}

// ─── Helper'lar ─────────────────────────────────────────────
function severityToStatus(sev) {
    if (sev === 'safe')     return 'pass';
    if (sev === 'critical') return 'fail';
    if (sev === 'warning')  return 'soft-fail';
    return 'unknown';
}

function formatAddress(addrs) {
    if (!Array.isArray(addrs) || !addrs.length) return '';
    const a = addrs[0];
    if (a.name && a.address) return `${a.name} <${a.address}>`;
    return a.address || a.name || '';
}

function replyToMismatch(meta) {
    const fromAddr    = meta.from?.[0]?.address?.toLowerCase()    || '';
    const replyToAddr = meta.replyTo?.[0]?.address?.toLowerCase() || '';
    if (!fromAddr || !replyToAddr) return false;
    return fromAddr !== replyToAddr;
}

function truncate(s, max) {
    s = String(s || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
}

module.exports = { buildEvidencePack };
