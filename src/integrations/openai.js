// ============================================================
// OPENAI / CHATGPT INTEGRATION - Detailed Email Threat Analysis
// ============================================================
const fetch = require('node-fetch');

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

// Varsayılan model — .env veya ayarlar üzerinden geçersiz kılınabilir
const OPENAI_MODEL = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini';

// Kullanıcıya sunulacak hazır model listesi
const AVAILABLE_OPENAI_MODELS = [
    // GPT-5 Serisi
    { value: 'gpt-5',            label: 'GPT-5 (En güçlü)' },
    { value: 'gpt-5-mini',       label: 'GPT-5 Mini (Hızlı)' },
    // GPT-4o Serisi
    { value: 'gpt-4o-mini',      label: 'GPT-4o Mini (Hızlı, ekonomik)' },
    { value: 'gpt-4o',           label: 'GPT-4o (Dengeli)' },
    // GPT-4.1 Serisi
    { value: 'gpt-4.1',          label: 'GPT-4.1' },
    { value: 'gpt-4.1-mini',     label: 'GPT-4.1 Mini' },
    { value: 'gpt-4.1-nano',     label: 'GPT-4.1 Nano (En hızlı)' },
    // o-serisi (akıl yürütme)
    { value: 'o4-mini',          label: 'o4 Mini (Akıl yürütme)' },
    { value: 'o3-mini',          label: 'o3 Mini' },
    { value: 'o1-mini',          label: 'o1 Mini' },
    { value: 'o3',               label: 'o3 (En gelişmiş)' },
];

async function analyzeWithOpenAI(apiKey, payload, model) {
    const resolvedModel = (model && typeof model === 'string' && model.trim())
        ? model.trim()
        : OPENAI_MODEL;
    if (!apiKey) {
        return { success: false, error: 'No API key provided' };
    }

    const context = buildEmailContext(payload);
    const instructions = [
        'You are a senior email threat analyst focused on phishing, BEC, spam, extortion, credential theft, invoice fraud, malware delivery, impersonation, and social engineering.',
        'Assess the message as if it may be used in a real-world enterprise environment.',
        'Return ONLY valid JSON and do not wrap it in markdown.',
        'Be conservative: if evidence is weak, lower confidence and explain why.'
    ].join(' ');

    const prompt = `
Analyze the email below and return EXACTLY this JSON shape:
{
  "threatLevel": "safe|low|medium|high|critical",
  "category": "legitimate|marketing|spam|phishing|bec|invoice_fraud|credential_theft|malware_delivery|extortion|other",
  "confidence": 0,
  "maliciousIntentScore": 0,
  "summaryTR": "Turkce 2-3 cumlelik ozet",
  "summaryEN": "English 2-3 sentence summary",
  "attackNarrativeTR": "Saldiri veya kandirma senaryosunu Turkce acikla",
  "attackNarrativeEN": "Explain the attack or persuasion narrative in English",
  "redFlagsTR": ["Turkce madde"],
  "socialEngineeringSignalsTR": ["Turkce madde"],
  "requestedActionsTR": ["Kullanicidan istenen eylem"],
  "recommendedActionsTR": ["Savunma onerisi"],
  "impersonationRisk": "none|low|medium|high",
  "financialRisk": "none|low|medium|high",
  "credentialRisk": "none|low|medium|high",
  "urgencyRisk": "none|low|medium|high"
}

Email context:
${context}
`.trim();

    try {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: resolvedModel,
                store: false,
                max_output_tokens: 2500,
                instructions,
                input: prompt
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return { success: false, error: data.error?.message || 'OpenAI request failed' };
        }

        const rawText = extractOutputText(data);
        if (!rawText) {
            return { success: false, error: 'OpenAI boş yanıt döndürdü' };
        }

        const analysis = parseJsonSafe(rawText);
        if (!analysis) {
            // Kısaltılmış yanıtı logla (debug için)
            console.warn('[OpenAI] JSON parse başarısız. Ham metin (ilk 300 karakter):', rawText.slice(0, 300));
            return { success: false, error: 'OpenAI yanıtı geçerli JSON içermiyor (token limiti aşıldı olabilir)' };
        }

        return {
            success: true,
            analysis: normalizeAnalysis(analysis)
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function buildEmailContext({ parsedData, linkUrls = [], attachmentDetails = [] }) {
    const text = truncateText((parsedData.text || parsedData.textAsHtml || parsedData.html || '').toString(), 12000);
    const from = formatAddresses(parsedData.from);
    const to = formatAddresses(parsedData.to);
    const replyTo = formatAddresses(parsedData.replyTo);
    const attachments = attachmentDetails.length
        ? attachmentDetails.map((item) => `${item.filename || 'unnamed'} (${item.contentType || 'unknown'}, ${item.size || 0} bytes)`).join('\n')
        : 'None';
    const links = linkUrls.length ? linkUrls.slice(0, 20).join('\n') : 'None';

    return [
        `Subject: ${parsedData.subject || '(No Subject)'}`,
        `From: ${from || 'Unknown'}`,
        `To: ${to || 'Unknown'}`,
        `Reply-To: ${replyTo || 'None'}`,
        `Date: ${parsedData.date || 'Unknown'}`,
        `SPF: ${parsedData.spf?.status || 'unknown'}`,
        `DKIM: ${parsedData.dkim?.status || 'unknown'}`,
        `DMARC: ${parsedData.dmarc?.status || 'unknown'}`,
        `Attachment count: ${parsedData.attachmentCount || 0}`,
        `Attachments:\n${attachments}`,
        `Links:\n${links}`,
        `Body:\n${text || '(Empty body)'}`
    ].join('\n\n');
}

function extractOutputText(response) {
    if (!Array.isArray(response?.output)) {
        return '';
    }

    return response.output
        .flatMap((item) => item?.content || [])
        .filter((content) => content?.type === 'output_text')
        .map((content) => content.text || '')
        .join('\n')
        .trim();
}

function normalizeAnalysis(analysis) {
    return {
        threatLevel: normalizeEnum(analysis.threatLevel, ['safe', 'low', 'medium', 'high', 'critical'], 'low'),
        category: normalizeEnum(
            analysis.category,
            ['legitimate', 'marketing', 'spam', 'phishing', 'bec', 'invoice_fraud', 'credential_theft', 'malware_delivery', 'extortion', 'other'],
            'other'
        ),
        confidence: clampNumber(analysis.confidence, 0, 100, 65),
        maliciousIntentScore: clampNumber(analysis.maliciousIntentScore, 0, 100, 35),
        summaryTR: ensureText(analysis.summaryTR),
        summaryEN: ensureText(analysis.summaryEN),
        attackNarrativeTR: ensureText(analysis.attackNarrativeTR),
        attackNarrativeEN: ensureText(analysis.attackNarrativeEN),
        redFlagsTR: ensureArray(analysis.redFlagsTR, 6),
        socialEngineeringSignalsTR: ensureArray(analysis.socialEngineeringSignalsTR, 6),
        requestedActionsTR: ensureArray(analysis.requestedActionsTR, 6),
        recommendedActionsTR: ensureArray(analysis.recommendedActionsTR, 6),
        impersonationRisk: normalizeEnum(analysis.impersonationRisk, ['none', 'low', 'medium', 'high'], 'low'),
        financialRisk: normalizeEnum(analysis.financialRisk, ['none', 'low', 'medium', 'high'], 'low'),
        credentialRisk: normalizeEnum(analysis.credentialRisk, ['none', 'low', 'medium', 'high'], 'low'),
        urgencyRisk: normalizeEnum(analysis.urgencyRisk, ['none', 'low', 'medium', 'high'], 'low')
    };
}

function formatAddresses(addresses = []) {
    return (addresses || [])
        .map((entry) => {
            if (entry.name && entry.address) {
                return `${entry.name} <${entry.address}>`;
            }
            return entry.address || entry.name || '';
        })
        .filter(Boolean)
        .join(', ');
}

function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text || '';
    return `${text.slice(0, maxLength)}\n...[TRUNCATED]`;
}

function normalizeEnum(value, allowed, fallback) {
    const normalized = String(value || '').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function ensureText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function ensureArray(value, limit) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, limit);
}

/**
 * JSON metnini güvenli şekilde ayrıştırır.
 * OpenAI token limiti nedeniyle yanıt kesilmişse kurtarma dener.
 */
function parseJsonSafe(rawText) {
    if (!rawText) return null;

    // İlk ve son süslü parantezi bul
    const start = rawText.indexOf('{');
    if (start === -1) return null;

    // Tam parse dene
    const end = rawText.lastIndexOf('}');
    if (end > start) {
        try {
            return JSON.parse(rawText.substring(start, end + 1));
        } catch (_) {
            // Tam parse başarısız — kurtarmaya geç
        }
    }

    // Kesilmiş JSON kurtarma: açık olan parantez/köşeli parantezi kapat
    try {
        let fragment = rawText.substring(start);
        const stack = [];
        let inString = false;
        let escape = false;

        for (let i = 0; i < fragment.length; i++) {
            const ch = fragment[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
            else if (ch === '}' || ch === ']') stack.pop();
        }

        // Açık kalan parantezleri kapat (tersten)
        let closing = '';
        // Eğer son karakter virgül veya iki noktaysa at
        fragment = fragment.replace(/[,:\s]+$/, '');
        // Eğer bir string açıksa kapat
        if (inString) { fragment += '"'; }
        for (let i = stack.length - 1; i >= 0; i--) {
            closing += stack[i];
        }

        return JSON.parse(fragment + closing);
    } catch (_) {
        return null;
    }
}

module.exports = { analyzeWithOpenAI, OPENAI_MODEL, AVAILABLE_OPENAI_MODELS };
