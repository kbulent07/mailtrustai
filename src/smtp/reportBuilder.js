// ============================================================
// SECURITY REPORT BUILDER
// ============================================================
const { loadSettings } = require('../storage/settingsStore');

function buildReportHtml(result, lang = 'tr') {
    const companyProfile = loadSettings().companyProfile || {};
    const companyName = companyProfile.name || 'MailTrustAI';
    const companyDetails = companyProfile.details || '';
    const companyContactInfo = companyProfile.contactInfo || '';
    const isTR = lang === 'tr';
    const meta = result.emailMeta || {};
    const findings = result.findings || [];
    const attachments = result.attachmentDetails || [];
    const vtEntries = result.virusTotal || [];
    // AI analizi e-posta raporlarına dahil edilmez (web arayüzünde gösterilir)
    const aiOpenAI = null;
    const aiClaude = null;
    const level = effectiveReportLevel(result);
    const score = Number(result.score || 0);
    const levelText = reportLevelText(level, isTR);
    const risky = level !== 'safe';
    const verdictText = risky ? (isTR ? 'RISKLI' : 'RISKY') : (isTR ? 'GUVENLI' : 'SAFE');
    const color = levelColor(level);
    const from = formatAddressList(meta.from);
    const to = formatAddressList(meta.to);
    const linkCount = countLinks(result);
    const attachmentNames = attachments.length ? attachments.map((item) => item.filename).filter(Boolean) : [];
    const authRows = buildAuthRows(result);
    const vtRows = buildVirusTotalRows(vtEntries, attachments);
    const otxSection = buildOtxSection(result);
    const threatTags = buildThreatTags(result);
    const detailedFindings = buildDetailedFindingRows(result);
    const suspiciousLinks = findings
        .filter((finding) => finding.category === 'link' && finding.severity !== 'safe')
        .map((finding) => finding.message);
    const summary = buildExecutiveSummary(result, isTR);

    // E-postanın hemen üstüne yerleştirilen verdict ayracı
    const levelIcon = { high: '&#128308;', medium: '&#128992;', low: '&#128993;', safe: '&#128994;' }[level] || '&#9888;&#65039;';
    const verdictBadgeText = risky ? (isTR ? '&#9888; RISKLI' : '&#9888; RISKY') : (isTR ? '&#10003; GUVENLI' : '&#10003; SAFE');
    const topTagsHtml = (threatTags || []).slice(0, 4).map((tag) =>
        `<span style="display:inline-block;margin:3px 5px 3px 0;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,0.14);color:#f8fafc;font-size:11px;font-weight:700">${escapeHtml(tag)}</span>`
    ).join('');
    const verdictDivider =
        `<tr><td style="padding:6px 30px 0">` +
        `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:2px solid ${color};border-radius:12px;background:linear-gradient(90deg,${color}33,${color}10);overflow:hidden">` +
        `<tr>` +
        `<td style="padding:12px 16px;font-size:24px;width:1%;white-space:nowrap">${levelIcon}</td>` +
        `<td style="padding:12px 8px">` +
        `<div style="font-size:11px;color:#cbd5e1;font-weight:700;letter-spacing:1px">${isTR ? '&#128235; BU E-POSTA ICIN TARAMA SONUCU' : '&#128235; SCAN RESULT FOR THIS EMAIL'}</div>` +
        `<div style="font-size:18px;font-weight:800;color:${color};margin-top:2px">${escapeHtml(levelText)} <span style="font-size:13px;color:#94a3b8;font-weight:600;margin-left:6px">${isTR ? 'Skor' : 'Score'} ${score}/100</span></div>` +
        `</td>` +
        `<td align="right" style="padding:12px 16px;width:1%;white-space:nowrap"><span style="display:inline-block;padding:6px 14px;border-radius:8px;background:${color};color:#0f172a;font-size:11px;font-weight:800;letter-spacing:1.5px">${verdictBadgeText}</span></td>` +
        `</tr>` +
        (topTagsHtml ? `<tr><td colspan="3" style="padding:0 16px 12px;border-top:1px dashed ${color}55">${topTagsHtml}</td></tr>` : '') +
        `</table></td></tr>`;

    // Tüm bölümleri birleştir — tek satır (Zimbra whitespace sorununu önler)
    const sections = [
        verdictDivider,
        section('&#128231; Incelenen E-posta', [
            kv('Gonderen', from || '-'),
            kv('Alici', to || '-'),
            kv('Konu', meta.subject || '-'),
            kv('Tarih', meta.date ? formatDate(meta.date, isTR) : '-'),
            kv('Baglanti', linkCount + ' adet'),
            kv('Ekler', attachmentNames.length ? attachmentNames.join(', ') : 'Ek yok')
        ].join('')),

        section('&#128272; Kimlik Dogrulama &amp; Gonderen Itibari', [
            ...authRows.map((row) => kv(row.label, row.value)),
            kv('GONDEREN ITIBARI', senderReputation(result))
        ].join('')),

        section('&#128737;&#65039; Virüs Kontrolleri', buildVirusTotalTable(vtRows)),

        otxSection,

        section('&#128269; Tespit Edilen Tehdit Tipleri',
            '<div style="padding-top:4px">' +
            (threatTags.length
                ? threatTags.map((tag) => `<span style="display:inline-block;margin:4px 6px 4px 0;padding:7px 10px;border-radius:999px;background:#312e81;color:#c7d2fe;font-size:12px;font-weight:700">${escapeHtml(tag)}</span>`).join('')
                : '<span style="color:#94a3b8">Belirgin tehdit tipi tespit edilmedi.</span>') +
            '</div>'),

        section('&#128203; Detayli Bulgular', buildFindingsTable(detailedFindings)),

        section('&#128279; Supheli Baglantilar',
            suspiciousLinks.length
                ? suspiciousLinks.map((link) => `<div style="padding:8px 0;color:#fecaca;word-break:break-all">${escapeHtml(link)}</div>`).join('')
                : '<div style="color:#d1d5db">Supheli baglanti tespit edilmedi.</div>'),

        section('&#128161; Guvenlik Onerileri',
            '<ul style="margin:0;padding-left:20px;color:#d1d5db;font-size:14px;line-height:1.7">' +
            recommendations(result).map((item) => `<li>${escapeHtml(item)}</li>`).join('') +
            '</ul>'),

        buildAiSection(aiOpenAI, aiClaude, isTR)
    ].join('');

    // Header logosu — software brand (MailTrustAI) sabit. Müşteri firma adı
    // (companyName) ayrı bir satırda "X için" şeklinde gösterilir.
    // Email-client uyumlu (Outlook/Gmail/Zimbra/Apple Mail): inline CSS + table
    // layout; gradient destekleyen client'lar görsel olarak gösterir,
    // desteklemeyenlerde solid #1e3a8a fallback ile okunur.
    const reportTitle    = isTR ? 'GÜVENLİK RAPORU' : 'SECURITY REPORT';
    const hasCustomBrand = companyName && companyName.toLowerCase() !== 'mailtrustai';
    const customerLine   = hasCustomBrand
        ? `<div style="font-size:13px;color:#cbd5e1;margin-top:6px">${isTR ? 'Müşteri' : 'Customer'}: <strong style="color:#f1f5f9">${escapeHtml(companyName)}</strong></div>`
        : '';
    const logoBlock = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>` +
        `<td style="background:#1e3a8a;background:linear-gradient(135deg,#1e3a8a,#3b82f6 60%,#8b5cf6);width:48px;height:48px;border-radius:10px;text-align:center;vertical-align:middle;font-size:26px;line-height:48px;color:#ffffff;font-weight:900">&#128737;</td>` +
        `<td style="padding-left:14px;vertical-align:middle"><div style="font-size:18px;font-weight:800;color:#f8fafc;letter-spacing:.3px">MailTrustAI</div><div style="font-size:11px;color:#94a3b8;letter-spacing:1px;margin-top:2px">SCAN &middot; ANALYZE &middot; EVALUATE &middot; PROTECT</div></td>` +
        `</tr></table>`;

    return `<!DOCTYPE html><html lang="${isTR ? 'tr' : 'en'}"><head><meta charset="UTF-8"><title>MailTrustAI ${reportTitle}${hasCustomBrand ? ' — ' + escapeHtml(companyName) : ''}</title></head><body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;color:#e5e7eb"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;border-collapse:collapse"><tr><td valign="top" align="center" style="padding:12px 8px"><table width="760" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:760px;background:#111827;border:1px solid #263244;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 30px 22px;background:linear-gradient(135deg,#111827,#172033 58%,#24111a)">${logoBlock}<div style="font-size:24px;font-weight:800;color:#f8fafc;letter-spacing:.4px;margin-top:18px">${reportTitle}</div>${customerLine}<div style="font-size:13px;color:#94a3b8;margin-top:6px">${isTR ? 'Analiz Tarihi' : 'Analysis Date'}: ${escapeHtml(formatDate(result.timestamp || new Date(), isTR))}</div>${companyDetails ? `<div style="font-size:13px;color:#cbd5e1;margin-top:8px">${escapeHtml(companyDetails)}</div>` : ''}</td></tr><tr><td style="padding:24px 30px 8px"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="33%" style="padding:12px"><div style="border:1px solid ${color};background:${color}20;border-radius:14px;padding:16px;text-align:center"><div style="font-size:12px;color:#94a3b8;font-weight:700;letter-spacing:1px">RISK SEVIYESI</div><div style="font-size:24px;color:${color};font-weight:900;margin-top:8px">${escapeHtml(levelText)}</div></div></td><td width="33%" style="padding:12px"><div style="border:1px solid #334155;background:#0b1220;border-radius:14px;padding:16px;text-align:center"><div style="font-size:12px;color:#94a3b8;font-weight:700;letter-spacing:1px">SKOR</div><div style="font-size:24px;color:#f8fafc;font-weight:900;margin-top:8px">${score}/100</div></div></td><td width="33%" style="padding:12px"><div style="border:1px solid ${risky ? '#fb7185' : '#34d399'};background:${risky ? '#3f1420' : '#052e2b'};border-radius:14px;padding:16px;text-align:center"><div style="font-size:12px;color:#94a3b8;font-weight:700;letter-spacing:1px">SONUC</div><div style="font-size:24px;color:${risky ? '#fb7185' : '#34d399'};font-weight:900;margin-top:8px">${verdictText}</div></div></td></tr></table></td></tr><tr><td style="padding:8px 30px 20px"><div style="background:#0b1220;border:1px solid #263244;border-radius:14px;padding:18px;color:#d1d5db;font-size:14px;line-height:1.65">${escapeHtml(summary)}</div></td></tr>${sections}<tr><td style="padding:22px 30px 28px;text-align:center;color:#64748b;font-size:12px;line-height:1.6">MailTrustAI Mail Guvenlik Sistemi - Bu rapor yapay zeka ve otomatik guvenlik kontrolleri tarafindan olusturulmustur.<br>Supheli durumlarda bilgi islem birimiyle iletisime gecin.${hasCustomBrand ? `<br><br><strong>${escapeHtml(companyName)}</strong>${companyContactInfo ? ` &middot; ${escapeHtml(companyContactInfo)}` : ''}` : (companyContactInfo ? `<br><br>${escapeHtml(companyContactInfo)}` : '')}</td></tr></table></td></tr></table></body></html>`;
}

function buildAiSection(aiOpenAI, aiClaude, isTR) {
    const rows = [];

    if (aiOpenAI && (aiOpenAI.summaryTR || aiOpenAI.summaryEN)) {
        const sum = aiOpenAI.summaryTR || aiOpenAI.summaryEN || '';
        const flags = (aiOpenAI.redFlagsTR || []).slice(0, 4).map((f) =>
            `<div style="padding:6px 0;color:#fda4af;font-size:13px">&#9679; ${escapeHtml(f)}</div>`
        ).join('');
        rows.push(
            `<div style="margin-bottom:12px"><div style="font-size:12px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:6px">CHATGPT / OPENAI</div>` +
            `<div style="font-size:13px;color:#c7d2fe;line-height:1.65;margin-bottom:6px">${escapeHtml(sum)}</div>` +
            `<div style="color:#94a3b8;font-size:12px">Kategori: ${escapeHtml(aiOpenAI.category || '-')} | Tehdit: ${escapeHtml(aiOpenAI.threatLevel || '-')} | Guven: ${escapeHtml(String(aiOpenAI.confidence || 0))}%</div>` +
            (flags ? `<div style="margin-top:8px">${flags}</div>` : '') +
            `</div>`
        );
    }

    if (aiClaude) {
        // Claude returns an object: { threatLevel, category, summaryTR, summaryEN, suspiciousElements }
        if (!Array.isArray(aiClaude) && (aiClaude.summaryTR || aiClaude.summaryEN)) {
            const sum = isTR ? (aiClaude.summaryTR || aiClaude.summaryEN || '') : (aiClaude.summaryEN || aiClaude.summaryTR || '');
            const elems = (aiClaude.suspiciousElements || []).slice(0, 5).map((elem) =>
                `<div style="padding:6px 0;color:#fda4af;font-size:13px">&#9679; ${escapeHtml(String(elem || ''))}</div>`
            ).join('');
            rows.push(
                `<div style="margin-bottom:4px"><div style="font-size:12px;color:#f9a8d4;font-weight:700;letter-spacing:1px;margin-bottom:6px">CLAUDE AI (ANTHROPIC)</div>` +
                `<div style="font-size:13px;color:#c7d2fe;line-height:1.65;margin-bottom:6px">${escapeHtml(sum)}</div>` +
                `<div style="color:#94a3b8;font-size:12px">Kategori: ${escapeHtml(aiClaude.category || '-')} | Tehdit: ${escapeHtml(aiClaude.threatLevel || '-')}</div>` +
                (elems ? `<div style="margin-top:8px">${elems}</div>` : '') +
                `</div>`
            );
        } else if (Array.isArray(aiClaude) && aiClaude.length) {
            // Legacy: array of findings
            const items = aiClaude.slice(0, 5).map((f) => {
                const msg = typeof f === 'string' ? f : (f.message || '');
                const sev = typeof f === 'object' ? (f.severity || 'info') : 'info';
                const col = { critical: '#fb7185', warning: '#fbbf24', info: '#93c5fd', safe: '#34d399' }[sev] || '#93c5fd';
                return `<div style="padding:6px 0;color:${col};font-size:13px">&#9679; ${escapeHtml(msg)}</div>`;
            }).join('');
            rows.push(
                `<div><div style="font-size:12px;color:#f9a8d4;font-weight:700;letter-spacing:1px;margin-bottom:6px">CLAUDE AI (ANTHROPIC)</div>` +
                `<div style="margin-top:4px">${items}</div></div>`
            );
        }
    }

    if (!rows.length) return '';

    return `<tr><td style="padding:10px 30px"><div style="background:#0b1220;border:1px solid #263244;border-radius:14px;padding:18px"><div style="font-size:16px;font-weight:800;color:#f8fafc;margin-bottom:12px">Yapay Zeka Degerlendirmesi</div>${rows.join('<hr style="border:none;border-top:1px solid #1e293b;margin:12px 0">')}</div></td></tr>`;
}

function section(title, body) {
    return `<tr><td style="padding:10px 30px"><div style="background:#0b1220;border:1px solid #263244;border-radius:14px;padding:18px"><div style="font-size:16px;font-weight:800;color:#f8fafc;margin-bottom:12px">${title}</div>${body}</div></td></tr>`;
}

function kv(label, value) {
    return `<div style="display:flex;gap:12px;padding:5px 0;font-size:14px;line-height:1.45"><div style="min-width:130px;color:#94a3b8;font-weight:700">${escapeHtml(label)}:</div><div style="color:#e5e7eb;word-break:break-word">${escapeHtml(value)}</div></div>`;
}

function buildVirusTotalTable(rows) {
    if (!rows.length) {
        return '<div style="color:#94a3b8;font-size:14px">Virüs kontrol sonucu yok veya taranabilir ek bulunamadı.</div>';
    }

    return `<table width="100%" cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#172033;color:#cbd5e1"><th align="left">Dosya</th><th align="left">SHA-256</th><th align="left">Sonuc</th></tr></thead><tbody>${rows.map((row) => `<tr style="border-top:1px solid #263244"><td style="color:#e5e7eb">${escapeHtml(row.filename)}</td><td style="color:#94a3b8;font-family:monospace">${escapeHtml(shortHash(row.hash))}</td><td style="color:${row.danger ? '#fb7185' : row.warning ? '#fbbf24' : '#34d399'};font-weight:800">${escapeHtml(row.result)}</td></tr>${row.engines.length ? `<tr><td colspan="3" style="color:#94a3b8;font-size:12px;padding-top:0">${escapeHtml(row.engines.join(', '))}</td></tr>` : ''}`).join('')}</tbody></table>`;
}

function buildFindingsTable(rows) {
    if (!rows.length) return '<div style="color:#94a3b8;font-size:14px">Detayli bulgu yok.</div>';

    return `<table width="100%" cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#172033;color:#cbd5e1"><th align="left">Kategori</th><th align="left">Detay</th><th align="left">Ciddiyet</th></tr></thead><tbody>${rows.map((row) => `<tr style="border-top:1px solid #263244"><td style="color:#e5e7eb">${escapeHtml(row.category)}</td><td style="color:#d1d5db">${escapeHtml(row.detail)}</td><td style="color:${severityColor(row.severity)};font-weight:800">${escapeHtml(row.label)}</td></tr>`).join('')}</tbody></table>`;
}

function buildExecutiveSummary(result, isTR) {
    // AI analizi e-posta raporlarına dahil edilmez; özet bulgulardan ve VT'den üretilir

    const vtBad = (result.virusTotal || []).find((entry) => (entry.stats?.malicious || 0) > 0 || (entry.stats?.suspicious || 0) > 0);
    if (vtBad) {
        const malicious = vtBad.stats?.malicious || 0;
        const total = vtBad.stats?.total || 0;
        return `${vtBad.filename} adlı ek dosya virüs kontrolünde ${malicious}/${total} motor tarafından zararlı veya şüpheli olarak işaretlenmiştir. Bu nedenle e-posta riskli kabul edilmelidir.`;
    }

    const critical = (result.findings || []).find((finding) => finding.severity === 'critical');
    if (critical) return critical.message;

    return isTR
        ? 'E-posta basliklari, icerigi, baglantilari ve ekleri otomatik guvenlik kontrollerinden gecirilmistir.'
        : 'Email headers, content, links and attachments were checked automatically.';
}

function buildAuthRows(result) {
    const meta = result.emailMeta || {};
    return [
        { label: 'SPF', value: normalizeAuth(meta.spf?.status || result.spf?.status || result.authentication?.spf || 'bilinmiyor') },
        { label: 'DKIM', value: normalizeAuth(meta.dkim?.status || result.dkim?.status || result.authentication?.dkim || 'bilinmiyor') },
        { label: 'DMARC', value: normalizeAuth(meta.dmarc?.status || result.dmarc?.status || result.authentication?.dmarc || 'bilinmiyor') }
    ];
}

function buildVirusTotalRows(vtEntries, attachments) {
    const rows = vtEntries.map((entry) => {
        const malicious = entry.stats?.malicious || 0;
        const suspicious = entry.stats?.suspicious || 0;
        const total = entry.stats?.total || 0;
        const danger = malicious > 0;
        const warning = !danger && suspicious > 0;
        const engines = [
            ...(entry.maliciousEngines || []),
            ...(entry.suspiciousEngines || [])
        ].slice(0, 8).map((engine) => engine.engine || engine.result);
        return {
            filename: entry.filename || '-',
            hash: entry.sha256 || entry.hash || '',
            danger,
            warning,
            engines,
            result: danger
                ? `TEHLIKELI - ${malicious}/${total} motor`
                : warning
                    ? `SUPHELI - ${suspicious}/${total} motor`
                    : `TEMIZ - 0/${total} motor`
        };
    });

    for (const att of attachments || []) {
        if (!att.vtEligible && !rows.some((row) => row.filename === att.filename)) {
            rows.push({
                filename: att.filename || '-',
                hash: att.hash || '',
                danger: att.issues?.some((issue) => /gateway|dangerous|archive|mime/i.test(issue)),
                warning: true,
                engines: [att.gatewayDetection, att.imapDownloadError].filter(Boolean),
                result: att.gatewayDetection
                    ? `TEHLIKELI - ${att.gatewayDetection}`
                    : `TARANAMADI - ${att.vtSkipReason || 'icerik alinamadi'}`
            });
        }
    }

    return rows;
}

// ─── OTX İTİBAR BÖLÜMÜ ──────────────────────────────────────
function buildOtxSection(result) {
    const indicators = result.otxData?.indicators;
    if (!indicators || !indicators.length) return '';

    const hasThreats = indicators.some(i => i.verdict === 'malicious' || i.verdict === 'suspicious');
    if (!hasThreats) return '';  // Temiz ise raporda bölüm gösterme

    const rows = indicators
        .filter(i => i.verdict === 'malicious' || i.verdict === 'suspicious')
        .map(ind => {
            const typeLabel = ind.type === 'IPv4' ? 'IP' : 'Domain';
            const color = ind.verdict === 'malicious' ? '#fb7185' : '#fbbf24';
            const pulseText = ind.pulseCount ? ` — ${ind.pulseCount} pulse` : '';
            const malwareText = ind.malwareFamilies?.length ? ` | Malware: ${ind.malwareFamilies.join(', ')}` : '';
            const tagText = ind.tags?.length ? ` | [${ind.tags.slice(0, 3).join(', ')}]` : '';
            return `<tr style="border-top:1px solid #263244">` +
                `<td style="color:#e5e7eb">${escapeHtml(typeLabel)}</td>` +
                `<td style="color:#e5e7eb;font-family:monospace">${escapeHtml(ind.value)}</td>` +
                `<td style="color:${color};font-size:12px">${escapeHtml(pulseText + malwareText + tagText)}</td>` +
                `<td style="color:${color};font-weight:800">${ind.verdict === 'malicious' ? 'ZARARLII' : 'SUPHELI'}</td>` +
                `</tr>`;
        });

    if (!rows.length) return '';

    const table = `<table width="100%" cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px">` +
        `<thead><tr style="background:#172033;color:#cbd5e1"><th align="left">Tip</th><th align="left">Gosterge</th><th align="left">Detay</th><th align="left">Sonuc</th></tr></thead>` +
        `<tbody>${rows.join('')}</tbody></table>`;

    return section('&#128225; AlienVault OTX — IP/Domain Itibar', table);
}

function buildThreatTags(result) {
    const tags = new Set();
    for (const finding of result.findings || []) {
        if (finding.category === 'virusTotal' && finding.severity === 'critical') tags.add('Zararli ek dosya');
        if (finding.category === 'attachment' && finding.severity === 'critical') tags.add('Potansiyel malware');
        if (finding.category === 'link' && finding.severity !== 'safe') tags.add('Supheli baglanti');
        if (finding.category === 'ai' && /phishing|credential|fraud|bec/i.test(finding.message || '')) tags.add('Spear phishing');
        if (finding.category === 'otx' && finding.severity === 'critical') tags.add('Kotu itibarli altyapi');
        if (finding.category === 'otx' && finding.severity === 'warning') tags.add('Supheli IP/domain');
    }
    if (result.openaiAnalysis?.category) tags.add(result.openaiAnalysis.category);
    return [...tags].slice(0, 8);
}

function buildDetailedFindingRows(result) {
    return (result.findings || [])
        .filter((finding) => finding.severity !== 'safe')
        .slice(0, 18)
        .map((finding) => ({
            category: localCategory(finding.category),
            detail: finding.message,
            severity: finding.severity,
            label: localSeverity(finding.severity)
        }));
}

function recommendations(result) {
    if (isRisky(result)) {
        return [
            'Gondericiyi dogrulamadan ek dosyayi acmayiniz veya indirmeyiniz.',
            'Maili gelen kutusundan ve cop kutusundan siliniz ya da karantinaya aliniz.',
            'Gonderici kurum/kisi ile farkli bir kanaldan dogrulama yapiniz.',
            'Supheli durumda bilgi islem birimiyle iletisime geciniz.'
        ];
    }

    return [
        'Mail guvenli gorunse bile beklenmeyen ek ve linkleri dikkatli aciniz.',
        'Hassas bilgi isteyen mesajlarda gondericiyi farkli kanaldan dogrulayiniz.'
    ];
}

function isRisky(result) {
    return effectiveReportLevel(result) !== 'safe';
}

function effectiveReportLevel(result) {
    const baseLevel = result.level || 'safe';
    const baseRank = levelRank(baseLevel);
    const findingLevel = levelFromFindings(result.findings || []);
    const aiLevel = levelFromAi(result.openaiAnalysis);
    const vtLevel = levelFromVirusTotal(result.virusTotal || []);
    const otxLevel = levelFromOtx(result.otxData);
    const maxRank = Math.max(baseRank, levelRank(findingLevel), levelRank(aiLevel), levelRank(vtLevel), levelRank(otxLevel));
    return ['safe', 'low', 'medium', 'high'][maxRank] || 'safe';
}

function levelFromOtx(otxData) {
    if (!otxData?.indicators) return 'safe';
    if (otxData.indicators.some(i => i.verdict === 'malicious')) return 'high';
    if (otxData.indicators.some(i => i.verdict === 'suspicious')) return 'medium';
    return 'safe';
}

function levelFromFindings(findings) {
    if (findings.some((finding) => finding.severity === 'critical')) return 'high';
    if (findings.some((finding) => finding.severity === 'warning')) return 'low';
    return 'safe';
}

function levelFromAi(ai) {
    const threat = String(ai?.threatLevel || '').toLowerCase();
    const confidence = Number(ai?.confidence || 0);
    if ((threat === 'critical' || threat === 'high') && confidence >= 65) return 'high';
    if (threat === 'medium' && confidence >= 60) return 'medium';
    if (threat === 'low' && confidence >= 50) return 'low';
    return 'safe';
}

function levelFromVirusTotal(entries) {
    if (entries.some((entry) => (entry.stats?.malicious || 0) > 0)) return 'high';
    if (entries.some((entry) => (entry.stats?.suspicious || 0) > 0)) return 'medium';
    return 'safe';
}

function levelRank(level) {
    return { safe: 0, low: 1, medium: 2, high: 3 }[level] ?? 0;
}

function reportLevelText(level, isTR) {
    const tr = { safe: 'GUVENLI', low: 'DUSUK', medium: 'ORTA', high: 'KRITIK' };
    const en = { safe: 'SAFE', low: 'LOW', medium: 'MEDIUM', high: 'CRITICAL' };
    return (isTR ? tr : en)[level] || (isTR ? 'BILINMIYOR' : 'UNKNOWN');
}

function levelColor(level) {
    return { safe: '#34d399', low: '#facc15', medium: '#fb923c', high: '#fb7185' }[level] || '#94a3b8';
}

function severityColor(severity) {
    return { critical: '#fb7185', warning: '#fbbf24', info: '#93c5fd', safe: '#34d399' }[severity] || '#cbd5e1';
}

function localSeverity(severity) {
    return { critical: 'KRITIK', warning: 'ORTA', info: 'DUSUK', safe: 'GUVENLI' }[severity] || 'BILGI';
}

function localCategory(category) {
    return {
        attachment: 'Ek dosya',
        virusTotal: 'Virüs Kontrolleri',
        header: 'Kimlik dogrulama',
        content: 'Icerik',
        link: 'Baglantilar',
        ai: 'Yapay zeka',
        otx: 'OTX IP/Domain'
    }[category] || category || 'Genel';
}

function senderReputation(result) {
    if ((result.findings || []).some((finding) => finding.category === 'header' && finding.severity === 'critical')) return 'DUSUK';
    if ((result.findings || []).some((finding) => finding.category === 'header' && finding.severity === 'warning')) return 'ORTA';
    return 'IYI';
}

function countLinks(result) {
    const breakdown = result.breakdown || {};
    if (typeof breakdown.linkCount === 'number') return breakdown.linkCount;
    return (result.findings || []).filter((finding) => finding.category === 'link').length;
}

function normalizeAuth(value) {
    const raw = String(value || 'bilinmiyor').toLowerCase();
    if (raw === 'pass' || raw === 'valid') return 'gecerli';
    if (raw === 'fail' || raw === 'invalid') return 'basarisiz';
    return raw === 'unknown' ? 'bilinmiyor' : raw;
}

function formatAddress(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value.name ? `${value.name} <${value.address || ''}>` : (value.address || '');
}

function formatAddressList(value) {
    if (!value) return '';
    const list = Array.isArray(value) ? value : [value];
    return list.map(formatAddress).filter(Boolean).join(', ');
}

function formatDate(value, isTR) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(isTR ? 'tr-TR' : 'en-US');
}

function shortHash(value) {
    return value ? `${String(value).slice(0, 16)}...` : '-';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = { buildReportHtml, isRisky, effectiveReportLevel };
