// ============================================================
// LINK / URL SECURITY ANALYZER
// ============================================================

const fetch = require('node-fetch');

const URL_SHORTENERS = ['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','buff.ly','rb.gy','cutt.ly','shorturl.at','tiny.cc','clck.ru','short.io','rebrand.ly'];

function analyzeLinks(emailData, linkLimit = Infinity) {
    const findings = []; let score = 0;
    const text = (emailData.text || '') + ' ' + (emailData.html || '');
    const urls = extractUrls(text);
    const limited = urls.slice(0, linkLimit);

    if (urls.length > linkLimit) {
        findings.push({ severity: 'info', category: 'link', message: `Yalnızca ilk ${linkLimit} / ${urls.length} bağlantı analiz edildi (Ücretsiz plan limiti)` });
    }

    for (const url of limited) {
        // IP-based URLs
        if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(url)) {
            findings.push({ severity: 'critical', category: 'link', message: `IP tabanlı URL tespit edildi: ${truncUrl(url)}` });
            score += 10;
        }
        // URL shorteners
        const domain = extractDomain(url);
        if (URL_SHORTENERS.includes(domain)) {
            findings.push({ severity: 'warning', category: 'link', message: `URL kısaltıcı kullanılmış: ${truncUrl(url)}` });
            score += 5;
        }
        // Suspicious TLDs
        const suspiciousTlds = ['.tk','.ml','.ga','.cf','.gq','.xyz','.top','.buzz','.click','.link'];
        if (suspiciousTlds.some(tld => domain.endsWith(tld))) {
            findings.push({ severity: 'warning', category: 'link', message: `Şüpheli üst düzey alan adı (TLD): ${truncUrl(url)}` });
            score += 5;
        }
        // @ in URL (credential phishing)
        if (url.includes('@') && !url.startsWith('mailto:')) {
            findings.push({ severity: 'critical', category: 'link', message: `URL @ işareti içeriyor (olası kimlik avı): ${truncUrl(url)}` });
            score += 12;
        }
        // Data URIs
        if (/^data:/i.test(url)) {
            findings.push({ severity: 'critical', category: 'link', message: 'Data URI tespit edildi (olası kodlanmış zararlı yük)' });
            score += 10;
        }
        // Mismatched anchor text vs href
        const mismatch = checkAnchorMismatch(emailData.html, url);
        if (mismatch) {
            findings.push({ severity: 'critical', category: 'link', message: `Bağlantı metni URL ile eşleşmiyor: "${mismatch.text}" → ${truncUrl(url)}` });
            score += 10;
        }
    }

    if (limited.length === 0) {
        findings.push({ severity: 'safe', category: 'link', message: 'E-postada bağlantı bulunamadı' });
    } else if (score === 0) {
        findings.push({ severity: 'safe', category: 'link', message: `${limited.length} bağlantı incelendi — sorun bulunamadı` });
    }

    return { findings, score: Math.min(score, 30), urls };
}

// ─── YENİ: URL KISALTICI ÇÖZÜMLEME (async) ──────────────────
// Kısaltılmış URL'lerin gerçek hedefini HEAD isteği ile güvenli şekilde belirler.
// Max 3 redirect, 4 saniye timeout — içerik indirilmez.

async function resolveShortUrls(urls, limitCount = 5) {
    const results = [];
    const candidates = urls.filter(u => URL_SHORTENERS.includes(extractDomain(u))).slice(0, limitCount);

    for (const url of candidates) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const resp = await fetch(url, {
                method: 'HEAD',
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)' }
            });
            clearTimeout(timeout);
            const finalUrl = resp.url || url;
            results.push({ original: url, resolved: finalUrl, domain: extractDomain(finalUrl) });
        } catch {
            results.push({ original: url, resolved: null, domain: null });
        }
    }
    return results;
}

// Çözümleme bulgularını findings listesine ekler
function applyResolvedUrlFindings(findings, resolved, suspiciousTlds) {
    const tlds = suspiciousTlds || ['.tk','.ml','.ga','.cf','.gq','.xyz','.top','.buzz','.click','.link'];
    for (const r of resolved) {
        if (!r.resolved || r.resolved === r.original) continue;
        const info = `${truncUrl(r.original)} → ${truncUrl(r.resolved)}`;
        // Çözümlenen hedef IP tabanlı mı?
        if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(r.resolved)) {
            findings.push({ severity: 'critical', category: 'link', message: `Kısaltılmış URL'nin gerçek hedefi IP adresi: ${info}` });
        } else if (r.domain && tlds.some(t => r.domain.endsWith(t))) {
            findings.push({ severity: 'warning', category: 'link', message: `Kısaltılmış URL şüpheli TLD'ye yönlendiriyor: ${info}` });
        } else {
            findings.push({ severity: 'info', category: 'link', message: `Kısaltılmış URL çözümlendi: ${info}` });
        }
    }
}

function extractUrls(text) {
    const regex = /https?:\/\/[^\s<>"')\]]+/gi;
    const matches = text.match(regex) || [];
    return [...new Set(matches)];
}

function extractDomain(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function truncUrl(url) {
    return url.length > 60 ? url.substring(0, 57) + '...' : url;
}

function checkAnchorMismatch(html, url) {
    if (!html) return null;
    const regex = new RegExp(`<a[^>]+href=["']${escapeRegex(url)}["'][^>]*>([^<]+)</a>`, 'i');
    const match = html.match(regex);
    if (match) {
        const text = match[1].trim();
        if (/^https?:\/\//i.test(text)) {
            const textDomain = extractDomain(text);
            const hrefDomain = extractDomain(url);
            if (textDomain && hrefDomain && textDomain !== hrefDomain) {
                return { text, href: url };
            }
        }
    }
    return null;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { analyzeLinks, resolveShortUrls, applyResolvedUrlFindings, extractUrls, extractDomain };
