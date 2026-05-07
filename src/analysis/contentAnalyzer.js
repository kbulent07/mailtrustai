// ============================================================
// CONTENT / PHISHING ANALYZER
// ============================================================

const URGENCY_PATTERNS_TR = [
    /hemen\s+işlem/i, /acil/i, /derhal/i, /son\s+şans/i, /süreniz\s+dol/i,
    /hesabınız\s+(askıya|kapatıl)/i, /şifrenizi\s+değiştir/i, /güncelle/i,
    /doğrula/i, /24\s*saat/i, /48\s*saat/i, /sınırlı\s+süre/i
];

const URGENCY_PATTERNS_EN = [
    /immediate\s+action/i, /urgent/i, /act\s+now/i, /expires?\s+soon/i,
    /account\s+(suspend|clos|deactivat|restrict)/i, /verify\s+your/i,
    /confirm\s+your\s+(identity|account|payment)/i, /last\s+chance/i,
    /within\s+\d+\s*hours?/i, /limited\s+time/i, /failure\s+to/i
];

const CREDENTIAL_PATTERNS = [
    /password/i, /şifre/i, /parola/i, /credit\s*card/i, /kredi\s*kart/i,
    /social\s*security/i, /ssn/i, /tc\s*kimlik/i, /bank\s*account/i,
    /banka\s*hesab/i, /pin\s*(code|kodu)/i, /cvv/i, /expire?\s*date/i,
    /son\s*kullanma/i, /login\s*credential/i, /giriş\s*bilgi/i
];

const THREAT_PATTERNS = [
    /legal\s*action/i, /yasal\s*işlem/i, /law\s*enforcement/i,
    /police/i, /polis/i, /mahkeme/i, /court/i, /arrest/i,
    /fine\s*of/i, /ceza/i, /dava/i, /sue/i
];

const REWARD_PATTERNS = [
    /congratulations/i, /tebrikler/i, /you\s*(have\s+)?won/i, /kazandınız/i,
    /prize/i, /ödül/i, /lottery/i, /piyango/i, /million\s*dollar/i,
    /free\s*gift/i, /hediye/i, /inheritance/i, /miras/i
];

// ─── YENİ: SEXTORTION / GASP KALIPLARI ──────────────────────
const SEXTORTION_PATTERNS_TR = [
    /şifren[ei]\s+(ele\s+geçir|çaldım|bildim)/i,
    /kamera\s*(kaydın[ıi]|görüntün[üu])/i,
    /bitcoin\s*(gönder|öde|transfer)/i,
    /zararlı\s*(yazılım|program|virüs)\s*yükle/i,
    /web\s*kameras[ıi]/i,
    /müstehcen\s*(video|görüntü)/i,
    /\d+\s*bitcoin\s*gönder/i
];

const SEXTORTION_PATTERNS_EN = [
    /i\s+have\s+(hacked|access\s+to)\s+your/i,
    /your\s+password\s+is/i,
    /i\s+recorded\s+you/i,
    /your\s+webcam\s+(was\s+)?(hacked|activated)/i,
    /send\s+\d+\s*bitcoin/i,
    /malware\s*(installed|on\s+your)/i,
    /adult\s*(content|website|video)/i,
    /pay\s+.{0,20}\s*bitcoin\s+or/i
];

// ─── YENİ: BEC İÇERİK SİNYALLERİ ───────────────────────────
const BEC_FINANCIAL_PATTERNS = [
    /\biban\b.*değiş/i, /\biban\b.*update/i, /\biban\b.*new\b/i,
    /hesap\s*numarası.*değiş/i, /account.*number.*change/i,
    /yeni\s*banka\s*bilgi/i, /new\s*bank\s*(detail|account)/i,
    /ödemeyi?\s+.*bu\s+hesab/i, /payment.*this\s+(account|iban)/i,
    /tedarikçi.*hesab.*değiş/i, /vendor.*account.*change/i
];

function analyzeContent(emailData, level = 'advanced') {
    const findings = [];
    let score = 0;
    const text = (emailData.text || '') + ' ' + stripHtml(emailData.html || '');

    // Urgency check
    const urgencyHits = [...URGENCY_PATTERNS_TR, ...URGENCY_PATTERNS_EN].filter(p => p.test(text));
    if (urgencyHits.length > 0) {
        findings.push({ severity: urgencyHits.length >= 3 ? 'critical' : 'warning', category: 'content',
            message: `Aciliyet ifadeleri tespit edildi (${urgencyHits.length} kalıp)` });
        score += Math.min(urgencyHits.length * 3, 12);
    }

    // Credential harvesting
    const credHits = CREDENTIAL_PATTERNS.filter(p => p.test(text));
    if (credHits.length > 0) {
        findings.push({ severity: 'critical', category: 'content',
            message: `Kimlik / hassas veri talebi tespit edildi (${credHits.length} kalıp)` });
        score += Math.min(credHits.length * 4, 15);
    }

    // Threat language
    const threatHits = THREAT_PATTERNS.filter(p => p.test(text));
    if (threatHits.length > 0) {
        findings.push({ severity: 'warning', category: 'content',
            message: `Tehditkâr ifadeler tespit edildi (${threatHits.length} kalıp)` });
        score += Math.min(threatHits.length * 3, 10);
    }

    // Reward/prize scam
    const rewardHits = REWARD_PATTERNS.filter(p => p.test(text));
    if (rewardHits.length > 0) {
        findings.push({ severity: 'warning', category: 'content',
            message: `Ödül / hediye dolandırıcılık ifadeleri tespit edildi (${rewardHits.length} kalıp)` });
        score += Math.min(rewardHits.length * 3, 10);
    }

    // ─── YENİ: Sextortion / Gasp ────────────────────────────
    const sextHits = [...SEXTORTION_PATTERNS_TR, ...SEXTORTION_PATTERNS_EN].filter(p => p.test(text));
    if (sextHits.length > 0) {
        findings.push({
            severity: 'critical',
            category: 'content',
            message: `Sextortion / dijital gasp kalıbı tespit edildi (${sextHits.length} kalıp) — Bitcoin talebi veya kamera tehdidi içeriyor olabilir`
        });
        score += Math.min(sextHits.length * 6, 20);
    }

    // ─── YENİ: BEC finansal içerik sinyali ──────────────────
    const becHits = BEC_FINANCIAL_PATTERNS.filter(p => p.test(text));
    if (becHits.length > 0) {
        findings.push({
            severity: 'critical',
            category: 'content',
            message: `BEC finansal dolandırıcılık içeriği: banka/IBAN hesap değişikliği talebi tespit edildi (${becHits.length} kalıp)`
        });
        score += Math.min(becHits.length * 5, 15);
    }

    // Advanced: HTML analysis
    if (level === 'advanced' && emailData.html) {
        const htmlFindings = analyzeHtml(emailData.html);
        findings.push(...htmlFindings.findings);
        score += htmlFindings.score;
    }

    if (findings.length === 0) {
        findings.push({ severity: 'safe', category: 'content', message: 'Şüpheli içerik kalıbı tespit edilmedi' });
    }

    return { findings, score: Math.min(score, 30) };
}

function analyzeHtml(html) {
    const findings = []; let score = 0;

    // Hidden forms
    if (/<form[^>]*>/i.test(html)) {
        findings.push({ severity: 'warning', category: 'content', message: 'E-posta gövdesinde HTML form tespit edildi' });
        score += 8;
    }
    // JavaScript
    if (/<script/i.test(html)) {
        findings.push({ severity: 'critical', category: 'content', message: 'E-postada JavaScript tespit edildi' });
        score += 10;
    }
    // Hidden iframes
    if (/<iframe/i.test(html)) {
        findings.push({ severity: 'critical', category: 'content', message: 'Gizli iframe tespit edildi' });
        score += 10;
    }
    // Display:none elements with links
    if (/display\s*:\s*none[^"]*<a\s/i.test(html)) {
        findings.push({ severity: 'warning', category: 'content', message: 'Gizli bağlantılar tespit edildi (display:none)' });
        score += 5;
    }

    // ─── YENİ: Tracking pixel tespiti ───────────────────────
    // 1x1 veya 0x0 piksel resimler
    const trackingPixelRegex = /<img[^>]+(?:width=["']?[01]["']?[^>]*height=["']?[01]["']?|height=["']?[01]["']?[^>]*width=["']?[01]["']?)[^>]*>/i;
    if (trackingPixelRegex.test(html)) {
        findings.push({
            severity: 'info',
            category: 'content',
            message: 'İzleme pikseli tespit edildi (1×1 veya 0×0 px resim) — e-postanın açılıp açılmadığı izleniyor olabilir'
        });
        // Skor eklenmez; bu genellikle pazarlama e-postalarında normaldir
    }

    // Çok sayıda dış kaynak (CDN + tracker karışımı)
    const imgSrcMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    const externalImgDomains = new Set(
        imgSrcMatches
            .map(m => { try { return new URL(m[1]).hostname; } catch { return null; } })
            .filter(Boolean)
    );
    if (externalImgDomains.size > 5) {
        findings.push({
            severity: 'info',
            category: 'content',
            message: `E-postada ${externalImgDomains.size} farklı dış sunucudan resim yükleniyor (potansiyel çoklu izleyici)`
        });
    }

    return { findings, score };
}

function stripHtml(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

module.exports = { analyzeContent };
