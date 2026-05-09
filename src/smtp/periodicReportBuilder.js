const { effectiveReportLevel, isRisky } = require('./reportBuilder');
const { loadSettings } = require('../storage/settingsStore');

const PERIODS = {
    daily: { label: 'Gunluk', days: 1 },
    weekly: { label: 'Haftalik', days: 7 },
    monthly: { label: 'Aylik', days: 30 },
    yearly: { label: 'Yillik', days: 365 }
};

function buildPeriodicReportHtml({ period, history, generatedAt = new Date(), targetMailbox = '' }) {
    const companyProfile = loadSettings().companyProfile || {};
    const companyName = companyProfile.name || 'MailTrustAI';
    const companyDetails = companyProfile.details || '';
    const companyContactInfo = companyProfile.contactInfo || '';
    const periodMeta = PERIODS[period] || PERIODS.daily;
    const range = resolveRange(period, generatedAt);
    const rows = filterRowsForReport(history, range.start, range.end, targetMailbox);
    const stats = summarizeRows(rows);
    const mailboxGroups = groupByMailbox(rows);

    return `<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MailTrustAI Tarama Özeti</title>
</head>
<body style="margin:0;background:#08111f;color:#e5eefb;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:980px;margin:0 auto;padding:28px;">
        <div style="padding:24px;border-radius:18px;background:linear-gradient(135deg,#0f2138,#16213b 55%,#27101c);border:1px solid #243653;">
            <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:16px"><tr>
                <td style="background:#1e3a8a;background:linear-gradient(135deg,#1e3a8a,#3b82f6 60%,#8b5cf6);width:44px;height:44px;border-radius:9px;text-align:center;vertical-align:middle;font-size:24px;line-height:44px;color:#ffffff;font-weight:900">&#128737;</td>
                <td style="padding-left:12px;vertical-align:middle"><div style="font-size:17px;font-weight:800;color:#f8fafc;letter-spacing:.3px">MailTrustAI</div><div style="font-size:10px;color:#9eb0c9;letter-spacing:1px;margin-top:2px">SCAN &middot; ANALYZE &middot; EVALUATE &middot; PROTECT</div></td>
            </tr></table>
            <div style="font-size:22px;font-weight:800;letter-spacing:.04em;">${esc(companyName.toUpperCase())} TARAMA OZETI</div>
            ${companyDetails ? `<div style="margin-top:8px;color:#cbd5e1;">${esc(companyDetails)}</div>` : ''}
            <div style="margin-top:8px;color:#9eb0c9;">Rapor turu: <strong>${esc(periodMeta.label)}</strong> | Uretim zamani: ${esc(formatDate(generatedAt))}</div>
            <div style="margin-top:4px;color:#9eb0c9;">Kapsam: ${esc(formatDate(range.start))} - ${esc(formatDate(range.end))}</div>
            ${targetMailbox ? `<div style="margin-top:4px;color:#9eb0c9;">Hedef posta kutusu: <strong>${esc(targetMailbox)}</strong></div>` : ''}
        </div>

        <div style="margin-top:22px;padding:20px;border-radius:16px;background:#0d1728;border:1px solid #263651;">
            <div style="font-size:15px;font-weight:800;color:#a9b8d0;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px;">Tarama Istatistikleri Ozet Tablosu</div>
            ${renderSummaryTable(stats)}
        </div>

        <div style="margin-top:22px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">
            ${renderMetricCard('Toplam Tarama', stats.total, '#8ea2ff')}
            ${renderMetricCard('Riskli Mail', stats.risky, '#ff5c7a')}
            ${renderMetricCard('Guvenli Mail', stats.safe, '#2ee59d')}
            ${renderMetricCard('Ortalama Skor', stats.averageScore, '#ffb84d')}
        </div>

        <div style="margin-top:22px;padding:20px;border-radius:16px;background:#0d1728;border:1px solid #263651;">
            <div style="font-size:15px;font-weight:800;color:#a9b8d0;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px;">Riskli Taramalar</div>
            ${renderRiskList(rows)}
        </div>

        <div style="margin-top:22px;padding:20px;border-radius:16px;background:#0d1728;border:1px solid #263651;">
            <div style="font-size:15px;font-weight:800;color:#a9b8d0;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px;">Geldigi Mail Adresi Bazli Tarama Ozeti</div>
            ${renderMailboxGroups(mailboxGroups)}
        </div>

        <div style="margin-top:22px;color:#7f8da8;font-size:12px;line-height:1.6;">
            Bu otomatik rapor ${esc(companyName)} tarafindan olusturulmustur. Riskli mesajlarda ekleri acmayiniz, baglantilara tiklamayiniz ve bilgi islem ekibiyle iletisime geciniz.
            ${companyContactInfo ? `<br><br>${esc(companyContactInfo)}` : ''}
        </div>
    </div>
</body>
</html>`;
}

function summarizeRows(rows) {
    const levelCounts = { safe: 0, low: 0, medium: 0, high: 0 };
    let totalScore = 0;
    let attachmentCount = 0;
    let vtMalicious = 0;
    let vtSuspicious = 0;
    let aiRisk = 0;
    let linkWarnings = 0;

    rows.forEach((row) => {
        const level = effectiveReportLevel(row);
        levelCounts[level] = (levelCounts[level] || 0) + 1;
        totalScore += Number(row.score) || 0;
        attachmentCount += Number(row.emailMeta?.attachmentCount) || (Array.isArray(row.attachmentDetails) ? row.attachmentDetails.length : 0);
        if (row.openaiAnalysis && row.openaiAnalysis.threatLevel && row.openaiAnalysis.threatLevel !== 'safe') {
            aiRisk += 1;
        }
        (row.findings || []).forEach((finding) => {
            if (finding.category === 'link' && finding.severity !== 'safe') linkWarnings += 1;
        });
        (row.virusTotal || []).forEach((entry) => {
            vtMalicious += Number(entry.stats?.malicious) || 0;
            vtSuspicious += Number(entry.stats?.suspicious) || 0;
        });
    });

    const risky = rows.filter((row) => isRisky(row)).length;
    return {
        total: rows.length,
        risky,
        safe: rows.length - risky,
        high: levelCounts.high || 0,
        medium: levelCounts.medium || 0,
        low: levelCounts.low || 0,
        averageScore: rows.length ? Math.round(totalScore / rows.length) : 0,
        attachmentCount,
        vtMalicious,
        vtSuspicious,
        aiRisk,
        linkWarnings
    };
}

function renderSummaryTable(stats) {
    const rows = [
        ['Toplam tarama', stats.total],
        ['Riskli sonuc', stats.risky],
        ['Guvenli sonuc', stats.safe],
        ['Yuksek risk', stats.high],
        ['Orta risk', stats.medium],
        ['Dusuk risk', stats.low],
        ['Ortalama skor', `${stats.averageScore}/100`],
        ['Ek dosya sayisi', stats.attachmentCount],
        ['Zararlı bulan motor sayısı', stats.vtMalicious],
        ['Şüpheli bulan motor sayısı', stats.vtSuspicious],
        ['AI risk isareti', stats.aiRisk],
        ['Link uyarisi', stats.linkWarnings]
    ];

    return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tbody>
            ${rows.map(([label, value]) => `
                <tr>
                    <td style="padding:10px 12px;border-bottom:1px solid #263651;color:#a9b8d0;">${esc(label)}</td>
                    <td style="padding:10px 12px;border-bottom:1px solid #263651;text-align:right;font-weight:800;color:#f4f7fb;">${esc(String(value))}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>`;
}

function renderMetricCard(label, value, color) {
    return `<div style="padding:16px;border-radius:14px;background:#111b2d;border:1px solid #263651;text-align:center;">
        <div style="font-size:28px;font-weight:900;color:${color};">${esc(String(value))}</div>
        <div style="font-size:12px;color:#8b9bb5;margin-top:6px;">${esc(label)}</div>
    </div>`;
}

function renderRiskList(rows) {
    const riskyRows = rows.filter((row) => isRisky(row));
    if (!riskyRows.length) {
        return '<div style="color:#8b9bb5;">Bu donemde riskli tarama bulunmadi.</div>';
    }

    return riskyRows.map((row) => {
        const meta = row.emailMeta || {};
        const from = meta.from?.[0]?.address || 'N/A';
        const to = meta.to?.[0]?.address || 'N/A';
        const level = effectiveReportLevel(row);
        return `<div style="padding:14px;border:1px solid #2c3b56;border-radius:12px;background:#111b2d;margin-bottom:10px;">
            <div style="display:flex;gap:12px;align-items:center;">
                <div style="min-width:72px;text-align:center;color:${levelColor(level)};font-weight:900;">${esc(levelLabel(level))}</div>
                <div style="flex:1;">
                    <div style="font-weight:800;color:#f4f7fb;">${esc(meta.subject || 'Konu yok')}</div>
                    <div style="font-size:12px;color:#8b9bb5;margin-top:4px;">Kimden: ${esc(from)} | Kime: ${esc(to)} | Skor: ${esc(String(row.score || 0))}/100 | Tarih: ${esc(formatDate(row.timestamp || meta.date))}</div>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderMailboxGroups(groups) {
    const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    if (!keys.length) {
        return '<div style="color:#8b9bb5;">Bu donemde tarama kaydi yok.</div>';
    }

    return keys.map((mailbox) => {
        const rows = groups[mailbox];
        const stats = summarizeRows(rows);
        return `<div style="padding:16px;border:1px solid #2c3b56;border-radius:14px;background:#111b2d;margin-bottom:14px;">
            <div style="font-size:16px;font-weight:900;color:#f4f7fb;">${esc(mailbox)}</div>
            <div style="margin-top:8px;color:#8b9bb5;font-size:12px;">
                Toplam: <strong style="color:#f4f7fb;">${stats.total}</strong> |
                Riskli: <strong style="color:#ff5c7a;">${stats.risky}</strong> |
                Guvenli: <strong style="color:#2ee59d;">${stats.safe}</strong> |
                Ortalama skor: <strong style="color:#ffb84d;">${stats.averageScore}/100</strong>
            </div>
            <div style="margin-top:12px;">
                ${rows.map((row) => renderMailboxScanRow(row)).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderMailboxScanRow(row) {
    const meta = row.emailMeta || {};
    const from = meta.from?.[0]?.address || 'N/A';
    const level = effectiveReportLevel(row);
    const attachmentCount = Number(meta.attachmentCount) || (Array.isArray(row.attachmentDetails) ? row.attachmentDetails.length : 0);
    return `<div style="padding:10px 0;border-top:1px solid #263651;">
        <div style="font-weight:700;color:#f4f7fb;">${esc(meta.subject || 'Konu yok')}</div>
        <div style="font-size:12px;color:#8b9bb5;margin-top:4px;">
            ${esc(formatDate(row.timestamp || meta.date))} | Gonderen: ${esc(from)} | Seviye: <span style="color:${levelColor(level)};font-weight:800;">${esc(levelLabel(level))}</span> | Skor: ${esc(String(row.score || 0))}/100 | Ek: ${attachmentCount}
        </div>
    </div>`;
}

function groupByMailbox(rows) {
    return rows.reduce((acc, row) => {
        const mailbox = row.emailMeta?.to?.[0]?.address || row.scanMailbox || row.accountEmail || 'Bilinmeyen mail adresi';
        if (!acc[mailbox]) acc[mailbox] = [];
        acc[mailbox].push(row);
        return acc;
    }, {});
}

function resolveRange(period, now = new Date()) {
    const periodMeta = PERIODS[period] || PERIODS.daily;
    const end = new Date(now);
    const start = new Date(end.getTime() - (periodMeta.days * 24 * 60 * 60 * 1000));
    return { start, end };
}

function filterHistoryByRange(history, start, end) {
    return (Array.isArray(history) ? history : []).filter((item) => {
        const time = new Date(item.timestamp || item.emailMeta?.date || 0).getTime();
        return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
    });
}

function filterRowsForReport(history, start, end, targetMailbox = '') {
    const rows = filterHistoryByRange(history, start, end);
    if (!targetMailbox) return rows;
    return rows.filter((row) => matchesMailbox(row, targetMailbox));
}

function matchesMailbox(row, targetMailbox) {
    const target = String(targetMailbox || '').trim().toLowerCase();
    if (!target) return true;

    const addresses = [
        ...(Array.isArray(row.emailMeta?.to) ? row.emailMeta.to.map((entry) => entry?.address) : []),
        row.scanMailbox,
        row.accountEmail
    ]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());

    return addresses.includes(target);
}

function levelLabel(level) {
    return ({ safe: 'GUVENLI', low: 'DUSUK', medium: 'ORTA', high: 'YUKSEK' })[level] || 'BILINMIYOR';
}

function levelColor(level) {
    return ({ safe: '#2ee59d', low: '#ffe066', medium: '#ffb84d', high: '#ff5c7a' })[level] || '#a9b8d0';
}

function formatDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
}

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = {
    PERIODS,
    buildPeriodicReportHtml,
    summarizeRows,
    resolveRange,
    filterHistoryByRange,
    filterRowsForReport,
    matchesMailbox
};
