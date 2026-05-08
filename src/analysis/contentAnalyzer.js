// ============================================================
// CONTENT / PHISHING ANALYZER
// Tüm tehdit kalıpları SQLite'tan yüklenir (patternStore).
// Admin panelinden kalıp eklenip güncellenebilir.
// ============================================================
const { getPatterns } = require('../storage/patternStore');

function analyzeContent(emailData, level = 'advanced') {
    const findings = [];
    let score = 0;
    const text = (emailData.text || '') + ' ' + stripHtml(emailData.html || '');

    // ── DB'den kalıpları yükle (önbellekli) ──────────────────
    const urgencyPatterns   = getPatterns('urgency');
    const credentialPats    = getPatterns('credential');
    const threatPats        = getPatterns('threat');
    const rewardPats        = getPatterns('reward');
    const sextortionPats    = getPatterns('sextortion');
    const becContentPats    = getPatterns('bec_content');

    // Aciliyet ifadeleri
    const urgencyHits = urgencyPatterns.filter(p => p.test(text));
    if (urgencyHits.length > 0) {
        findings.push({ severity: urgencyHits.length >= 3 ? 'critical' : 'warning', category: 'content',
            message: `Aciliyet ifadeleri tespit edildi (${urgencyHits.length} kalıp)` });
        score += Math.min(urgencyHits.length * 3, 12);
    }

    // Kimlik bilgisi talebi
    const credHits = credentialPats.filter(p => p.test(text));
    if (credHits.length > 0) {
        findings.push({ severity: 'critical', category: 'content',
            message: `Kimlik / hassas veri talebi tespit edildi (${credHits.length} kalıp)` });
        score += Math.min(credHits.length * 4, 15);
    }

    // Tehditkâr ifadeler
    const threatHits = threatPats.filter(p => p.test(text));
    if (threatHits.length > 0) {
        findings.push({ severity: 'warning', category: 'content',
            message: `Tehditkâr ifadeler tespit edildi (${threatHits.length} kalıp)` });
        score += Math.min(threatHits.length * 3, 10);
    }

    // Ödül / hediye dolandırıcılığı
    const rewardHits = rewardPats.filter(p => p.test(text));
    if (rewardHits.length > 0) {
        findings.push({ severity: 'warning', category: 'content',
            message: `Ödül / hediye dolandırıcılık ifadeleri tespit edildi (${rewardHits.length} kalıp)` });
        score += Math.min(rewardHits.length * 3, 10);
    }

    // Sextortion / dijital gasp
    const sextHits = sextortionPats.filter(p => p.test(text));
    if (sextHits.length > 0) {
        findings.push({
            severity: 'critical',
            category: 'content',
            message: `Sextortion / dijital gasp kalıbı tespit edildi (${sextHits.length} kalıp) — Bitcoin talebi veya kamera tehdidi içeriyor olabilir`
        });
        score += Math.min(sextHits.length * 6, 20);
    }

    // BEC finansal içerik sinyali
    const becHits = becContentPats.filter(p => p.test(text));
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
