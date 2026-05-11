// ============================================================
// Unit tests: analyze services pass license scope to scan counters
// ============================================================
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

test('analyzeParsedEmailData increments counters with the resolved license', async () => {
    const servicePath = '../../src/application/analyze/AnalyzeMessageService';
    const license = { licenseKey: 'MSA-PRO-T1-M-DIRECT-TEST', usageScope: 'license-scope-1', features: {} };
    const calls = [];

    clearModule(servicePath);
    const mocked = [
        mockModule('../../src/analysis/emailAnalyzer', {
            buildEmailAnalysisResult: async () => ({ id: 'scan-1', findings: [], level: 'safe' }),
            buildAttachmentOnlyResult: () => ({}),
            applyVirusTotalInsights: () => {}
        }),
        mockModule('../../src/storage/scanHistory', {
            recordScan: result => [result]
        }),
        mockModule('../../src/services/appState', {
            state: { scanHistory: [] },
            incrementScanCounts: received => calls.push(received)
        })
    ];

    try {
        const { analyzeParsedEmailData } = require(servicePath);
        await analyzeParsedEmailData({ parsedData: { subject: 'hello' }, license, scanSource: 'upload' });
        assert.deepEqual(calls, [license]);
    } finally {
        clearModule(servicePath);
        mocked.forEach(resolved => delete require.cache[resolved]);
    }
});

test('analyzeStandaloneAttachmentFile increments counters with the resolved license', async () => {
    const servicePath = '../../src/application/analyze/AnalyzeMessageService';
    const license = { licenseKey: 'MSA-ENT-T2-M-DIRECT-TEST', usageScope: 'license-scope-2', features: {} };
    const calls = [];

    clearModule(servicePath);
    const mocked = [
        mockModule('../../src/analysis/emailAnalyzer', {
            buildEmailAnalysisResult: async () => ({}),
            buildAttachmentOnlyResult: () => ({ id: 'scan-2', findings: [], vtStatus: {} }),
            applyVirusTotalInsights: () => {}
        }),
        mockModule('../../src/analysis/attachmentAnalyzer', {
            analyzeAttachments: () => ({ results: [], findings: [] })
        }),
        mockModule('../../src/integrations/virustotal', {
            scanAttachments: async () => []
        }),
        mockModule('../../src/storage/scanHistory', {
            recordScan: result => [result]
        }),
        mockModule('../../src/services/appState', {
            state: { scanHistory: [] },
            incrementScanCounts: received => calls.push(received)
        })
    ];

    try {
        const { analyzeStandaloneAttachmentFile } = require(servicePath);
        await analyzeStandaloneAttachmentFile({
            file: {
                filename: 'invoice.pdf',
                mimetype: 'application/pdf',
                size: 10,
                buffer: Buffer.from('pdf')
            },
            license,
            scanSource: 'upload'
        });
        assert.deepEqual(calls, [license]);
    } finally {
        clearModule(servicePath);
        mocked.forEach(resolved => delete require.cache[resolved]);
    }
});

test('runManualImapScan forwards IMAP mail into the shared analysis engine', async () => {
    const servicePath = '../../src/application/analyze/AnalyzeImapMailService';
    const license = { licenseKey: 'MSA-ENT-T3-M-DIRECT-TEST', usageScope: 'license-scope-3', features: {}, plan: 'enterprise' };
    const calls = [];

    clearModule(servicePath);
    const mocked = [
        mockModule('../../src/imap/scanner', {
            fetchAndParseEmail: async () => ({ success: true, data: { subject: 'imap mail' } })
        }),
        mockModule('../../src/application/analyze/AnalyzeMessageService', {
            analyzeParsedEmailData: async (payload) => {
                calls.push(payload);
                return { id: 'scan-3', findings: [], level: 'safe', account: payload.account };
            }
        }),
        mockModule('../../src/services/reportService', {
            sendEnterpriseRiskAlert: async () => null
        })
    ];

    try {
        const { runManualImapScan } = require(servicePath);
        const out = await runManualImapScan({
            account: { email: 'user@example.com' },
            uid: 42,
            folder: 'INBOX',
            license
        });
        assert.equal(out.ok, true);
        assert.deepEqual(calls, [{
            parsedData: { subject: 'imap mail' },
            license,
            scanSource: 'imap-manual',
            account: 'user@example.com'
        }]);
    } finally {
        clearModule(servicePath);
        mocked.forEach(resolved => delete require.cache[resolved]);
    }
});
