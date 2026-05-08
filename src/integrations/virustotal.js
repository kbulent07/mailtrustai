// ============================================================
// VIRUSTOTAL API INTEGRATION
// ============================================================
const VT_BASE = 'https://www.virustotal.com/api/v3';
const { getCachedResult, setCachedResult } = require('../storage/vtCacheStore');

// Polling ayarları
// Ücretsiz API: dakikada 4 istek, analiz genellikle 60–180s sürer.
// 20 deneme × üstel bekleme (5s–20s arası) → ~4 dakika maksimum bekleme
const VT_POLL_MAX_ATTEMPTS = 20;
const VT_POLL_BASE_DELAY_MS = 5000;   // ilk bekleme
const VT_POLL_MAX_DELAY_MS  = 20000;  // üst sınır

// Ekler arası bekleme — ücretsiz API rate limit (4 istek/dk)
const VT_INTER_FILE_DELAY_MS = 16000;

function sanitizeUploadFilename(filename) {
    const raw = String(filename || 'attachment.bin');
    const extension = raw.match(/\.[a-z0-9]{1,12}$/i)?.[0] || '.bin';
    const base = raw
        .replace(/[^\x20-\x7E]/g, '_')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);

    if (!base) return `attachment${extension}`;
    return base.toLowerCase().endsWith(extension.toLowerCase()) ? base : `${base}${extension}`;
}

async function readErrorBody(res) {
    try {
        const text = await res.text();
        if (!text) return '';
        try {
            const json = JSON.parse(text);
            return json?.error?.message || json?.error?.code || text.slice(0, 300);
        } catch {
            return text.slice(0, 300);
        }
    } catch {
        return '';
    }
}

function appendStatusDetail(message, status, detail) {
    return `${message}: ${status}${detail ? ` - ${detail}` : ''}`;
}

// ─── Hash ile arama ──────────────────────────────────────
async function lookupHash(hash, apiKey) {
    if (!apiKey) return { checked: false, error: 'No API key provided' };
    try {
        const res = await fetch(`${VT_BASE}/files/${hash}`, {
            headers: { 'x-apikey': apiKey, 'accept': 'application/json' }
        });
        if (res.status === 404) return { checked: true, found: false, message: 'File not in VT database' };
        if (res.status === 429) return { checked: false, error: 'VT rate limit exceeded (4 req/min)' };
        if (!res.ok) {
            const detail = await readErrorBody(res);
            return { checked: false, error: appendStatusDetail('VT API error', res.status, detail) };
        }
        const data = await res.json();
        return mapFileResponse(data, hash);
    } catch (e) {
        return { checked: false, error: e.message };
    }
}

// ─── Ek listesini tara ───────────────────────────────────
async function scanAttachments(attachments, apiKey) {
    const results = [];
    for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        if (!att.hash) continue;

        // ── Önbellek kontrolü: aynı hash daha önce sorgulanmış mı? ──
        const cached = getCachedResult(att.hash);
        if (cached) {
            console.log(`[VT] Önbellekten döndü: ${att.filename} (${att.hash.slice(0, 12)}...)`);
            results.push({ filename: att.filename, hash: att.hash, fromCache: true, ...cached });
            continue; // API çağrısı yok, bekleme yok
        }

        let vtResult = await lookupHash(att.hash, apiKey);

        // VT'de kayıt yoksa ve içerik varsa yükle + analiz et
        if (vtResult.checked && !vtResult.found && att.content) {
            vtResult = await uploadAndAnalyze(att, apiKey);
        }

        // Başarılı sonucu önbelleğe kaydet
        if (vtResult.checked && !vtResult.error) {
            setCachedResult(att.hash, vtResult);
        }

        results.push({ filename: att.filename, hash: att.hash, ...vtResult });

        // Son dosya değilse dosyalar arası bekleme (rate limit)
        // Önbellekten gelen sonuçlar sayılmaz; sadece gerçek API çağrılarında bekle
        const hasMore = attachments.slice(i + 1).some(a => a.hash && !getCachedResult(a.hash));
        if (hasMore) {
            await delay(VT_INTER_FILE_DELAY_MS);
        }
    }
    return results;
}

// ─── Yükleme + analiz ────────────────────────────────────
async function uploadAndAnalyze(att, apiKey) {
    try {
        const content = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content || []);
        if (!content.length) {
            return { checked: false, error: 'Attachment content is empty; VT upload skipped' };
        }

        const form = new FormData();
        const mime = att.contentType || 'application/octet-stream';
        const uploadName = sanitizeUploadFilename(att.filename);
        form.append('file', new Blob([content], { type: mime }), uploadName);

        const uploadRes = await fetch(`${VT_BASE}/files`, {
            method: 'POST',
            headers: { 'x-apikey': apiKey, accept: 'application/json' },
            body: form
        });

        if (uploadRes.status === 429) {
            return { checked: false, error: 'VT upload rate limit exceeded (4 req/min)' };
        }
        if (!uploadRes.ok) {
            const detail = await readErrorBody(uploadRes);
            return { checked: false, error: appendStatusDetail('VT upload error', uploadRes.status, detail) };
        }

        const uploadData = await uploadRes.json();
        const analysisId = uploadData?.data?.id;
        if (!analysisId) {
            return { checked: false, error: 'VT upload succeeded but no analysis ID returned' };
        }

        // Analiz tamamlanana kadar bekle
        // Analiz tamamlandığında sonuçları DOĞRUDAN analiz yanıtından oku
        // (ikinci hash lookup'tan kaçın — hem daha hızlı hem rate limit tasarrufu)
        const pollResult = await waitForAnalysis(analysisId, apiKey);
        if (!pollResult.completed) {
            return { checked: false, error: pollResult.error || 'VT analysis did not complete in time' };
        }

        // Analiz yanıtında SHA256 varsa önce hash ile tam dosya verisi al
        const sha256 = pollResult.sha256 || att.hash;
        if (sha256) {
            // Küçük bekleme — analiz bitti ama indeks güncellenmemiş olabilir
            await delay(3000);
            const hashResult = await lookupHash(sha256, apiKey);
            if (hashResult.checked && hashResult.found) {
                return hashResult;
            }
        }

        // Hash lookup başarısız → analiz yanıtındaki veriyi doğrudan kullan
        return mapAnalysisResponse(pollResult.data, att.hash);

    } catch (error) {
        return { checked: false, error: error.message };
    }
}

// ─── Analiz bekleme — üstel geri çekilme ────────────────
async function waitForAnalysis(analysisId, apiKey) {
    let waitMs = VT_POLL_BASE_DELAY_MS;

    for (let attempt = 0; attempt < VT_POLL_MAX_ATTEMPTS; attempt++) {
        // İlk denemede VT'nin işe başlaması için biraz bekle
        if (attempt === 0) {
            await delay(waitMs);
        }

        const res = await fetch(`${VT_BASE}/analyses/${analysisId}`, {
            headers: { 'x-apikey': apiKey, accept: 'application/json' }
        });

        if (res.status === 429) {
            // Rate limit — daha uzun bekle ve yeniden dene
            await delay(30000);
            continue;
        }
        if (!res.ok) {
            const detail = await readErrorBody(res);
            return { completed: false, error: appendStatusDetail('VT analysis polling error', res.status, detail) };
        }

        const data = await res.json();
        const status = data?.data?.attributes?.status;

        if (status === 'completed') {
            const sha256 = data?.meta?.file_info?.sha256 || null;
            return { completed: true, data, sha256 };
        }

        // queued / in-progress — üstel geri çekilme ile bekle
        const elapsed = (attempt + 1) * waitMs / 1000;
        console.log(`[VT] Analiz devam ediyor (${status || 'bekliyor'}) — ${Math.round(elapsed)}s geçti, deneme ${attempt + 1}/${VT_POLL_MAX_ATTEMPTS}`);

        waitMs = Math.min(waitMs * 1.4, VT_POLL_MAX_DELAY_MS);
        await delay(waitMs);
    }

    const totalWait = Math.round(
        Array.from({ length: VT_POLL_MAX_ATTEMPTS }, (_, i) =>
            Math.min(VT_POLL_BASE_DELAY_MS * Math.pow(1.4, i), VT_POLL_MAX_DELAY_MS)
        ).reduce((a, b) => a + b, 0) / 1000
    );

    return {
        completed: false,
        error: `VT analizi ${totalWait} saniye içinde tamamlanamadı. VirusTotal sunucuları yoğun olabilir — daha sonra tekrar deneyin.`
    };
}

// ─── Yardımcılar ─────────────────────────────────────────
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractEngineNames(results, category) {
    return Object.entries(results || {})
        .filter(([, value]) => value?.category === category)
        .slice(0, 8)
        .map(([engine, value]) => ({ engine, result: value?.result || category }));
}

// /files/{hash} yanıtını normalize et
function mapFileResponse(data, hash) {
    const stats = data.data?.attributes?.last_analysis_stats || {};
    const analysisResults = data.data?.attributes?.last_analysis_results || {};
    return buildResult(stats, analysisResults, {
        name: data.data?.attributes?.meaningful_name || '',
        sha256: data.data?.attributes?.sha256 || hash,
        lastAnalysisDate: data.data?.attributes?.last_analysis_date || null,
        reputation: data.data?.attributes?.reputation || 0,
        typeDescription: data.data?.attributes?.type_description || '',
        link: `https://www.virustotal.com/gui/file/${data.data?.attributes?.sha256 || hash}`
    });
}

// /analyses/{id} yanıtını normalize et (yükleme sonrası direkt kullanım)
function mapAnalysisResponse(data, fallbackHash) {
    const stats = data?.data?.attributes?.stats || {};
    const analysisResults = data?.data?.attributes?.results || {};
    const sha256 = data?.meta?.file_info?.sha256 || fallbackHash || '';
    return buildResult(stats, analysisResults, {
        name: '',
        sha256,
        lastAnalysisDate: null,
        reputation: 0,
        typeDescription: '',
        link: sha256 ? `https://www.virustotal.com/gui/file/${sha256}` : ''
    });
}

function buildResult(stats, analysisResults, meta) {
    const maliciousEngines = extractEngineNames(analysisResults, 'malicious');
    const suspiciousEngines = extractEngineNames(analysisResults, 'suspicious');
    return {
        checked: true,
        found: true,
        stats: {
            malicious:   stats.malicious   || 0,
            suspicious:  stats.suspicious  || 0,
            undetected:  stats.undetected  || 0,
            harmless:    stats.harmless    || 0,
            total: (stats.malicious || 0) + (stats.suspicious || 0) +
                   (stats.undetected || 0) + (stats.harmless || 0)
        },
        ...meta,
        maliciousEngines,
        suspiciousEngines
    };
}

module.exports = { lookupHash, scanAttachments, uploadAndAnalyze };
