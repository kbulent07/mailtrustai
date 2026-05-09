const { effectiveReportLevel } = require('../smtp/reportBuilder');

const LEVEL_WEIGHT = { safe: 0, low: 10, medium: 35, high: 70 };
const LEVEL_LABEL = { safe: 'Guvenli', low: 'Dusuk', medium: 'Orta', high: 'Yuksek' };

function buildRiskDashboard({ history = [], periodDays = 30, license = null } = {}) {
    const now = new Date();
    const currentStart = new Date(now.getTime() - periodDays * 86400000);
    const previousStart = new Date(now.getTime() - periodDays * 2 * 86400000);

    const currentRows = filterByRange(history, currentStart, now);
    const previousRows = filterByRange(history, previousStart, currentStart);
    const stats = summarize(currentRows);
    const previousStats = summarize(previousRows);
    const riskScore = calculateSecurityScore(stats, currentRows.length);
    const previousScore = calculateSecurityScore(previousStats, previousRows.length);
    const trend = riskScore - previousScore;

    return {
        generatedAt: now.toISOString(),
        periodDays,
        range: { start: currentStart.toISOString(), end: now.toISOString() },
        score: riskScore,
        grade: scoreGrade(riskScore),
        trend,
        trendLabel: trend > 3 ? 'iyilesiyor' : (trend < -3 ? 'kotuye gidiyor' : 'stabil'),
        license: license ? {
            plan: license.plan || 'free',
            tier: license.tier || '',
            daysLeft: license.daysLeft ?? null,
            monthlyLimit: license.monthlyLimit ?? null
        } : null,
        stats,
        topSenders: topSenders(currentRows),
        riskyMailboxes: riskyMailboxes(currentRows),
        attackTypes: attackTypes(currentRows),
        recommendations: buildRecommendations(stats, riskScore, license)
    };
}

function filterByRange(history, start, end) {
    return (Array.isArray(history) ? history : []).filter((row) => {
        const time = new Date(row.timestamp || row.emailMeta?.date || 0).getTime();
        return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
    });
}

function summarize(rows) {
    const levels = { safe: 0, low: 0, medium: 0, high: 0 };
    let totalScore = 0;
    let weightedRisk = 0;
    let vtHits = 0;
    let attachmentFindings = 0;
    let linkFindings = 0;
    let aiFindings = 0;

    for (const row of rows) {
        const level = effectiveReportLevel(row);
        levels[level] = (levels[level] || 0) + 1;
        totalScore += Number(row.score) || 0;
        weightedRisk += LEVEL_WEIGHT[level] || 0;
        for (const finding of row.findings || []) {
            if (finding.category === 'attachment' && finding.severity !== 'safe') attachmentFindings++;
            if (finding.category === 'link' && finding.severity !== 'safe') linkFindings++;
            if (finding.category === 'ai' && finding.severity !== 'safe') aiFindings++;
        }
        for (const entry of row.virusTotal || []) {
            if ((entry.stats?.malicious || 0) > 0 || (entry.stats?.suspicious || 0) > 0) vtHits++;
        }
    }

    const risky = rows.filter((row) => effectiveReportLevel(row) !== 'safe').length;
    return {
        total: rows.length,
        risky,
        safe: rows.length - risky,
        high: levels.high || 0,
        medium: levels.medium || 0,
        low: levels.low || 0,
        averageScanScore: rows.length ? Math.round(totalScore / rows.length) : 0,
        weightedRisk: rows.length ? Math.round(weightedRisk / rows.length) : 0,
        riskRate: rows.length ? Math.round((risky / rows.length) * 100) : 0,
        vtHits,
        attachmentFindings,
        linkFindings,
        aiFindings
    };
}

function calculateSecurityScore(stats, rowCount) {
    if (!rowCount) return 100;
    const riskPenalty = Math.min(70, stats.weightedRisk);
    const volumePenalty = stats.high > 0 ? Math.min(15, stats.high * 3) : 0;
    const ratePenalty = stats.riskRate >= 30 ? 10 : (stats.riskRate >= 10 ? 5 : 0);
    return Math.max(0, Math.min(100, 100 - riskPenalty - volumePenalty - ratePenalty));
}

function scoreGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'E';
}

function topSenders(rows) {
    const counts = new Map();
    for (const row of rows) {
        if (effectiveReportLevel(row) === 'safe') continue;
        const sender = row.emailMeta?.from?.[0]?.address || 'unknown';
        counts.set(sender, (counts.get(sender) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([email, count]) => ({ email, count }));
}

function riskyMailboxes(rows) {
    const counts = new Map();
    for (const row of rows) {
        if (effectiveReportLevel(row) === 'safe') continue;
        const mailbox = row.scanMailbox || row.accountEmail || row.emailMeta?.to?.[0]?.address || 'unknown';
        counts.set(mailbox, (counts.get(mailbox) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([email, count]) => ({ email, count }));
}

function attackTypes(rows) {
    const counts = new Map();
    for (const row of rows) {
        for (const finding of row.findings || []) {
            if (finding.severity === 'safe') continue;
            const label = finding.category ? String(finding.category) : 'general';
            counts.set(label, (counts.get(label) || 0) + 1);
        }
        const level = effectiveReportLevel(row);
        if (level !== 'safe') counts.set(LEVEL_LABEL[level], (counts.get(LEVEL_LABEL[level]) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([type, count]) => ({ type, count }));
}

function buildRecommendations(stats, score, license) {
    const recs = [];
    if (stats.high > 0) recs.push('Yuksek riskli mailler icin otomatik karantina ve anlik bildirim surecini etkinlestirin.');
    if (stats.linkFindings > stats.attachmentFindings) recs.push('Link odakli saldirilar baskin; URL reputation ve kisaltilmis link cozumleme kontrollerini yakindan izleyin.');
    if (stats.attachmentFindings > 0) recs.push('Ek dosya riskleri icin YARA/ClamAV veya sandbox entegrasyonunu Enterprise modulu olarak konumlandirin.');
    if (stats.riskRate >= 10) recs.push('Aylik yonetici raporunu paylasip risk oranini dusurmek icin kullanici farkindalik aksiyonu planlayin.');
    if (license && license.plan !== 'enterprise') recs.push('IMAP izleme, tum mailler icin rapor ve anlik uyari icin Enterprise yukseltmesi onerilir.');
    if (score >= 90 && !recs.length) recs.push('Risk seviyesi dusuk; mevcut kontrolleri surdurup aylik executive raporla yonetim gorunurlugunu koruyun.');
    return recs.slice(0, 5);
}

module.exports = { buildRiskDashboard };
