// ============================================================
// Unit tests: ScanMailboxMonitor reportMode davranışı
// ─ "all"   → her mail için rapor gönderilir (safe dahil)
// ─ "risky" → yalnızca riskli mailler için rapor gönderilir
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

/**
 * Tek bir senaryo üretir: belirtilen reportMode + level ile bir maili işler,
 * SMTP gönderiminin yapılıp yapılmadığını döner.
 */
async function runScenario({ reportMode, level }) {
    const monitorPath = '../../src/imap/scanMailboxMonitor';

    const sendCalls = [];
    const recordedScans = [];

    // Tüm dış bağımlılıkları stub'la
    clearModule(monitorPath);
    const mocked = [
        mockModule('../../src/imap/monitor', {
            ImapMonitor: class {
                constructor() {}
                async start() { return { success: true }; }
                async stop()  { return true; }
                isRunning() { return true; }
            }
        }),
        mockModule('../../src/imap/scanner', {
            listEmails: async () => ({ success: true, messages: [] }),
            fetchAndParseEmail: async () => ({ success: false })
        }),
        mockModule('../../src/smtp/sender', {
            sendReportEmail: async (args) => {
                sendCalls.push(args);
                return { success: true };
            }
        }),
        mockModule('../../src/smtp/reportBuilder', {
            buildReportHtml: () => '<html>report</html>',
            // isRisky: high/medium = riskli, safe/low = değil
            isRisky: (r) => r && (r.level === 'high' || r.level === 'medium')
        }),
        mockModule('../../src/storage/scanHistory', {
            recordScan: (entry) => recordedScans.push(entry),
            loadScanHistory: () => []
        }),
        mockModule('../../src/imap/quarantineService', {
            maybeMoveMessageToQuarantine: async () => ({ moved: false })
        }),
        mockModule('../../src/imap/scanExclusions', {
            // Test maili harici → atlanmasın
            getImapSenderSkipInfo: () => ({ skip: false, fromEmail: 'sender@example.com', reason: null })
        })
    ];

    // ─── In-memory state dosyası simülasyonu (fs'i mocklamayalım, geçici dosya) ────
    const path  = require('path');
    const fs    = require('fs');
    const os    = require('os');
    const tmp   = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-test-'));
    const stateFile = path.join(tmp, 'scan-mailbox-state.json');
    // monitor STATE_FILE'ı '..', '..', 'data' altında bekliyor; testte
    // bu dosyayı oluşturmaya çalışırsa zarar vermez — temiz state için boş.

    const { ScanMailboxMonitor } = require(monitorPath);

    const monitor = new ScanMailboxMonitor({
        account: { email: 'inbox@example.com' },
        smtpConfig: {
            smtpHost: 'smtp.example.com',
            smtpPort: 587,
            smtpUser: 'inbox@example.com',
            smtpFromName: 'Test',
            reportTo: 'admin@example.com'
        },
        buildAnalysisFn: async (email) => ({
            level,
            score: level === 'high' ? 80 : 5,
            labelTR: level === 'high' ? 'Tehlikeli' : 'Güvenli',
            findings: []
        }),
        lang: 'tr',
        reportMode,
        reportToForwarder: false,
        allowedDomains: []
    });

    // markProcessed/isProcessed dosyaya yazıyor — basitleştirmek için no-op'la
    monitor.isProcessed   = () => false;
    monitor.markProcessed = () => {};

    // Yeni mail simülasyonu
    await monitor._onNewEmail({
        uid: 42,
        email: {
            subject: 'Test mail',
            from: [{ address: 'sender@example.com' }]
        },
        account: 'inbox@example.com'
    });

    // Cleanup
    mocked.forEach(clearModule);
    clearModule(monitorPath);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

    return { sendCalls, recordedScans };
}

// ─── Senaryo testleri ─────────────────────────────────────────────────────

test('reportMode="all" + safe mail → rapor GÖNDERİLİR', async () => {
    const { sendCalls } = await runScenario({ reportMode: 'all', level: 'safe' });
    assert.equal(sendCalls.length, 1, 'sendReportEmail tam 1 kez çağrılmalı');
    assert.equal(sendCalls[0].to, 'admin@example.com');
});

test('reportMode="all" + high-risk mail → rapor GÖNDERİLİR', async () => {
    const { sendCalls } = await runScenario({ reportMode: 'all', level: 'high' });
    assert.equal(sendCalls.length, 1);
});

test('reportMode="risky" + safe mail → rapor GÖNDERİLMEZ', async () => {
    const { sendCalls, recordedScans } = await runScenario({ reportMode: 'risky', level: 'safe' });
    assert.equal(sendCalls.length, 0, 'sendReportEmail çağrılmamalı');
    // Atlandı kaydı tutulmalı
    assert.equal(recordedScans.length, 1);
    assert.equal(recordedScans[0].autoReplySent, false);
    assert.equal(recordedScans[0].autoReplySkipped, true);
});

test('reportMode="risky" + high-risk mail → rapor GÖNDERİLİR', async () => {
    const { sendCalls } = await runScenario({ reportMode: 'risky', level: 'high' });
    assert.equal(sendCalls.length, 1);
});
