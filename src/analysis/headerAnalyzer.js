// ============================================================
// HEADER SECURITY ANALYZER
// ============================================================
const { getBrandDomains, getPatterns } = require('../storage/patternStore');

// BRAND_DOMAINS ve BEC kalıpları artık SQLite'tan yükleniyor.
// getBrandDomains() → [[domain, alias], ...] (önbellekli)
// getPatterns('bec_subject') / getPatterns('bec_body') → RegExp[]

// Unicode → ASCII lookalike haritası (en yaygın karakterler)
const UNICODE_MAP = {
    'а':'a','е':'e','о':'o','р':'r','с':'c','х':'x','у':'y','і':'i','ԁ':'d','ɡ':'g',
    'ν':'v','μ':'u','η':'n','ρ':'p','τ':'t','ω':'w','α':'a','β':'b','ε':'e','κ':'k',
    'ο':'o','π':'p','σ':'s','φ':'f','χ':'x','ψ':'y','ζ':'z','ι':'i','λ':'l','θ':'o',
    'ϲ':'c','ᴀ':'a','ᴄ':'c','ᴅ':'d','ᴇ':'e','ɢ':'g','ɪ':'i','ᴊ':'j','ᴋ':'k',
    'ʟ':'l','ᴍ':'m','ɴ':'n','ᴏ':'o','ᴘ':'p','ǫ':'q','ʀ':'r','ꜱ':'s','ᴛ':'t',
    'ᴜ':'u','ᴠ':'v','ᴡ':'w','ʏ':'y','ᴢ':'z'
};

function analyzeHeaders(emailData) {
    const findings = [];
    let score = 0;
    const checks = [
        analyzeSpf(emailData.spf),
        analyzeDkim(emailData.dkim),
        analyzeDmarc(emailData.dmarc),
        analyzeFromReplyTo(emailData),
        analyzeGatewayQuarantine(emailData),
        analyzeSenderDomain(emailData),
        analyzeReceivedChain(emailData.receivedHeaders),
        analyzeLookalikeDomain(emailData),
        analyzeUnicodeSpoofing(emailData),
        analyzeTimestamp(emailData),
        analyzeThreadHijacking(emailData),
        analyzeBecSignals(emailData)
    ];
    checks.forEach(r => { findings.push(...r.findings); score += r.score; });
    return { findings, score: Math.min(score, 40) };
}

function analyzeSpf(spf) {
    const findings = []; let score = 0;
    if (spf.status === 'pass') findings.push({ severity: 'safe', category: 'header', message: 'SPF doğrulaması başarılı' });
    else if (spf.status === 'fail') { findings.push({ severity: 'critical', category: 'header', message: 'SPF BAŞARISIZ — gönderen sahte olabilir' }); score = 15; }
    else if (spf.status === 'softfail') { findings.push({ severity: 'warning', category: 'header', message: 'SPF yumuşak hata (softfail)' }); score = 8; }
    else { findings.push({ severity: 'info', category: 'header', message: 'SPF kaydı bulunamadı' }); score = 5; }
    return { findings, score };
}

function analyzeDkim(dkim) {
    const findings = []; let score = 0;
    if (dkim.status === 'pass') findings.push({ severity: 'safe', category: 'header', message: 'DKIM imzası geçerli' });
    else if (dkim.status === 'fail') { findings.push({ severity: 'warning', category: 'header', message: 'DKIM doğrulanamadı — yönlendirme veya liste sunucusu olabilir' }); score = 5; }
    else { findings.push({ severity: 'info', category: 'header', message: 'DKIM imzası yok' }); score = 2; }
    return { findings, score };
}

function analyzeDmarc(dmarc) {
    const findings = []; let score = 0;
    if (dmarc.status === 'pass') findings.push({ severity: 'safe', category: 'header', message: 'DMARC doğrulaması başarılı' });
    else if (dmarc.status === 'fail') { findings.push({ severity: 'critical', category: 'header', message: 'DMARC BAŞARISIZ' }); score = 10; }
    else { findings.push({ severity: 'info', category: 'header', message: 'DMARC politikası yok' }); score = 2; }
    return { findings, score };
}

function analyzeFromReplyTo(emailData) {
    const findings = []; let score = 0;
    if (emailData.from?.length > 0 && emailData.replyTo?.length > 0) {
        const fromD = emailData.from[0].address?.split('@')[1]?.toLowerCase();
        const replyD = emailData.replyTo[0].address?.split('@')[1]?.toLowerCase();
        if (fromD && replyD && fromD !== replyD) {
            findings.push({ severity: 'warning', category: 'header', message: `Gönderen/Yanıt-Adresi uyuşmazlığı: ${fromD} ≠ ${replyD}` });
            score = 10;
        }
    }
    return { findings, score };
}

function analyzeSenderDomain(emailData) {
    const findings = []; let score = 0;
    if (emailData.from?.length > 0) {
        const addr = emailData.from[0].address || '';
        const domain = addr.split('@')[1]?.toLowerCase() || '';
        const name = (emailData.from[0].name || '').toLowerCase();
        const freeProviders = ['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com'];
        const brands = ['bank','paypal','amazon','microsoft','apple','google','netflix'];
        if (freeProviders.includes(domain)) {
            for (const b of brands) {
                if (name.includes(b)) {
                    findings.push({ severity: 'critical', category: 'header', message: `"${b}" görünen adı ücretsiz sağlayıcıdan kullanılmış: ${domain}` });
                    score = 15; break;
                }
            }
        }
    }
    return { findings, score };
}

function analyzeReceivedChain(receivedHeaders) {
    const findings = []; let score = 0;
    if (receivedHeaders?.length > 8) {
        findings.push({ severity: 'info', category: 'header', message: `Uzun aktarım zinciri (${receivedHeaders.length} atlama)` });
        score = 3;
    }
    return { findings, score };
}

function analyzeGatewayQuarantine(emailData) {
    const findings = [];
    let score = 0;
    const quarantined = Array.isArray(emailData.quarantinedAttachments) ? emailData.quarantinedAttachments : [];

    for (const item of quarantined) {
        findings.push({
            severity: 'critical',
            category: 'attachment',
            message: `Mail güvenlik geçidi ek dosyayı zararlı olarak karantinaya aldı: ${item.filename}${item.detection ? ` (${item.detection})` : ''}${item.action ? ` - ${item.action}` : ''}`
        });
        score += 20;
    }

    return { findings, score };
}

// ─── YENİ: LOOKALIKE DOMAIN TESPİTİ ────────────────────────

function levenshtein(a, b) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    const dp = Array.from({ length: la + 1 }, (_, i) => [i, ...Array(lb).fill(0)]);
    for (let j = 1; j <= lb; j++) dp[0][j] = j;
    for (let i = 1; i <= la; i++) {
        for (let j = 1; j <= lb; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[la][lb];
}

function stripTld(domain) {
    // Remove TLD(s) — e.g. "paypa1.com" → "paypa1", "microsoft.co.uk" → "microsoft"
    return domain.replace(/(\.[a-z]{2,})+$/, '');
}

function analyzeLookalikeDomain(emailData) {
    const findings = []; let score = 0;
    const addr = emailData.from?.[0]?.address || '';
    const domain = addr.split('@')[1]?.toLowerCase() || '';
    if (!domain) return { findings, score };

    const domainBase = stripTld(domain);
    const BRAND_DOMAINS = getBrandDomains(); // DB'den önbellekli yükleme

    for (const [brandDomain, brandAlias] of BRAND_DOMAINS) {
        // Skip if it IS the real domain
        if (domain === brandDomain || domain.endsWith('.' + brandDomain)) continue;

        const brandBase = stripTld(brandDomain);
        const dist = levenshtein(domainBase, brandBase);

        // Lookalike threshold: distance 1-2 for longer brands, 1 for shorter
        const threshold = brandBase.length <= 5 ? 1 : 2;
        if (dist > 0 && dist <= threshold) {
            findings.push({
                severity: 'critical',
                category: 'header',
                message: `Lookalike domain tespit edildi: "${domain}" ← "${brandDomain}" markasına benziyor (yazım hatası/typosquatting)`
            });
            score += 18;
            break; // En fazla 1 uyarı per gönderen
        }
    }
    return { findings, score };
}

// ─── YENİ: UNICODE / HOMOGRAPH SPOOFING ─────────────────────

function normalizeUnicode(str) {
    return str.split('').map(c => UNICODE_MAP[c] || c).join('');
}

function analyzeUnicodeSpoofing(emailData) {
    const findings = []; let score = 0;
    const addr = emailData.from?.[0]?.address || '';
    const domain = addr.split('@')[1]?.toLowerCase() || '';
    if (!domain) return { findings, score };

    // Punycode kontrolü: xn-- ile başlayan etiketler
    if (/xn--/i.test(domain)) {
        findings.push({
            severity: 'critical',
            category: 'header',
            message: `Punycode (IDN) domain tespit edildi — görsel olarak yanıltıcı olabilir: ${domain}`
        });
        score += 15;
        return { findings, score };
    }

    // ASCII dışı karakter var mı?
    if (/[^\x00-\x7F]/.test(domain)) {
        findings.push({
            severity: 'critical',
            category: 'header',
            message: `Domain ASCII dışı (Unicode homograph) karakter içeriyor: ${domain}`
        });
        score += 15;
        return { findings, score };
    }

    // Normalize edince bilinen bir marka domain'ine mi dönüşüyor?
    const normalized = normalizeUnicode(domain);
    if (normalized !== domain) {
        const BRAND_DOMAINS = getBrandDomains();
        for (const [brandDomain] of BRAND_DOMAINS) {
            if (normalized === brandDomain || normalized.endsWith('.' + brandDomain)) {
                findings.push({
                    severity: 'critical',
                    category: 'header',
                    message: `Unicode karakter sahteciliği: "${domain}" normalize edilince "${brandDomain}" oluyor`
                });
                score += 20;
                break;
            }
        }
    }

    return { findings, score };
}

// ─── YENİ: HEADER ZAMAN DAMGASI ANALİZİ ────────────────────

function analyzeTimestamp(emailData) {
    const findings = []; let score = 0;
    const dateStr = emailData.date || emailData.emailMeta?.date;
    if (!dateStr) return { findings, score };

    const mailDate = new Date(dateStr);
    if (isNaN(mailDate.getTime())) return { findings, score };

    const now = Date.now();
    const diffMs = mailDate.getTime() - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // Gelecek tarihli e-posta
    if (diffMs > 5 * 60 * 1000) { // 5 dakikadan fazla ileride
        findings.push({
            severity: 'warning',
            category: 'header',
            message: `E-posta geleceğe tarihlendirilmiş: ${mailDate.toISOString().slice(0, 16).replace('T', ' ')} UTC (timestamp manipülasyonu?)`
        });
        score += 8;
    }

    // Çok eski e-posta (30 günden fazla eski gönderim)
    if (diffDays < -30) {
        findings.push({
            severity: 'info',
            category: 'header',
            message: `E-posta tarihi çok eski: ${Math.abs(Math.round(diffDays))} gün önce`
        });
    }

    // Received zincirinde sıra bozukluğu
    const received = emailData.receivedHeaders || [];
    if (received.length >= 2) {
        const dates = received
            .map(h => {
                const m = String(h).match(/;\s*(.+)$/);
                return m ? new Date(m[1].trim()).getTime() : null;
            })
            .filter(d => d !== null && !isNaN(d));

        for (let i = 1; i < dates.length; i++) {
            if (dates[i] > dates[i - 1] + 10 * 60 * 1000) { // 10 dk'dan fazla geri gidiş
                findings.push({
                    severity: 'info',
                    category: 'header',
                    message: 'Received zincirinde zaman damgası tutarsızlığı tespit edildi'
                });
                break;
            }
        }
    }

    return { findings, score };
}

// ─── YENİ: THREAD HİJACKING ─────────────────────────────────

function analyzeThreadHijacking(emailData) {
    const findings = []; let score = 0;
    const headers = emailData.headers || emailData.rawHeaders || {};

    const inReplyTo = (typeof headers === 'object' && !Array.isArray(headers))
        ? (headers['in-reply-to'] || headers['In-Reply-To'] || '')
        : '';

    if (!inReplyTo) return { findings, score };

    // In-Reply-To içinde domain var mı?
    const replyDomainMatch = String(inReplyTo).match(/@([a-z0-9._-]+)/i);
    const fromAddr = emailData.from?.[0]?.address || '';
    const fromDomain = fromAddr.split('@')[1]?.toLowerCase() || '';

    if (replyDomainMatch && fromDomain) {
        const replyDomain = replyDomainMatch[1].toLowerCase();
        // Gönderenin domain'i, yanıtlanan e-postanın domain'inden çok farklıysa şüpheli
        if (replyDomain !== fromDomain && levenshtein(replyDomain, fromDomain) > 3) {
            findings.push({
                severity: 'warning',
                category: 'header',
                message: `Thread hijacking şüphesi: yanıt zincirindeki domain (${replyDomain}) ile gönderen domain (${fromDomain}) uyuşmuyor`
            });
            score += 8;
        }
    }

    return { findings, score };
}

// ─── YENİ: BEC (Business Email Compromise) LOKAL SİNYALLER ──

// BEC kalıpları DB'den dinamik olarak yüklenir (patternStore aracılığıyla)

function analyzeBecSignals(emailData) {
    const findings = []; let score = 0;

    const subject = (emailData.subject || emailData.emailMeta?.subject || '').toLowerCase();
    const text = ((emailData.text || '') + ' ' + (emailData.html || '')).toLowerCase();
    const fromAddr = emailData.from?.[0]?.address || '';
    const fromDomain = fromAddr.split('@')[1]?.toLowerCase() || '';
    const replyAddr = emailData.replyTo?.[0]?.address || '';
    const replyDomain = replyAddr.split('@')[1]?.toLowerCase() || '';

    // DB'den önbellekli kalıpları yükle
    const BEC_SUBJECT_PATTERNS = getPatterns('bec_subject');
    const BEC_BODY_PATTERNS    = getPatterns('bec_body');

    const subjectHits = BEC_SUBJECT_PATTERNS.filter(p => p.test(subject));
    const bodyHits = BEC_BODY_PATTERNS.filter(p => p.test(text));

    // Konu + gövde birlikte BEC sinyali veriyorsa uyar
    if (subjectHits.length > 0 && bodyHits.length > 0) {
        findings.push({
            severity: 'critical',
            category: 'header',
            message: `BEC (Kurumsal E-posta Dolandırıcılığı) sinyali tespit edildi — ${subjectHits.length} konu + ${bodyHits.length} gövde kalıbı`
        });
        score += 18;
    } else if (subjectHits.length > 0 && replyDomain && fromDomain && replyDomain !== fromDomain) {
        // Yönetici gibi görünen + Reply-To farklı domain
        findings.push({
            severity: 'warning',
            category: 'header',
            message: `BEC şüphesi: yönetici rolü içeren konu + Reply-To farklı domain (${replyDomain})`
        });
        score += 12;
    } else if (bodyHits.length >= 2) {
        findings.push({
            severity: 'warning',
            category: 'header',
            message: `BEC içerik sinyali: banka hesabı değişikliği veya gizli transfer talebi tespit edildi`
        });
        score += 10;
    }

    return { findings, score };
}

module.exports = { analyzeHeaders };
