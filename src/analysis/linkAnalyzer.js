// ============================================================
// LINK / URL SECURITY ANALYZER
//
// False-positive azaltma stratejisi:
//   - Sender domain ile aynı yere giden linkler nötr (info, +0)
//   - Allowlist domain'lere giden linkler nötr
//   - Aynı domain için her uyarı yalnızca 1 kez puan ekler (dedup)
//   - TLD/shortener cezası kategori başına en fazla 1 kez (cap)
//   - Image-only anchor'lar farklı bağlamda değerlendirilir
//
// Gerçek tehdit yakalama:
//   - Brand typosquat (paypa1.com vs paypal.com — Levenshtein ≤ 1-2)
//   - Image-link mismatch: <a href="X"><img src="Y"></a> X ≠ Y
//     ve X bilinmedik/tehlikeli ise critical (clickable image trap)
//   - Anchor text'te bilinen marka adı ama href farklı brand → critical
//   - IP-tabanlı URL, @ içeren URL, data URI — kritik (eski mantık)
// ============================================================
const fetch = require('node-fetch');

const URL_SHORTENERS  = ['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','buff.ly','rb.gy','cutt.ly','shorturl.at','tiny.cc','clck.ru','short.io','rebrand.ly'];
const SUSPICIOUS_TLDS = ['.tk','.ml','.ga','.cf','.gq','.xyz','.top','.buzz','.click','.link','.zip','.review','.country','.cricket','.science','.work','.support','.party'];

// Allowlist erişimi opsiyonel — modülün tek başına test edilebilmesi için
// require'ı try-catch ile sarıyoruz.
let _isAllowlisted = () => false;
try { _isAllowlisted = require('../storage/allowlistStore').isAllowlisted; } catch {}

let _getBrandDomains = () => [];
try { _getBrandDomains = require('../storage/patternStore').getBrandDomains; } catch {}

function analyzeLinks(emailData, linkLimit = Infinity) {
    const findings = []; let score = 0;
    const html = emailData.html || '';
    const text = (emailData.text || '') + ' ' + html;
    const urls = extractUrls(text);
    const limited = urls.slice(0, linkLimit);

    // Gönderici domain'i — kendi domain'ine giden linkleri nötr say
    const senderEmail  = (emailData.from?.[0]?.address || '').toLowerCase();
    const senderDomain = senderEmail.split('@')[1] || '';

    if (urls.length > linkLimit) {
        findings.push({ severity: 'info', category: 'link', message: `Yalnızca ilk ${linkLimit} / ${urls.length} bağlantı analiz edildi (Ücretsiz plan limiti)` });
    }

    // ─── Image-anchor tuzakları (HTML body) ─────────────────
    // <a href="X"><img src="Y" /></a> kalıbında href ≠ img-domain
    const imageAnchorTraps = findImageAnchorTraps(html, senderDomain);
    for (const trap of imageAnchorTraps) {
        findings.push({
            severity: 'critical', category: 'link',
            message: `Görsele tıklandığında farklı/şüpheli bir adrese yönlendiriyor: img=${truncUrl(trap.imgSrc)} → href=${truncUrl(trap.href)}`
        });
        score += 14;
    }

    // ─── Anchor text içinde marka adı varsa href farklı domain mi? ─
    // "PayPal" yazıyor ama href "phish.tk" → critical
    const brandMismatches = findBrandTextMismatch(html);
    for (const mm of brandMismatches) {
        findings.push({
            severity: 'critical', category: 'link',
            message: `Bağlantı metninde marka adı geçiyor (${mm.brand}) ancak hedef başka domain: ${truncUrl(mm.href)}`
        });
        score += 14;
    }

    // ─── Brand typosquat tespiti ─────────────────────────────
    // paypa1.com vs paypal.com — Levenshtein ≤ 2, eşit değil
    const brandList   = _getBrandDomains() || [];
    const brandHits   = new Set();           // dedup
    for (const url of limited) {
        const dom = extractDomain(url);
        if (!dom) continue;
        const ts = detectTyposquat(dom, brandList);
        if (ts && !brandHits.has(ts.fakeDomain)) {
            brandHits.add(ts.fakeDomain);
            findings.push({
                severity: 'critical', category: 'link',
                message: `Olası marka taklidi (typosquat): ${ts.fakeDomain} ≈ ${ts.realDomain} (mesafe ${ts.distance})`
            });
            score += 18;
        }
    }

    // ─── Per-link kontroller — domain-bazlı dedup ───────────
    const domainSeen   = new Set(); // her bir kontrol için "domain başına 1 kez"
    let tldHitCount    = 0;
    let shortenerCount = 0;
    let neutralCount   = 0;

    for (const url of limited) {
        const domain = extractDomain(url);

        // Sender domain veya allowlist → nötr (info, +0)
        const sameAsSender = senderDomain && (domain === senderDomain || domain.endsWith('.' + senderDomain));
        const allowlisted  = _isAllowlisted(domain) || _isAllowlisted(url);
        if (sameAsSender || allowlisted) {
            neutralCount++;
            continue;
        }

        // IP-tabanlı URL — her seferinde puan ekle (gerçek tehdit)
        if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(url)) {
            const k = `ip:${domain}`;
            if (!domainSeen.has(k)) {
                domainSeen.add(k);
                findings.push({ severity: 'critical', category: 'link', message: `IP tabanlı URL tespit edildi: ${truncUrl(url)}` });
                score += 10;
            }
            continue;
        }

        // @ in URL — credential phishing trick (her zaman critical)
        if (url.includes('@') && !url.startsWith('mailto:')) {
            const k = `at:${domain}`;
            if (!domainSeen.has(k)) {
                domainSeen.add(k);
                findings.push({ severity: 'critical', category: 'link', message: `URL @ işareti içeriyor (olası kimlik avı): ${truncUrl(url)}` });
                score += 12;
            }
            continue;
        }

        // Data URI
        if (/^data:/i.test(url)) {
            const k = 'data-uri';
            if (!domainSeen.has(k)) {
                domainSeen.add(k);
                findings.push({ severity: 'critical', category: 'link', message: 'Data URI tespit edildi (olası kodlanmış zararlı yük)' });
                score += 10;
            }
            continue;
        }

        // URL shortener — domain başına 1 kez, toplam max 2
        if (URL_SHORTENERS.includes(domain)) {
            const k = `short:${domain}`;
            if (!domainSeen.has(k) && shortenerCount < 2) {
                domainSeen.add(k);
                shortenerCount++;
                findings.push({ severity: 'warning', category: 'link', message: `URL kısaltıcı kullanılmış: ${truncUrl(url)}` });
                score += 5;
            }
            continue;
        }

        // Suspicious TLD — domain başına 1 kez, toplam max 2 (cap)
        if (SUSPICIOUS_TLDS.some(tld => domain.endsWith(tld))) {
            const k = `tld:${domain}`;
            if (!domainSeen.has(k) && tldHitCount < 2) {
                domainSeen.add(k);
                tldHitCount++;
                findings.push({ severity: 'warning', category: 'link', message: `Şüpheli üst düzey alan adı (TLD): ${truncUrl(url)}` });
                score += 5;
            }
            continue;
        }

        // Mismatched anchor text vs href (text=URL ama farklı domain)
        const mismatch = checkAnchorMismatch(html, url);
        if (mismatch) {
            const k = `mm:${domain}`;
            if (!domainSeen.has(k)) {
                domainSeen.add(k);
                findings.push({ severity: 'critical', category: 'link', message: `Bağlantı metni URL ile eşleşmiyor: "${truncUrl(mismatch.text)}" → ${truncUrl(url)}` });
                score += 10;
            }
        }
    }

    if (limited.length === 0) {
        findings.push({ severity: 'safe', category: 'link', message: 'E-postada bağlantı bulunamadı' });
    } else if (score === 0) {
        const note = neutralCount > 0
            ? `${limited.length} bağlantı incelendi (${neutralCount} güvenilir liste/gönderen domaini) — sorun bulunamadı`
            : `${limited.length} bağlantı incelendi — sorun bulunamadı`;
        findings.push({ severity: 'safe', category: 'link', message: note });
    }

    return { findings, score: Math.min(score, 30), urls };
}

// ─── URL KISALTICI ÇÖZÜMLEME (async) ────────────────────────
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

function applyResolvedUrlFindings(findings, resolved, suspiciousTlds) {
    const tlds = suspiciousTlds || SUSPICIOUS_TLDS;
    for (const r of resolved) {
        if (!r.resolved || r.resolved === r.original) continue;
        const info = `${truncUrl(r.original)} → ${truncUrl(r.resolved)}`;
        if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(r.resolved)) {
            findings.push({ severity: 'critical', category: 'link', message: `Kısaltılmış URL'nin gerçek hedefi IP adresi: ${info}` });
        } else if (r.domain && tlds.some(t => r.domain.endsWith(t))) {
            findings.push({ severity: 'warning', category: 'link', message: `Kısaltılmış URL şüpheli TLD'ye yönlendiriyor: ${info}` });
        } else {
            findings.push({ severity: 'info', category: 'link', message: `Kısaltılmış URL çözümlendi: ${info}` });
        }
    }
}

// ─── IMAGE-ANCHOR TUZAĞI TESPİTİ ────────────────────────────
/**
 * HTML body'de <a href="X"><img src="Y"></a> kalıbı arar.
 * href domain'i ile img domain'i farklı VE href şüpheli bir hedef ise
 * "clickable image trap" olarak işaretlenir.
 */
function findImageAnchorTraps(html, senderDomain) {
    if (!html) return [];
    const traps = [];
    // Anchor + içinde img kalıbı (kabaca; HTML parse değil regex ile)
    const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>\s*(?:<[^>]+>\s*)*<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
    const seen = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
        const href = m[1].trim();
        const src  = m[2].trim();
        if (!/^https?:\/\//i.test(href)) continue; // mailto:, javascript:, # vb. atla

        const hrefDomain = extractDomain(href);
        const srcDomain  = extractDomain(src);
        if (!hrefDomain || hrefDomain === srcDomain) continue;
        // Sender domain'e gidiyorsa nötr (kendi sayfaları)
        if (senderDomain && (hrefDomain === senderDomain || hrefDomain.endsWith('.' + senderDomain))) continue;

        // Riski belirleme: href belirgin şüpheli özelliklerden biriyse trap say
        const isShortened = URL_SHORTENERS.includes(hrefDomain);
        const isSuspTld   = SUSPICIOUS_TLDS.some(t => hrefDomain.endsWith(t));
        const hasIp       = /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(href);
        const hasAt       = href.includes('@');

        if (isShortened || isSuspTld || hasIp || hasAt) {
            const key = `${hrefDomain}|${srcDomain}`;
            if (!seen.has(key)) {
                seen.add(key);
                traps.push({ href, imgSrc: src, hrefDomain, srcDomain });
            }
        }
    }
    return traps;
}

// ─── ANCHOR TEXT MARKA ADI MISMATCH ─────────────────────────
/**
 * <a href="phish.tk">PayPal Hesabınız</a> gibi anchor'larda
 * text içindeki marka adı ile href domain'inin uyuşmadığı durumları yakalar.
 */
function findBrandTextMismatch(html) {
    if (!html) return [];
    const matches = [];
    const brands  = _getBrandDomains() || [];
    if (!brands.length) return matches;

    const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
        const href = m[1].trim();
        if (!/^https?:\/\//i.test(href)) continue;
        const hrefDomain = extractDomain(href);
        if (!hrefDomain) continue;

        // Anchor text'i sadeleştir (HTML tag'leri sil)
        const textPlain = m[2].replace(/<[^>]+>/g, ' ').trim().toLowerCase();
        if (!textPlain || textPlain.length > 200) continue;

        for (const [brandDomain, alias] of brands) {
            const aliasLc = String(alias).toLowerCase();
            if (!aliasLc) continue;
            // Marka adı text içinde geçiyor mu? (kelime sınırı)
            const brandRe = new RegExp(`\\b${aliasLc}\\b`, 'i');
            if (!brandRe.test(textPlain)) continue;
            // href bu brand'in domain'ine veya altdomain'ine gidiyor mu?
            if (hrefDomain === brandDomain || hrefDomain.endsWith('.' + brandDomain)) continue;
            // Mismatch
            const key = `${aliasLc}|${hrefDomain}`;
            if (!seen.has(key)) {
                seen.add(key);
                matches.push({ brand: aliasLc, href, hrefDomain, expectedDomain: brandDomain });
            }
            break; // bir brand match yeterli
        }
    }
    return matches;
}

// ─── BRAND TYPOSQUAT TESPİTİ ────────────────────────────────
/**
 * Verilen domain bilinmeyen ama bilinen marka domain'lerinden birine
 * Levenshtein mesafesi ≤ 2 (ama 0 değil) ise typosquat varsay.
 */
function detectTyposquat(domain, brandList) {
    if (!domain) return null;
    // Eğer zaten bilinen brand domain ise OK
    for (const [brandDomain] of brandList) {
        if (domain === brandDomain || domain.endsWith('.' + brandDomain)) return null;
    }
    // Yakın mesafe arama (eTLD+1 / ana label karşılaştırması)
    const candidate = mainLabel(domain); // "paypa1" of "paypa1.com"
    let best = null;
    for (const [brandDomain] of brandList) {
        const real = mainLabel(brandDomain);
        if (!real || !candidate || real.length < 4 || candidate.length < 4) continue;
        const d = levenshtein(candidate, real);
        if (d > 0 && d <= 2 && (!best || d < best.distance)) {
            best = { fakeDomain: domain, realDomain: brandDomain, distance: d };
        }
    }
    return best;
}

function mainLabel(domain) {
    if (!domain) return '';
    const parts = domain.split('.');
    if (parts.length < 2) return parts[0] || '';
    return parts[parts.length - 2] || '';
}

function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    if (Math.abs(m - n) > 3) return 99; // erken çıkış
    const prev = new Array(n + 1).fill(0);
    const curr = new Array(n + 1).fill(0);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }
    return prev[n];
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

module.exports = {
    analyzeLinks, resolveShortUrls, applyResolvedUrlFindings,
    extractUrls, extractDomain,
    // Test/debug için iç fonksiyonlar export ediliyor
    detectTyposquat, findImageAnchorTraps, findBrandTextMismatch, levenshtein
};
