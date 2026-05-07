// ============================================================
// WEBHOOK / SIEM ENTEGRASYONU
// Riskli tarama sonuçlarını yapılandırılmış HTTP POST ile dışarı iletir.
// Slack, Teams, Elastic, Splunk veya özel SIEM ile uyumlu.
// ============================================================
const fetch = require('node-fetch');
const { loadSettings } = require('../storage/settingsStore');

async function sendWebhook(result, eventType = 'scan_result') {
    const settings = loadSettings();
    const webhookUrl = settings.webhookUrl;
    const webhookEnabled = settings.webhookEnabled;
    const webhookMinLevel = settings.webhookMinLevel || 'low'; // safe|low|medium|high

    if (!webhookEnabled || !webhookUrl) return { sent: false, reason: 'disabled' };

    // Minimum risk level filter
    const levelRank = { safe: 0, low: 1, medium: 2, high: 3 };
    const resultRank = levelRank[result.level] ?? 0;
    const minRank = levelRank[webhookMinLevel] ?? 1;
    if (resultRank < minRank) return { sent: false, reason: 'below-threshold' };

    const payload = buildPayload(result, eventType);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const resp = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!resp.ok) {
            return { sent: false, error: `HTTP ${resp.status}` };
        }
        return { sent: true };
    } catch (err) {
        return { sent: false, error: err.message };
    }
}

function buildPayload(result, eventType) {
    const meta = result.emailMeta || {};
    const from = meta.from?.[0]?.address || '';
    const to = meta.to?.[0]?.address || '';
    const subject = meta.subject || '';
    const date = meta.date || result.timestamp || new Date().toISOString();

    // Kritik bulgular
    const criticalFindings = (result.findings || [])
        .filter(f => f.severity === 'critical')
        .map(f => f.message)
        .slice(0, 10);

    return {
        event: eventType,
        timestamp: new Date().toISOString(),
        risk: {
            level: result.level || 'safe',
            score: result.score || 0,
            label: result.labelTR || ''
        },
        email: { from, to, subject, date },
        summary: {
            critical: (result.findings || []).filter(f => f.severity === 'critical').length,
            warning: (result.findings || []).filter(f => f.severity === 'warning').length,
            info: (result.findings || []).filter(f => f.severity === 'info').length
        },
        criticalFindings,
        virusTotal: result.virusTotal?.length
            ? result.virusTotal.map(v => ({ file: v.filename, malicious: v.stats?.malicious || 0, suspicious: v.stats?.suspicious || 0 }))
            : [],
        aiVerdict: result.openaiAnalysis
            ? { level: result.openaiAnalysis.threatLevel, category: result.openaiAnalysis.category }
            : null,
        source: 'mailtrustai'
    };
}

// Slack uyumlu mesaj formatı (ayrıca test için kullanılabilir)
function buildSlackPayload(result) {
    const meta = result.emailMeta || {};
    const levelEmoji = { high: '🔴', medium: '🟠', low: '🟡', safe: '🟢' }[result.level] || '⚠️';
    return {
        text: `${levelEmoji} *Mail Güvenlik Uyarısı: ${result.labelTR || result.level}*`,
        attachments: [{
            color: { high: '#ff1744', medium: '#ff9100', low: '#ffea00', safe: '#00e676' }[result.level] || '#aaa',
            fields: [
                { title: 'Gönderen', value: meta.from?.[0]?.address || '-', short: true },
                { title: 'Konu', value: meta.subject || '-', short: true },
                { title: 'Risk Skoru', value: String(result.score || 0) + '/100', short: true },
                { title: 'Kritik Bulgular', value: String((result.findings || []).filter(f => f.severity === 'critical').length), short: true }
            ]
        }]
    };
}

async function testWebhook(url) {
    const testPayload = {
        event: 'test',
        timestamp: new Date().toISOString(),
        message: 'MailTrustAI webhook bağlantı testi başarılı.',
        source: 'mailtrustai'
    };
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload),
            signal: controller.signal
        });
        clearTimeout(timeout);
        return { success: resp.ok, status: resp.status };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { sendWebhook, testWebhook, buildSlackPayload };
