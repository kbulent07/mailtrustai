const test = require('node:test');
const assert = require('node:assert/strict');

const {
    finalizeAnalysisResult
} = require('../../src/application/analyze/AnalyzeMessageService');

test('finalizeAnalysisResult applies shared metadata without requiring persistence', () => {
    const result = finalizeAnalysisResult({
        score: 42,
        findings: []
    }, {
        license: { licenseKey: 'MSA-TEST-1234' },
        scanSource: 'scan-mailbox',
        account: 'demo@example.com',
        persist: false,
        incrementCounts: false,
        extraFields: { customFlag: true }
    });

    assert.equal(result.scanSource, 'scan-mailbox');
    assert.equal(result.licenseKey, 'MSA-TEST-1234');
    assert.equal(result.account, 'demo@example.com');
    assert.equal(result.customFlag, true);
    assert.equal(result.score, 42);
});
