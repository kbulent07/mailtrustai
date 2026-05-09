// ============================================================
// WEBSOCKET HANDLER — Real-time notifications
// ============================================================
const { ImapMonitor } = require('../imap/monitor');
const { analyzeHeaders } = require('../analysis/headerAnalyzer');
const { analyzeContent } = require('../analysis/contentAnalyzer');
const { analyzeLinks } = require('../analysis/linkAnalyzer');
const { analyzeAttachments } = require('../analysis/attachmentAnalyzer');
const { calculateScore, resolveLevel, levelMeta } = require('../analysis/scorer');
const { validateLicenseKey, UNLICENSED_FEATURES } = require('../license/license');
const { getCachedStatus } = require('../license/remoteValidator');
const { loadCredentials } = require('../imap/connection');
const { recordScan } = require('../storage/scanHistory');
const { removeAutoMonitor, listAutoMonitors } = require('../storage/autoMonitorState');
const { loadSettings } = require('../storage/settingsStore');
const { analyzeWithClaude } = require('../integrations/claude');
const { analyzeWithOpenAI } = require('../integrations/openai');
const { scanAttachments: vtScan } = require('../integrations/virustotal');
const crypto = require('crypto');

// ─── Application services ─────────────────────────────────
const { startAutoMonitor } = require('../application/monitor/StartAutoMonitorService');
const { stopAutoMonitor }  = require('../application/monitor/StopAutoMonitorService');

const monitors = new Map();
const clients = new Set();

function resolveLicense(licenseKey) {
    if (!licenseKey) return { valid: false, features: { ...UNLICENSED_FEATURES } };
    const result = validateLicenseKey(licenseKey);
    if (!result.valid) return { valid: false, features: { ...UNLICENSED_FEATURES } };
    const remote = getCachedStatus(licenseKey);
    if (remote && !remote.allowed) return { valid: false, features: { ...UNLICENSED_FEATURES } };
    return result;
}

async function enrichWithAI(result, parsedEmail) {
    const settings = loadSettings();
    const claudeKey = settings.claudeApiKey || '';
    const openaiKey = settings.openaiApiKey || '';
    const vtKey = settings.vtApiKey || '';

    // VirusTotal ek tarama
    if (vtKey && result.attachmentDetails?.length > 0) {
        const vtCandidates = result.attachmentDetails.filter((item) => item.vtEligible !== false);
        if (vtCandidates.length > 0) {
            try {
                const vtWithContent = vtCandidates.map((item) => {
                    const srcAtt = (parsedEmail.attachments || []).find((att) => {
                        if (item.hash && att.content) {
                            const hash = crypto.createHash('sha256').update(att.content).digest('hex');
                            if (hash === item.hash) return true;
                        }
                        return att.filename === item.filename;
                    });
                    return { ...item, content: srcAtt?.content, contentType: srcAtt?.contentType, filename: srcAtt?.filename || item.filename };
                });
                const vtEntries = await vtScan(vtWithContent, vtKey);
                result.virusTotal = vtEntries;

                // VT sonuçlarını findings'e yansıt
                vtEntries.forEach((entry) => {
                    const malicious = entry.stats?.malicious || 0;
                    const suspicious = entry.stats?.suspicious || 0;
                    if (malicious > 0) {
                        result.score = Math.min(100, result.score + 20);
                        result.findings.push({ severity: 'critical', category: 'virusTotal', message: `VirusTotal: ${entry.filename} zararlı (${malicious}/${entry.stats?.total || 0} motor)` });
                    } else if (suspicious > 0) {
                        result.score = Math.min(100, result.score + 10);
                        result.findings.push({ severity: 'warning', category: 'virusTotal', message: `VirusTotal: ${entry.filename} şüpheli (${suspicious} motor)` });
                    }
                });
                recalcMeta(result);
            } catch (e) {
                console.error('[WS-Monitor] VirusTotal error:', e.message);
            }
        }
    }

    // Claude AI analizi
    if (claudeKey) {
        try {
            const claudeResult = await analyzeWithClaude(
                claudeKey,
                parsedEmail.text || parsedEmail.textAsHtml || '',
                parsedEmail.subject
            );
            if (claudeResult.success) {
                result.claudeAnalysis = claudeResult.findings;
            }
        } catch (e) {
            console.error('[WS-Monitor] Claude error:', e.message);
        }
    }

    // OpenAI analizi
    if (openaiKey) {
        try {
            const { loadSettings: ls } = require('../storage/settingsStore');
            const openaiModel = ls().openaiModel || '';
            const linkResult = { urls: (result.findings || []).filter((f) => f.category === 'link').map((f) => f.message) };
            const openaiResult = await analyzeWithOpenAI(
                openaiKey,
                { parsedData: parsedEmail, linkUrls: linkResult.urls, attachmentDetails: result.attachmentDetails || [] },
                openaiModel
            );
            if (openaiResult.success) {
                result.openaiAnalysis = openaiResult.analysis;
                applyOpenAIInsights(result, openaiResult.analysis);
            }
        } catch (e) {
            console.error('[WS-Monitor] OpenAI error:', e.message);
        }
    }

    return result;
}

function applyOpenAIInsights(result, analysis) {
    if (!analysis) return;
    const baseByThreat = { safe: 0, low: 4, medium: 10, high: 18, critical: 26 };
    const base = baseByThreat[analysis.threatLevel] || 0;
    const confMul = Math.max(0.45, Math.min(1, (analysis.confidence || 0) / 100));
    const intentMul = Math.max(0.5, Math.min(1.15, (analysis.maliciousIntentScore || 0) / 100));
    const boost = Math.round(base * confMul * intentMul);
    if (boost > 0) result.score = Math.min(100, result.score + boost);

    const severity = (t) => (t === 'critical' || t === 'high') ? 'critical' : (t === 'medium' || t === 'low') ? 'warning' : 'safe';
    // "AI verdict:" patternini koru — scorer.js forcedLevelFromFindings bunu okur
    result.findings.unshift({
        severity: severity(analysis.threatLevel),
        category: 'ai',
        message: `AI verdict: ${analysis.category} / ${analysis.threatLevel} (${analysis.confidence || 0}% confidence)`
    });
    (analysis.redFlagsTR || []).slice(0, 3).forEach((flag) => {
        result.findings.push({ severity: severity(analysis.threatLevel), category: 'ai', message: `AI uyarı: ${flag}` });
    });
    recalcMeta(result);
}

function recalcMeta(result) {
    result.level = resolveLevel(result.score, result.findings || []);
    const meta = levelMeta(result.level);
    result.color = meta.color;
    result.labelTR = meta.labelTR;
    result.labelEN = meta.labelEN;
    result.summary = {
        critical: (result.findings || []).filter((f) => f.severity === 'critical').length,
        warning: (result.findings || []).filter((f) => f.severity === 'warning').length,
        info: (result.findings || []).filter((f) => f.severity === 'info').length,
        safe: (result.findings || []).filter((f) => f.severity === 'safe').length,
        total: (result.findings || []).length
    };
}

async function startMonitorForAccount(account, license) {
    const existing = monitors.get(account.email);
    if (existing?.isRunning?.()) return existing;

    const monitor = new ImapMonitor(account, async (emailEvent) => {
        const h = analyzeHeaders(emailEvent.email);
        const c = analyzeContent(emailEvent.email, 'advanced');
        const l = analyzeLinks(emailEvent.email);
        const a = license.features?.attachmentScan
            ? analyzeAttachments(emailEvent.email.attachments || [])
            : { findings: [], score: 0, results: [] };
        const result = calculateScore(h, c, l, a);
        result.emailMeta = {
            from: emailEvent.email.from,
            to: emailEvent.email.to,
            subject: emailEvent.email.subject,
            date: emailEvent.email.date,
            attachmentCount: emailEvent.email.attachmentCount || 0
        };
        result.attachmentDetails = a.results || [];
        result.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        result.timestamp = new Date().toISOString();
        result.account = emailEvent.account;

        // AI & VT analizi (arka planda)
        try {
            await enrichWithAI(result, emailEvent.email);
        } catch (e) {
            console.error('[WS-Monitor] enrichWithAI error:', e.message);
        }

        recordScan(result);
        broadcast({ type: 'new-email-scanned', result });
    });

    await monitor.start();
    monitors.set(account.email, monitor);
    return monitor;
}

async function resumePersistedMonitors() {
    const entries = listAutoMonitors();
    if (!entries.length) return;

    const accounts = loadCredentials();
    for (const entry of entries) {
        const account = accounts.find(a => a.email === entry.email);
        if (!account) {
            console.warn(`[AutoMonitor] Kayıtlı IMAP hesabı bulunamadı, siliniyor: ${entry.email}`);
            removeAutoMonitor(entry.email);
            continue;
        }
        const license = resolveLicense(entry.licenseKey);
        if (!license.features?.autoMonitor) {
            console.warn(`[AutoMonitor] Lisans geçersiz/süresi dolmuş: ${entry.email}, atlanıyor`);
            continue;
        }
        try {
            await startMonitorForAccount(account, license);
            console.log(`[AutoMonitor] İzleme devam ettiriliyor: ${entry.email}`);
            broadcast({ type: 'monitor-started', email: entry.email });
        } catch (e) {
            console.error(`[AutoMonitor] ${entry.email} devam ettirilemedi:`, e.message);
        }
    }
}

function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        clients.add(ws);
        ws.send(JSON.stringify({
            type: 'monitor-status',
            emails: Array.from(monitors.entries())
                .filter(([, monitor]) => monitor?.isRunning?.())
                .map(([email]) => email)
        }));
        ws.on('close', () => clients.delete(ws));

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'start-monitor') {
                    const { email } = await startAutoMonitor({
                        email:                  msg.email,
                        licenseKey:             msg.licenseKey,
                        startMonitorForAccount: startMonitorForAccount
                    });
                    broadcast({ type: 'monitor-started', email });
                }
                if (msg.type === 'stop-monitor') {
                    const licStop = resolveLicense(msg.licenseKey);
                    if (!licStop.features?.autoMonitor) {
                        throw new Error('Otomatik izleme Enterprise lisansı gerektirir');
                    }
                    await stopAutoMonitor({ email: msg.email, monitors });
                    broadcast({ type: 'monitor-stopped', email: msg.email });
                }
            } catch (e) {
                ws.send(JSON.stringify({ type: 'error', message: e.message }));
            }
        });
    });

    // Sunucu açıldığında daha önce aktif olan izleyicileri otomatik devam ettir
    setTimeout(() => {
        resumePersistedMonitors().catch(e =>
            console.error('[AutoMonitor] Resume error:', e.message)
        );
    }, 8 * 1000);

    // Her saat başı çalışan lisans geçerlilik kontrolü:
    // Süresi dolmuş / iptal edilmiş lisansa sahip aktif monitörleri durdurur.
    setInterval(async () => {
        const entries = listAutoMonitors();
        for (const entry of entries) {
            const license = resolveLicense(entry.licenseKey);
            if (!license.features?.autoMonitor) {
                const monitor = monitors.get(entry.email);
                if (monitor?.isRunning?.()) {
                    console.warn(`[AutoMonitor] Lisans geçersiz/süresi dolmuş → monitör durduruluyor: ${entry.email}`);
                    await monitor.stop().catch(() => {});
                    monitors.delete(entry.email);
                    removeAutoMonitor(entry.email);
                    broadcast({ type: 'monitor-stopped', email: entry.email, reason: 'license-expired' });
                }
            }
        }
    }, 60 * 60 * 1000); // saatte bir
}

function broadcast(data) {
    const msg = JSON.stringify(data);
    clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

module.exports = { setupWebSocket };
