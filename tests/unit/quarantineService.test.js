const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_QUARANTINE_FOLDER,
    isQuarantineMoveEnabled,
    shouldMoveMessageToQuarantine
} = require('../../src/imap/quarantineService');

test('isQuarantineMoveEnabled only accepts explicit account opt-in', () => {
    assert.equal(isQuarantineMoveEnabled({ moveHighRiskToQuarantine: true }), true);
    assert.equal(isQuarantineMoveEnabled({ moveHighRiskToQuarantine: 'true' }), true);
    assert.equal(isQuarantineMoveEnabled({ moveHighRiskToQuarantine: false }), false);
    assert.equal(isQuarantineMoveEnabled({}), false);
});

test('shouldMoveMessageToQuarantine moves high level messages', () => {
    assert.equal(shouldMoveMessageToQuarantine({ level: 'high', findings: [] }), true);
    assert.equal(shouldMoveMessageToQuarantine({ level: 'medium', findings: [] }), false);
});

test('shouldMoveMessageToQuarantine also moves critical finding messages', () => {
    assert.equal(shouldMoveMessageToQuarantine({
        level: 'low',
        findings: [{ severity: 'critical', category: 'ai', message: 'Critical verdict' }]
    }), true);
    assert.equal(DEFAULT_QUARANTINE_FOLDER.length > 0, true);
});
