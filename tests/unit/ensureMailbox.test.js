// ============================================================
// Unit tests: ensureMailbox alreadyExists tespiti
//   Zimbra ham ImapFlow yanıtı:
//     error.message      = "Command failed"
//     error.responseText = "CREATE failed: mailbox already exists"
//     error.responseCode = undefined
//   Eski kod yalnızca message+responseCode'a bakıyordu, alreadyExists'i
//   yakalayamayıp throw ediyordu → moveMessageToQuarantine fail oluyordu.
// ============================================================
const test   = require('node:test');
const assert = require('node:assert/strict');

// quarantineService modülü dış bağımlılık (connection) gerektiriyor — testte
// gerek yok, doğrudan ensureMailbox'i içeriden export etmediği için sadece
// davranışı reproduce eden minimal bir copy yapıyoruz. Burada, ham regex
// mantığını da aynısıyla sınamak için içerideki helper'ı çağırmak yerine
// fonksiyonun MAILBOX-already-exists davranışını mock'lu bir client ile
// doğruluyoruz.

function makeMockClient({ failOnce = true, errorPayload = null } = {}) {
    let called = 0;
    return {
        mailboxCreate: async () => {
            called++;
            if (failOnce && errorPayload) {
                const e = new Error(errorPayload.message || 'Command failed');
                Object.assign(e, errorPayload);
                throw e;
            }
        },
        get callCount() { return called; }
    };
}

// İlgili fonksiyonu doğrudan require edebilmek için quarantineService'in
// connection bağımlılığını mockla.
const path = require('path');
function clearModule(p) { delete require.cache[require.resolve(p)]; }
function mockModule(p, exports) {
    const resolved = require.resolve(p);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

function loadFreshQuarantineService() {
    clearModule('../../src/imap/quarantineService');
    mockModule('../../src/imap/connection', {
        createConnection: async () => ({ connect: async () => {}, logout: async () => {} }),
        loadCredentials:  () => []
    });
    return require('../../src/imap/quarantineService');
}

// quarantineService.js'in INTERNAL ensureMailbox'ını test etmek için
// modülün özel davranışını taklit eden tarayıcı stub değil — doğrudan
// gerçek fonksiyonu çağırmak istiyoruz; bunun için modulü mockla yükle
// ve mailboxCreate çağrısının dışsal davranışını gözlemle.
//
// Pratik bir test: moveMessageToQuarantine sahte client ile çalıştırılır
// ve mailboxCreate "already exists" hatası verirken throw etmemeli.

test('ensureMailbox: Zimbra-style responseText "mailbox already exists" YAKALANIR', async () => {
    // quarantineService modülünün INTERNAL ensureMailbox'ına erişmek için
    // moveMessageToQuarantine'i çağırıyoruz — sahte client'la.
    const svc = loadFreshQuarantineService();

    // moveMessageToQuarantine kendi içinde createConnection çağırıyor; bu
    // fonksiyonu monkeypatch ediyoruz ki sahte client'ımızı dönsün.
    const sentMoves = [];
    const fakeClient = {
        connect: async () => {},
        logout: async () => {},
        getMailboxLock: async () => ({ release: () => {} }),
        mailboxCreate: async () => {
            // Zimbra'nın gerçek hata payload'u:
            const e = new Error('Command failed');
            e.responseText = 'CREATE failed: mailbox already exists';
            // responseCode YOK — eski kod buradan tespit edemiyordu
            throw e;
        },
        messageMove: async (uid, dest) => {
            sentMoves.push({ uid, dest });
            return { uidMap: new Map([[uid, uid + 1000]]) };
        }
    };
    // connection.createConnection'ı tekrar override et — fakeClient dönsün
    mockModule('../../src/imap/connection', {
        createConnection: async () => fakeClient,
        loadCredentials:  () => []
    });
    clearModule('../../src/imap/quarantineService');
    const svc2 = require('../../src/imap/quarantineService');

    // moveMessageToQuarantine'i export etmiyor → ensureFolderForAccount üzerinden
    // ensureMailbox path'ini test ediyoruz; aynı catch logic'i çalışır.
    const result = await svc2.ensureFolderForAccount(
        { email: 'test@example.com' },
        'mailreports'
    );

    assert.equal(result.ok, true, 'alreadyExists → ok=true beklenir (sessizce geçer)');
    assert.equal(result.folder, 'mailreports');
});

test('ensureMailbox: gerçek bir hata throw eder (yetki yok vb.)', async () => {
    const fakeClient = {
        connect: async () => {},
        logout: async () => {},
        mailboxCreate: async () => {
            const e = new Error('Command failed');
            e.responseText = 'CREATE failed: permission denied';
            throw e;
        }
    };
    mockModule('../../src/imap/connection', {
        createConnection: async () => fakeClient,
        loadCredentials:  () => []
    });
    clearModule('../../src/imap/quarantineService');
    const svc = require('../../src/imap/quarantineService');

    const result = await svc.ensureFolderForAccount(
        { email: 'test@example.com' },
        'mailreports'
    );

    assert.equal(result.ok, false, 'gerçek hata ok=false vermeli');
    assert.match(result.error || '', /Command failed/);
});

test('DEFAULT_COLLECT_FOLDER artık "mailreports"', () => {
    clearModule('../../src/imap/quarantineService');
    mockModule('../../src/imap/connection', {
        createConnection: async () => ({}),
        loadCredentials:  () => []
    });
    const svc = require('../../src/imap/quarantineService');
    assert.equal(svc.DEFAULT_COLLECT_FOLDER, 'mailreports');
});
