const test = require('node:test');
const assert = require('node:assert/strict');

function mockModule(modulePath, exports) {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports
    };
    return resolved;
}

function clearModule(modulePath) {
    delete require.cache[require.resolve(modulePath)];
}

test('buildEmailAnalysisResult records abuse feed link matches as first-class findings', async () => {
    const modulePath = '../../src/analysis/emailAnalyzer';
    clearModule(modulePath);

    const mocked = [
        mockModule('../../src/analysis/headerAnalyzer', {
            analyzeHeaders: () => ({ score: 0, findings: [] })
        }),
        mockModule('../../src/analysis/contentAnalyzer', {
            analyzeContent: () => ({ score: 0, findings: [] })
        }),
        mockModule('../../src/analysis/linkAnalyzer', {
            analyzeLinks: () => ({ score: 0, findings: [], urls: ['http://bad.example/path'] }),
            resolveShortUrls: async () => [],
            applyResolvedUrlFindings: () => {},
            extractUrls: () => ['http://bad.example/path']
        }),
        mockModule('../../src/analysis/attachmentAnalyzer', {
            analyzeAttachments: () => ({ score: 0, findings: [], results: [] })
        }),
        mockModule('../../src/analysis/scorer', {
            calculateScore: () => ({
                score: 0,
                level: 'safe',
                color: '#00e676',
                labelTR: 'Guvenli',
                labelEN: 'Safe',
                summary: { critical: 0, warning: 0, info: 0, safe: 0, total: 0 },
                findings: [],
                breakdown: {}
            }),
            resolveLevel: () => 'safe',
            levelMeta: (level) => ({
                safe: { color: '#00e676', labelTR: 'Guvenli', labelEN: 'Safe' },
                high: { color: '#ff1744', labelTR: 'Yuksek Risk', labelEN: 'High Risk' }
            }[level] || { color: '#00e676', labelTR: 'Guvenli', labelEN: 'Safe' }),
            effectiveLevelFromResult: (result) => (
                (result.findings || []).some((finding) => finding.category === 'abuse') ? 'high' : 'safe'
            ),
            levelEscalationReason: () => null
        }),
        mockModule('../../src/integrations/virustotal', {
            scanAttachments: async () => []
        }),
        mockModule('../../src/integrations/claude', {
            analyzeWithClaude: async () => ({ success: false })
        }),
        mockModule('../../src/integrations/openai', {
            analyzeWithOpenAI: async () => ({ success: false }),
            adjudicateRisk: async () => ({ success: false }),
            OPENAI_MODEL: 'gpt-4o-mini'
        }),
        mockModule('../../src/analysis/triage', {
            triage: () => ({ shouldAdjudicate: false })
        }),
        mockModule('../../src/analysis/evidencePack', {
            buildEvidencePack: () => ({})
        }),
        mockModule('../../src/storage/settingsStore', {
            loadSettings: () => ({ riskMode: 'classic' })
        }),
        mockModule('../../src/integrations/otx', {
            checkEmailIndicators: async () => ({ indicators: [], summary: {} }),
            severityFromVerdict: () => 'safe',
            scoreFromVerdict: () => 0
        }),
        mockModule('../../src/storage/allowlistStore', {
            isAllowlisted: () => false,
            isBlocklisted: () => false
        }),
        mockModule('../../src/integrations/threatIntel', {
            isThreatUrl: (url) => url === 'http://bad.example/path',
            isThreatDomain: () => false,
            getThreatIntelStats: () => ({ available: true, updatedAt: '2026-05-11T00:00:00.000Z' })
        }),
        mockModule('../../src/integrations/webhook', {
            sendWebhook: async () => {}
        }),
        mockModule('../../src/services/appState', {
            state: {
                vtApiKey: '',
                otxApiKey: '',
                claudeApiKey: '',
                openaiApiKey: '',
                openaiModel: ''
            }
        })
    ];

    try {
        const { buildEmailAnalysisResult } = require(modulePath);
        const result = await buildEmailAnalysisResult({
            from: [{ address: 'sender@example.com' }],
            to: [{ address: 'receiver@example.com' }],
            subject: 'abuse test',
            text: 'Visit http://bad.example/path',
            html: '',
            attachments: [],
            attachmentCount: 0
        }, { features: {} });

        assert.equal(result.abuseStatus.available, true);
        assert.equal(result.abuseStatus.hits, 1);
        assert.equal(result.findings.some((finding) => finding.category === 'abuse'), true);
        assert.deepEqual(result.abuseData.matches, [
            { type: 'url', value: 'http://bad.example/path', source: 'URLhaus/OpenPhish' }
        ]);
    } finally {
        clearModule(modulePath);
        mocked.forEach((resolved) => delete require.cache[resolved]);
    }
});
