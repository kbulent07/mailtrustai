// ============================================================
// ALIENVAULT OTX — THREAT REPUTATION MODULE
// IP adresi ve domain itibar sorgulama.
// Ücretsiz OTX API — kayıt için: otx.alienvault.com
//
// Sorgulanan göstergeler:
//   • E-posta aktarım zincirinden (Received headers) alınan genel IP'ler
//   • Gönderici domaini
//   • E-posta gövdesindeki linklerin domain'leri (ilk 5)
//
// OTX Yanıt Yorumlama:
//   pulse_info.count ≥ 10 → kritik tehdit istihbaratı
//   pulse_info.count 3-9  → uyarı
//   pulse_info.count 1-2  → bilgi
//   reputation < -50      → itibarı düşük, kritik
// ============================================================
const { getCachedResult, setCachedResult } = require('../storage/otxCacheStore');

const OTX_BASE = 'https://otx.alienvault.com/api/v1/indicators';

// RFC 1918 / loopback / link-local özel IP bloklarını atla
const PRIVATE_RANGES = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
    /^0\./
];

// ─── OTX FALSE-POSITIVE WHITELIST ─────────────────────────────
// AlienVault OTX'in pulse veritabanı:
//  • Araştırmacılar pulse'lara test/karşılaştırma için popüler domain'leri ekler
//  • Mirai/Tofsee gibi botnet'ler "internet bağlantı kontrolü" amacıyla
//    google/youtube/microsoft.com'a sorgu atar — bu pulse'larda görünür
//  • Sonuç: youtube.com 50+ pulse alıyor → false positive
//
// Aşağıdaki domain'ler için OTX sorgusu atlanır (gerçek tehdit kaynağı
// değildirler; e-posta context'inde bu domain'in geçmesi tehdit göstergesi
// sayılmaz). Listeyi makul tutuyoruz; yine de typosquat / impersonation
// linkAnalyzer tarafından yakalanır.
const OTX_DOMAIN_WHITELIST = new Set([
    // Google ekosistemi
    'google.com', 'gmail.com', 'googlemail.com', 'youtube.com', 'youtu.be',
    'google.com.tr', 'googleusercontent.com', 'gstatic.com', 'doubleclick.net',
    // Microsoft
    'microsoft.com', 'office.com', 'office365.com', 'outlook.com', 'live.com',
    'hotmail.com', 'msn.com', 'bing.com', 'sharepoint.com', 'onedrive.live.com',
    'azure.com', 'azureedge.net', 'windows.net', 'microsoftonline.com',
    // Apple
    'apple.com', 'icloud.com', 'me.com', 'mac.com',
    // Sosyal medya / mesajlaşma
    'facebook.com', 'fb.com', 'fbcdn.net', 'instagram.com', 'whatsapp.com',
    'messenger.com', 'twitter.com', 'x.com', 'twimg.com', 'linkedin.com',
    'licdn.com', 'tiktok.com', 'snapchat.com', 'pinterest.com', 'reddit.com',
    'discord.com', 'discordapp.com', 'telegram.org', 't.me',
    // Bulut / dev
    'amazon.com', 'amazonaws.com', 'cloudfront.net', 'github.com',
    'githubusercontent.com', 'gitlab.com', 'bitbucket.org',
    'cloudflare.com', 'dropbox.com', 'box.com', 'wetransfer.com',
    'zoom.us', 'webex.com', 'teams.microsoft.com',
    // E-ticaret / ödeme (legitimate hostname'ler)
    'paypal.com', 'stripe.com', 'shopify.com', 'wix.com', 'wordpress.com',
    'godaddy.com', 'namecheap.com',
    // Türkiye yaygın servisler
    'yandex.com', 'yandex.com.tr', 'yandex.ru',
    'turkiye.gov.tr', 'gib.gov.tr', 'sgk.gov.tr', 'pttsepet.com', 'ptt.gov.tr',
    'trendyol.com', 'hepsiburada.com', 'n11.com', 'gittigidiyor.com',
    'sahibinden.com', 'arabam.com',
    'turkcell.com.tr', 'turktelekom.com.tr', 'vodafone.com.tr',
    'ziraatbank.com.tr', 'isbank.com.tr', 'garantibbva.com.tr', 'akbank.com',
    'yapikredi.com.tr', 'halkbank.com.tr', 'vakifbank.com.tr',
    // Diğer popüler/CDN
    'wikipedia.org', 'wikimedia.org', 'mozilla.org', 'firefox.com',
    'adobe.com', 'salesforce.com', 'jsdelivr.net', 'unpkg.com', 'jquery.com',
    'fontawesome.com', 'googletagmanager.com', 'google-analytics.com',
    'mailchimp.com', 'sendgrid.net', 'mailgun.org', 'sendpulse.com',
    // Standart/namespace URI'ları (mail HTML'inde sık geçer, OTX'te gürültülü)
    'w3.org', 'ietf.org', 'iana.org', 'rfc-editor.org',
    'schema.org', 'json-schema.org', 'opensearch.org',
    // AI / büyük tech ürün servisleri
    'anthropic.com', 'claude.ai', 'openai.com', 'chatgpt.com',
    'huggingface.co'
]);

function isOtxWhitelisted(value) {
    const v = String(value || '').toLowerCase().replace(/^www\./, '').trim();
    if (!v) return false;
    if (OTX_DOMAIN_WHITELIST.has(v)) return true;
    // subdomain match: x.youtube.com → youtube.com whitelisted
    const parts = v.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join('.');
        if (OTX_DOMAIN_WHITELIST.has(candidate)) return true;
    }
    return false;
}

function isPrivateIp(ip) {
    return PRIVATE_RANGES.some(r => r.test(ip));
}

// ─── TEK GÖSTERGE SORGUSU ────────────────────────────────────
async function queryIndicator(type, value, apiKey) {
    const key = `${type}:${value}`;
    const cached = getCachedResult(key);
    if (cached) {
        console.log(`[OTX] Önbellekten döndü: ${key}`);
        return { ...cached, fromCache: true };
    }

    const endpoint = type === 'IPv4'
        ? `${OTX_BASE}/IPv4/${encodeURIComponent(value)}/general`
        : type === 'url'
            ? `${OTX_BASE}/url/${encodeURIComponent(value)}/general`
            : `${OTX_BASE}/domain/${encodeURIComponent(value)}/general`;

    try {
        const res = await fetch(endpoint, {
            headers: {
                'X-OTX-API-KEY': apiKey,
                'Accept': 'application/json',
                'User-Agent': 'MailTrustAI/1.0'
            },
            signal: AbortSignal.timeout(10000)  // 10s timeout
        });

        if (res.status === 401) return { error: 'OTX API anahtarı geçersiz', value, type };
        if (res.status === 404) return { found: false, value, type, pulseCount: 0, reputation: 0 };
        if (res.status === 429) return { error: 'OTX rate limit — daha sonra tekrar deneyin', value, type };
        if (!res.ok) return { error: `OTX API hata: HTTP ${res.status}`, value, type };

        const data = await res.json();

        const result = {
            found:          true,
            value,
            type,
            pulseCount:     data.pulse_info?.count || 0,
            reputation:     data.reputation || 0,
            countryCode:    data.country_code || null,
            asn:            data.asn || null,
            // İlk 5 pulse'tan tehdit etiketlerini ve malware ailelerini çıkar
            tags:           extractTags(data.pulse_info?.pulses || []),
            malwareFamilies: extractMalwareFamilies(data.pulse_info?.pulses || []),
            // Doğrudan OTX bağlantısı
            otxLink: type === 'IPv4'
                ? `https://otx.alienvault.com/indicator/ip/${value}`
                : `https://otx.alienvault.com/indicator/domain/${value}`
        };

        // Başarılı sonucu önbelleğe al
        setCachedResult(key, result);
        return result;

    } catch (e) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
            return { error: 'OTX sorgusu zaman aşımına uğradı (10s)', value, type };
        }
        return { error: e.message, value, type };
    }
}

function extractTags(pulses) {
    const tagSet = new Set();
    for (const p of pulses.slice(0, 5)) {
        for (const t of (p.tags || [])) {
            if (t) tagSet.add(String(t).toLowerCase().trim());
        }
    }
    return [...tagSet].slice(0, 10);
}

function extractMalwareFamilies(pulses) {
    const familySet = new Set();
    for (const p of pulses.slice(0, 5)) {
        for (const mf of (p.malware_families || [])) {
            if (mf?.display_name) familySet.add(mf.display_name);
        }
    }
    return [...familySet].slice(0, 5);
}

// ─── SKOR VE VERDICT ─────────────────────────────────────────
function verdictFromResult(r) {
    if (r.error || r.found === false) return 'unknown';
    const pc = r.pulseCount || 0;
    const rep = r.reputation || 0;

    if (pc >= 10 || rep < -50)  return 'malicious';
    if (pc >= 3  || rep < -20)  return 'suspicious';
    if (pc >= 1)                return 'info';
    return 'clean';
}

function severityFromVerdict(v) {
    if (v === 'malicious')  return 'critical';
    if (v === 'suspicious') return 'warning';
    if (v === 'info')       return 'info';
    return 'safe';
}

function scoreFromVerdict(v) {
    if (v === 'malicious')  return 15;
    if (v === 'suspicious') return 8;
    if (v === 'info')       return 3;
    return 0;
}

// ─── E-POSTA GÖSTERGELERİNİ ÇIKAR ──────────────────────────
/**
 * E-posta parse verisinden sorgulanacak IP, domain ve URL listesi çıkarır.
 * - receivedHeaders: aktarım zincirindeki genel IP'ler
 * - from[0].address: gönderici domaini
 * - links: içerikteki linklerin domainleri (domain tipi) + tam URL'ler (url tipi, ilk 3)
 */
function extractIndicators(parsedData, linkUrls = []) {
    const indicators = [];
    const seenIps     = new Set();
    const seenDomains = new Set();
    const seenUrls    = new Set();

    // 1) Received header IP'leri
    for (const header of (parsedData.receivedHeaders || [])) {
        const ipMatches = String(header).matchAll(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/g);
        for (const m of ipMatches) {
            const ip = m[1];
            if (!isPrivateIp(ip) && !seenIps.has(ip)) {
                seenIps.add(ip);
                indicators.push({ type: 'IPv4', value: ip });
            }
        }
    }

    // 2) Gönderici domaini (whitelist'tekiler atlanır → false-positive önle)
    const senderAddr = parsedData.from?.[0]?.address || '';
    const senderDomain = senderAddr.split('@')[1]?.toLowerCase().trim();
    if (senderDomain && !seenDomains.has(senderDomain) && !isOtxWhitelisted(senderDomain)) {
        seenDomains.add(senderDomain);
        indicators.push({ type: 'domain', value: senderDomain });
    }

    // 3a) Link domain'leri (domain tipi — ilk 5; whitelist filtreli)
    for (const url of (linkUrls || []).slice(0, 5)) {
        try {
            const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
            if (!hostname || seenDomains.has(hostname) || hostname === senderDomain) continue;
            if (isOtxWhitelisted(hostname)) continue; // youtube/google/microsoft vb. atla
            seenDomains.add(hostname);
            indicators.push({ type: 'domain', value: hostname });
        } catch { /* geçersiz URL */ }
    }

    // 3b) Tam URL sorgusu (url tipi — ilk 3; whitelist host filtreli)
    for (const url of (linkUrls || []).slice(0, 3)) {
        try {
            const clean = url.trim();
            // Sadece http/https URL'leri; veri URL'leri ve mailto'ları atla
            if (!clean || !/^https?:\/\//i.test(clean)) continue;
            const hostname = new URL(clean).hostname.toLowerCase().replace(/^www\./, '');
            if (isOtxWhitelisted(hostname)) continue;
            const normalised = clean.split('#')[0].replace(/\/+$/, ''); // fragment ve trailing slash sil
            if (!seenUrls.has(normalised)) {
                seenUrls.add(normalised);
                indicators.push({ type: 'url', value: normalised });
            }
        } catch { /* geçersiz URL */ }
    }

    // Toplam sınır: 10 gösterge (IP + domain + url)
    return indicators.slice(0, 10);
}

// ─── ANA TARAMA FONKSİYONU ──────────────────────────────────
/**
 * E-postadan çıkarılan tüm IP ve domain'leri OTX'e sorgular.
 * Paralel istekler gönderir (Promise.allSettled).
 * @returns {Promise<{indicators: Array, summary: Object, totalScore: number}>}
 */
async function checkEmailIndicators(parsedData, apiKey, linkUrls = []) {
    if (!apiKey) return { indicators: [], summary: { total: 0 }, totalScore: 0 };

    const toQuery = extractIndicators(parsedData, linkUrls);
    if (!toQuery.length) return { indicators: [], summary: { total: 0 }, totalScore: 0 };

    console.log(`[OTX] ${toQuery.length} gösterge sorgulanıyor...`);

    const settled = await Promise.allSettled(
        toQuery.map(({ type, value }) => queryIndicator(type, value, apiKey))
    );

    const indicators = settled.map((res, i) => {
        if (res.status === 'rejected') {
            return { ...toQuery[i], error: res.reason?.message || 'Promise rejected', verdict: 'unknown' };
        }
        const r = res.value;
        const verdict = verdictFromResult(r);
        return { ...r, verdict };
    });

    const maliciousCount  = indicators.filter(i => i.verdict === 'malicious').length;
    const suspiciousCount = indicators.filter(i => i.verdict === 'suspicious').length;
    const totalScore      = indicators.reduce((acc, i) => acc + scoreFromVerdict(i.verdict), 0);

    const summary = {
        total:      indicators.length,
        malicious:  maliciousCount,
        suspicious: suspiciousCount,
        clean:      indicators.filter(i => i.verdict === 'clean').length,
        unknown:    indicators.filter(i => i.verdict === 'unknown').length
    };

    return { indicators, summary, totalScore: Math.min(totalScore, 30) };
}

module.exports = {
    checkEmailIndicators,
    queryIndicator,
    verdictFromResult,
    severityFromVerdict,
    scoreFromVerdict,
    // Test/debug + dış kullanım için
    isOtxWhitelisted,
    extractIndicators,
    OTX_DOMAIN_WHITELIST
};
