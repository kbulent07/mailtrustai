// ============================================================
// CLAUDE AI INTEGRATION — Semantic Email Analysis
// ============================================================
const Anthropic = require('@anthropic-ai/sdk');
const { recordCall } = require('../storage/llmUsageStore');

// Kurucu (founder) tarafı yönetimi: model değiştirme .env üzerinden yapılır.
// MSA_CLAUDE_MODEL veya MSA_LOCKED_CLAUDE_MODEL set'liyse o kullanılır.
// Müşteri admin UI'dan bunu değiştiremez (claude.js içinden okunur, settings'te yok).
const CLAUDE_MODEL = process.env.MSA_LOCKED_CLAUDE_MODEL
                  || process.env.MSA_CLAUDE_MODEL
                  || 'claude-haiku-4-5-20251001';
const MAX_EMAIL_CHARS = 10000;

function sanitizeForPrompt(text) {
    // Prevent prompt injection: collapse delimiter sequences an attacker might embed
    return String(text || '')
        .replace(/"""/g, "'''")
        .replace(/`{3}/g, "'''");
}

async function analyzeWithClaude(apiKey, emailText, emailSubject) {
    if (!apiKey) return { success: false, error: 'No API key provided' };

    try {
        const anthropic = new Anthropic({ apiKey });

        const truncatedText = emailText.length > MAX_EMAIL_CHARS
            ? emailText.substring(0, MAX_EMAIL_CHARS) + '... [TRUNCATED]'
            : emailText;

        const safeSubject = sanitizeForPrompt(emailSubject).slice(0, 300);
        const safeBody = sanitizeForPrompt(truncatedText);

        const prompt = `You are a cybersecurity expert specializing in email threat analysis (phishing, BEC, spam, social engineering).

Analyze the following email.

SUBJECT: ${safeSubject}

BODY:
<<<EMAIL_START>>>
${safeBody}
<<<EMAIL_END>>>

Provide your analysis in EXACTLY the following JSON format (return raw JSON only, no markdown fences):

{
    "threatLevel": "safe|low|medium|high|critical",
    "category": "phishing|spam|bec|marketing|legitimate_business|personal|other",
    "summaryTR": "A very brief 1-2 sentence summary of your findings in Turkish",
    "summaryEN": "A very brief 1-2 sentence summary of your findings in English",
    "suspiciousElements": ["Element 1", "Element 2"]
}`;

        const msg = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 1000,
            temperature: 0.2,
            system: 'You are an expert security analyst. You must output ONLY valid JSON.',
            messages: [{ role: 'user', content: prompt }]
        });

        const responseText = msg.content[0].text;

        try {
            const jsonStr = responseText.substring(
                responseText.indexOf('{'),
                responseText.lastIndexOf('}') + 1
            );
            const data = JSON.parse(jsonStr);
            recordCall({
                provider: 'anthropic',
                model: CLAUDE_MODEL,
                purpose: 'analysis',
                success: true,
                usage: msg.usage ? {
                    promptTokens:     msg.usage.input_tokens,
                    completionTokens: msg.usage.output_tokens,
                    totalTokens:      (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0)
                } : null
            });
            return { success: true, findings: data };
        } catch (e) {
            recordCall({ provider: 'anthropic', model: CLAUDE_MODEL, purpose: 'analysis', success: false });
            console.error('Claude JSON Parse Error. Raw response:', responseText);
            return { success: false, error: 'Failed to parse AI response' };
        }
    } catch (e) {
        recordCall({ provider: 'anthropic', model: CLAUDE_MODEL, purpose: 'analysis', success: false });
        return { success: false, error: e.message };
    }
}

module.exports = { analyzeWithClaude };
