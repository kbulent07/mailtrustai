// ============================================================
// SECURITY REPORT BUILDER
// ============================================================
const { loadSettings } = require('../storage/settingsStore');
const { validateLicenseKey } = require('../license/license');
const { getDealerWhiteLabel } = require('../storage/dealerStore');
const { levelEscalationReason } = require('../analysis/scorer');

function buildReportHtml(result, lang = 'tr') {
    const companyProfile = resolveReportProfile(result);
    const companyName = companyProfile.name || 'MailTrustAI';
    const companyDetails = companyProfile.details || '';
    const companyContactInfo = companyProfile.contactInfo || '';
    const brandAccent = /^#[0-9a-f]{6}$/i.test(companyProfile.accentColor || '') ? companyProfile.accentColor : '#7c3aed';
    const isTR = lang === 'tr';
    const meta = result.emailMeta || {};
    const findings = result.findings || [];
    const attachments = result.attachmentDetails || [];
    const vtEntries = result.virusTotal || [];
    // AI analizi e-posta raporlarına dahil edilmez (web arayüzünde gösterilir)
    const aiOpenAI = null;
    const aiClaude = null;
    const level = effectiveReportLevel(result);
    // Skor (kural motoru ham çıktısı) ve seviye (zorlanmış olabilir) ayrı
    // kalır. Fark varsa aşağıda "Sebep" satırıyla açıklanır.
    const score = Number(result.score || 0);
    const escalation = result.levelReason || levelEscalationReason(result);
    const levelText = reportLevelText(level, isTR);
    const risky = level !== 'safe';
    // E-posta raporunda gösterilecek "neden seviye yükseldi" bandı (varsa).
    // ÖNEMLI: levelText'ten SONRA tanımlanmalı — TDZ hatası önlenir.
    const escalationBanner = escalation
        ? `<tr><td style="padding:0 30px 12px"><div style="background:#1e1b4b;border:1px solid #4338ca;border-left:4px solid #818cf8;border-radius:10px;padding:12px 14px;color:#c7d2fe;font-size:13px;line-height:1.55">` +
          `<div style="font-weight:700;color:#a5b4fc;font-size:11px;letter-spacing:1px;margin-bottom:4px">&#9888;&#65039; SKOR &amp; SEVİYE FARKLILIĞI</div>` +
          `<div>Kural motoru skoru ${score}/100 (düşük) çıktı, ancak risk seviyesi <b>${escapeHtml(levelText)}</b>'a yükseltildi.</div>` +
          `<div style="margin-top:6px;color:#e0e7ff"><b>Sebep:</b> ${escapeHtml(escalation.reason)}</div>` +
          `</div></td></tr>`
        : '';
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

    // Tüm bölümleri birleştir — tek satır (Zimbra whitespace sorununu önler)
    const sections = [
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

    return `<!DOCTYPE html><html lang="${isTR ? 'tr' : 'en'}"><head><meta charset="UTF-8"><title>${escapeHtml(companyName)} Mail Guvenlik Raporu</title></head><body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;color:#e5e7eb"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;border-collapse:collapse"><tr><td valign="top" align="center" style="padding:12px 8px"><table width="760" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:760px;background:#111827;border:1px solid #263244;border-top:4px solid ${brandAccent};border-radius:18px;overflow:hidden"><tr><td style="padding:28px 30px;background:linear-gradient(135deg,#111827,#172033 58%,#24111a)"><div style="font-size:26px;font-weight:800;color:#f8fafc;letter-spacing:.4px">${escapeHtml(companyName.toUpperCase())} MAIL GUVENLIK RAPORU</div><div style="font-size:13px;color:#94a3b8;margin-top:8px">${isTR ? 'Analiz Tarihi' : 'Analysis Date'}: ${escapeHtml(formatDate(result.timestamp || new Date(), isTR))}</div>${companyDetails ? `<div style="font-size:13px;color:#cbd5e1;margin-top:8px">${escapeHtml(companyDetails)}</div>` : ''}</td></tr><tr><td style="padding:24px 30px 8px"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="33%" style="padding:12px"><div style="border:1px solid ${color};background:${color}20;border-radius:14px;padding:16px;text-align:center"><div style="font-size:12px;color:#94a3b8;font-weight:700;letter-spacing:1px">RISK SEVIYESI</div><div style="font-size:24px;color:${color};font-weight:900;margin-top:8px">${escapeHtml(levelText)}</div></div></td><td width="33%" style="padding:12px"><div style="border:1px solid #334155;background:#0b1220;border-radius:14px;padding:16px;text-align:center"><div style="font-size:12px;color:#94a3b8;font-weight:700;letter-spacing:1px">SKOR</div><div style="font-size:24px;color:#f8fafc;font-weight:900;margin-top:8px">${score}/100</div></div></td><td width="33%" style="padding:12px"><div style="border:1px solid ${risky ? '#fb7185' : '#34d399'};background:${risky ? '#3f1420' : '#052e2b'};border-radius:14px;padding:16px;text-align:center"><div style="font-size:12px;color:#94a3b8;font-weight:700;letter-spacing:1px">SONUC</div><div style="font-size:24px;color:${risky ? '#fb7185' : '#34d399'};font-weight:900;margin-top:8px">${verdictText}</div></div></td></tr></table></td></tr>${escalationBanner}<tr><td style="padding:8px 30px 20px"><div style="background:#0b1220;border:1px solid #263244;border-radius:14px;padding:18px;color:#d1d5db;font-size:14px;line-height:1.65">${escapeHtml(summary)}</div></td></tr>${sections}<tr><td style="padding:22px 30px 28px;text-align:center;color:#64748b;font-size:12px;line-height:1.6">${escapeHtml(companyName)} Mail Guvenlik Sistemi - Bu rapor yapay zeka ve otomatik guvenlik kontrolleri tarafindan olusturulmustur.<br>Supheli durumlarda bilgi islem birimiyle iletisime gecin.${companyContactInfo ? `<br><br>${escapeHtml(companyContactInfo)}` : ''}</td></tr></table></td></tr></table></body></html>`;
}

function resolveReportProfile(result = {}) {
    const settingsProfile = loadSettings().companyProfile || {};
    const whiteLabel = result.whiteLabelProfile || resolveWhiteLabelFromLicense(result) || {};
    if (whiteLabel.enabled !== false && whiteLabel.name) {
        return {
            ...settingsProfile,
            ...whiteLabel
        };
    }
    return settingsProfile;
}

function resolveWhiteLabelFromLicense(result = {}) {
    const key = String(result.licenseKey || result.license?.key || '').trim();
    if (!key) return null;
    const validation = validateLicenseKey(key);
    if (!validation.valid || !validation.reseller || validation.reseller === 'DIRECT' || validation.reseller === 'TRIAL') {
        return null;
    }
    const profile = getDealerWhiteLabel(validation.reseller);
    return profile?.enabled ? profile : null;
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
                `<td style="color:${color};font-weight:800">${ind.verdict === 'malicious' ? 'ZARARLI' : 'SUPHELI'}</td>` +
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

// Tek doğruluk kaynağı: scorer.effectiveLevelFromResult — analizör de bunu
// kullanarak result.level'i hesaplıyor; böylece web UI ile e-posta raporu
// her zaman aynı seviyeyi gösterir.
const { effectiveLevelFromResult } = require('../analysis/scorer');
function effectiveReportLevel(result) {
    return effectiveLevelFromResult(result || {});
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
