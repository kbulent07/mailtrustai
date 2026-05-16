'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// Heartbeat payload'unun yasak alan içermediğini doğrular.
const { scrubPII, PII_KEYS } = require('@mailtrustai/shared');

test('scrubPII yasak anahtarları [REDACTED] yapar', () => {
    const evil = {
        instanceId: 'inst_1', monthlyScanCount: 12,
        mailBody: 'gizli', mailSubject: 'gizli', sender: 'a@b', recipient: 'c@d',
        rawHeaders: { x: 'y' }, attachments: [{ name: 'kötü.pdf', content: 'binary' }],
        credentials: { imapPassword: 'p', openaiApiKey: 'sk-xxx' }
    };
    const cleaned = scrubPII(evil);
    assert.strictEqual(cleaned.mailBody, '[REDACTED]');
    assert.strictEqual(cleaned.mailSubject, '[REDACTED]');
    assert.strictEqual(cleaned.sender, '[REDACTED]');
    assert.strictEqual(cleaned.recipient, '[REDACTED]');
    assert.strictEqual(cleaned.rawHeaders, '[REDACTED]');
    assert.strictEqual(cleaned.attachments, '[REDACTED]');
    assert.strictEqual(cleaned.credentials, '[REDACTED]');
    // operasyonel sayaçlar korunur
    assert.strictEqual(cleaned.monthlyScanCount, 12);
    assert.strictEqual(cleaned.instanceId, 'inst_1');
});

test('PII_KEYS kritik alanları içerir', () => {
    for (const k of ['mailBody','mailSubject','sender','recipient','attachmentName','attachmentContent','rawHeaders','imapPassword','smtpPassword','openaiApiKey','claudeApiKey','virustotalApiKey','credentials','aiPrompt','aiResponse']) {
        assert.ok(PII_KEYS.has(k), `${k} PII_KEYS içinde olmalı`);
    }
});
