// ============================================================
// KONU İŞARETLEYİCİ (RISK EMOJI DECORATOR)
//
// Risk seviyesine göre IMAP mail konusuna emoji öneki ekler:
//   • high      → '🔴 '
//   • medium    → '🟣 '
//   • diğer     → değişiklik yok
//
// İşlem: fetch (raw RFC822) → Subject header değiştir → APPEND → DELETE
//
// Orijinal konu `X-MailTrustAI-Original-Subject` header'ına base64 olarak
// yazılır → geri alma (unmark) işlemi orijinali sorunsuz restore eder.
//
// Tarih (Date header + INTERNALDATE), flag'ler (\Seen, \Flagged) ve
// gönderici/içerik korunur. Sadece UID değişir.
// ============================================================
'use strict';

const { createConnection, loadCredentials } = require('./connection');
const { findMessageByMessageId } = require('./messageLocator');

// ─── Sabitler ─────────────────────────────────────────────────
const PREFIX_HIGH   = '🔴 ';
const PREFIX_MEDIUM = '🟣 ';

const HEADER_DECORATED        = 'X-MailTrustAI-Decorated';
const HEADER_ORIGINAL_SUBJECT = 'X-MailTrustAI-Original-Subject';
const HEADER_RISK_LEVEL       = 'X-MailTrustAI-Risk-Level';

// ─── Yardımcılar ──────────────────────────────────────────────

function isFeatureEnabled(account) {
    return account?.markRiskySubject === true || account?.markRiskySubject === 'true';
}

function prefixForLevel(level) {
    const lower = String(level || '').toLowerCase();
    if (lower === 'high' || lower === 'critical') return PREFIX_HIGH;
    if (lower === 'medium')                       return PREFIX_MEDIUM;
    return null;
}

/**
 * Mail zaten bizim tarafımızdan işaretlenmiş mi?
 * Parse edilmiş email nesnesinin headers Map/Object'inde kontrol eder.
 * Self-loop koruması için kritik — re-scan döngüsünü engeller.
 */
function isAlreadyDecorated(parsedEmail) {
    if (!parsedEmail) return false;

    // mailparser çıktısı: parsedEmail.headers (Map) veya parsedEmail.headerLines (Array)
    const hdrs = parsedEmail.headers;
    if (hdrs instanceof Map) {
        if (hdrs.has(HEADER_DECORATED.toLowerCase())) return true;
    } else if (hdrs && typeof hdrs === 'object') {
        if (hdrs[HEADER_DECORATED] || hdrs[HEADER_DECORATED.toLowerCase()]) return true;
    }

    // Yedek kontrol: subject zaten 🔴 veya 🟣 ile başlıyor mu?
    const subj = String(parsedEmail.subject || '');
    if (subj.startsWith(PREFIX_HIGH) || subj.startsWith(PREFIX_MEDIUM)) return true;

    return false;
}

/**
 * Subject metnini RFC 2047 B-encoding ile UTF-8 base64'e çevirir.
 * Tüm client'lar emoji + Türkçe karakterleri doğru gösterir.
 */
function encodeSubjectRFC2047(text) {
    const b64 = Buffer.from(String(text), 'utf8').toString('base64');
    return `=?UTF-8?B?${b64}?=`;
}

/**
 * Raw RFC822 buffer içinde Subject header'ını değiştirir + tracking header'ları ekler.
 * Header folding (devam eden satırlar) desteklenir.
 *
 * @param {Buffer} rawBuffer    - imapflow'dan dönen orijinal source
 * @param {string} newSubject   - Yeni konu (emoji önekli)
 * @param {string} origSubject  - Orijinal konu (geri alma için saklanır)
 * @param {string} riskLevel    - 'high' veya 'medium'
 * @returns {Buffer} Değiştirilmiş raw mail (Buffer)
 */
function rewriteSubjectInRaw(rawBuffer, newSubject, origSubject, riskLevel) {
    // CRLF veya LF — IMAP standardı CRLF ama bazı sunucular LF gönderir
    const raw = rawBuffer.toString('binary'); // 8-bit safe (UTF-8 byte'larını koru)

    const crlfSep = raw.indexOf('\r\n\r\n');
    const lfSep   = raw.indexOf('\n\n');
    let sepIdx, sepLen, eol;
    if (crlfSep !== -1 && (lfSep === -1 || crlfSep <= lfSep)) {
        sepIdx = crlfSep; sepLen = 4; eol = '\r\n';
    } else if (lfSep !== -1) {
        sepIdx = lfSep; sepLen = 2; eol = '\n';
    } else {
        // Header/body ayrımı yok — tüm mail header olabilir, sonuna ekle
        sepIdx = raw.length; sepLen = 0; eol = '\r\n';
    }

    let headers = raw.slice(0, sepIdx);
    const body  = raw.slice(sepIdx); // separator dahil

    // Header satırlarına böl
    const lines = headers.split(eol);

    // Subject header'ını bul (folding ile beraber)
    let subjStart = -1, subjEnd = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^Subject\s*:/i.test(lines[i])) {
            subjStart = i;
            subjEnd   = i;
            // Folded continuation: bir sonraki satır WSP ile başlıyorsa
            while (subjEnd + 1 < lines.length && /^[ \t]/.test(lines[subjEnd + 1])) {
                subjEnd++;
            }
            break;
        }
    }

    // Yeni Subject satırı + tracking header'lar
    const encodedSubj = encodeSubjectRFC2047(newSubject);
    const origB64     = Buffer.from(String(origSubject || ''), 'utf8').toString('base64');

    const newLines = [
        `Subject: ${encodedSubj}`,
        `${HEADER_DECORATED}: 1`,
        `${HEADER_ORIGINAL_SUBJECT}: ${origB64}`,
        `${HEADER_RISK_LEVEL}: ${String(riskLevel || '').toLowerCase()}`
    ];

    if (subjStart >= 0) {
        // Mevcut Subject (ve folding) satırlarını değiştir + tracking ekle
        lines.splice(subjStart, subjEnd - subjStart + 1, ...newLines);
    } else {
        // Subject yoksa header'ın sonuna ekle
        lines.push(...newLines);
    }

    const newRaw = lines.join(eol) + body;
    return Buffer.from(newRaw, 'binary');
}

/**
 * Decorated mailden orijinal subject'i çıkarır.
 * X-MailTrustAI-Original-Subject header'ından base64 decode eder.
 */
function extractOriginalSubject(parsedEmail) {
    if (!parsedEmail) return null;

    const hdrs = parsedEmail.headers;
    let b64 = null;
    if (hdrs instanceof Map) {
        b64 = hdrs.get(HEADER_ORIGINAL_SUBJECT.toLowerCase()) || hdrs.get(HEADER_ORIGINAL_SUBJECT);
    } else if (hdrs && typeof hdrs === 'object') {
        b64 = hdrs[HEADER_ORIGINAL_SUBJECT.toLowerCase()] || hdrs[HEADER_ORIGINAL_SUBJECT];
    }

    if (!b64 || typeof b64 !== 'string') return null;
    try {
        return Buffer.from(b64, 'base64').toString('utf8');
    } catch (_) {
        return null;
    }
}

/**
 * Decorated mailden tracking header'larını söker ve Subject'i orijinaline döndürür.
 * Raw seviyesinde çalışır → APPEND için yeni temiz raw döner.
 */
function stripDecorationFromRaw(rawBuffer, originalSubject) {
    const raw = rawBuffer.toString('binary');
    const crlfSep = raw.indexOf('\r\n\r\n');
    const lfSep   = raw.indexOf('\n\n');
    let sepIdx, sepLen, eol;
    if (crlfSep !== -1 && (lfSep === -1 || crlfSep <= lfSep)) {
        sepIdx = crlfSep; sepLen = 4; eol = '\r\n';
    } else if (lfSep !== -1) {
        sepIdx = lfSep; sepLen = 2; eol = '\n';
    } else {
        return rawBuffer;
    }

    let headers = raw.slice(0, sepIdx);
    const body  = raw.slice(sepIdx);
    const lines = headers.split(eol);

    const trackingHeaders = new Set([
        HEADER_DECORATED.toLowerCase(),
        HEADER_ORIGINAL_SUBJECT.toLowerCase(),
        HEADER_RISK_LEVEL.toLowerCase()
    ]);

    const filtered = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Subject: emoji öneğini kaldır
        if (/^Subject\s*:/i.test(line)) {
            const encodedSubj = encodeSubjectRFC2047(originalSubject);
            filtered.push(`Subject: ${encodedSubj}`);
            // Folding satırlarını atla
            while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) i++;
            continue;
        }

        // Tracking header'larını çıkar
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            const headerName = line.slice(0, colonIdx).trim().toLowerCase();
            if (trackingHeaders.has(headerName)) {
                // Folding satırlarını da atla
                while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) i++;
                continue;
            }
        }

        filtered.push(line);
    }

    return Buffer.from(filtered.join(eol) + body, 'binary');
}

// ─── Ana operasyonlar ────────────────────────────────────────

/**
 * Maili decorate eder (etiket ekler) — IMAP ayarı açıksa ve risk seviyesi uygunsa.
 *
 * @param {object} opts
 * @param {object} opts.account       - IMAP hesap nesnesi
 * @param {number} opts.uid           - Hedef mail UID'si
 * @param {string} opts.level         - 'high' | 'medium' | 'low' | 'safe'
 * @param {object} opts.parsedEmail   - Parse edilmiş mail (self-loop kontrolü için)
 * @param {string} [opts.folder='INBOX']
 * @returns {Promise<object>} { attempted, decorated, newUid?, prefix?, reason? }
 */
async function maybeDecorateSubject({ account, uid, level, parsedEmail, folder = 'INBOX' }) {
    // Diskten güncel ayarı oku (kullanıcı checkbox'u açtıysa restart gerekmesin)
    const stored = account?.email
        ? (loadCredentials().find(a => a.email === account.email) || account)
        : account;

    if (!isFeatureEnabled(stored)) {
        return { attempted: false, decorated: false, reason: 'disabled' };
    }
    if (!uid) {
        return { attempted: false, decorated: false, reason: 'missing-uid' };
    }

    const prefix = prefixForLevel(level);
    if (!prefix) {
        return { attempted: false, decorated: false, reason: 'not-eligible' };
    }

    // Self-loop: kendi etiketlediğimiz mail tekrar gelmesin
    if (isAlreadyDecorated(parsedEmail)) {
        return { attempted: false, decorated: false, reason: 'already-decorated' };
    }

    const origSubject = String(parsedEmail?.subject || '');
    const newSubject  = prefix + origSubject;
    const riskLevel   = String(level || '').toLowerCase();

    console.log(`[SubjectDecorator] Etiket ekleniyor: ${account.email} uid=${uid} level=${riskLevel} → "${prefix}..."`);

    let client = null;
    let lock = null;
    // Gerçek konum (locator ile değişebilir)
    let actualFolder = folder;
    let actualUid    = uid;
    let movedExternally = false;

    try {
        // stored: diskten taze (güncel şifre) — UI'dan şifre değiştirilince
        // monitor in-memory eski şifreyle kalmasın diye onu kullanırız.
        client = await createConnection(stored || account);
        await client.connect();

        // ─── 1) ÖNCE: tercih edilen klasörde mail hâlâ var mı? ──────────────
        let foundInPreferred = false;
        try {
            const tryLock = await client.getMailboxLock(folder);
            try {
                const m = await client.search({ uid: String(uid) }, { uid: true });
                foundInPreferred = !!(m && m.length > 0);
            } finally { try { await tryLock.release(); } catch (_) {} }
        } catch (_) { /* tercih klasörü erişilemiyor — locator'a düş */ }

        // ─── 2) BULUNAMADIYSA: Message-ID ile tüm klasörlerde ara ───────────
        if (!foundInPreferred) {
            const messageId = parsedEmail?.messageId;
            if (!messageId) {
                console.warn(`[SubjectDecorator] ⚠ Mail ${folder} klasöründe yok ve Message-ID bilinmiyor — arama yapılamaz.`);
                return {
                    attempted: true, decorated: false,
                    reason: 'mail-not-found-no-messageid'
                };
            }
            console.log(`[SubjectDecorator] Mail "${folder}" klasöründe yok — Message-ID ile aranıyor: ${messageId}`);
            const found = await findMessageByMessageId(client, messageId, { preferFolder: folder });
            if (!found) {
                return {
                    attempted: true, decorated: false,
                    reason: 'mail-not-found-anywhere',
                    messageId
                };
            }
            actualFolder = found.folder;
            actualUid    = found.uid;
            movedExternally = true;
            console.log(`[SubjectDecorator] ✓ Mail bulundu: "${actualFolder}" uid=${actualUid} — orada etiketleniyor`);
        }

        // ─── 3) Hedef klasör üzerinde lock al ve işleme başla ───────────────
        lock = await client.getMailboxLock(actualFolder);

        // Orijinal maili tüm metadata ile çek
        let original = null;
        for await (const msg of client.fetch(actualUid, {
            source:       true,
            internalDate: true,
            flags:        true
        }, { uid: true })) {
            original = msg;
            break;
        }

        if (!original?.source) {
            // SEARCH OK demişti ama FETCH boş döndü — yarış koşulu (mail bu saniyede taşındı/silindi)
            console.warn(`[SubjectDecorator] ⚠ FETCH boş döndü folder=${actualFolder} uid=${actualUid} — mail bu sırada taşınmış olabilir`);
            return { attempted: true, decorated: false, reason: 'fetch-empty-race', folder: actualFolder, uid: actualUid };
        }

        // ─── ÇİFT-ETİKETLEME KORUMASI (yarış koşulu) ────────────────────────
        // İki monitör (WS-Monitor + scanMailboxMonitor) aynı INBOX'u izliyor ve
        // ikisi de aynı maile Message-ID locator ile ulaşabilir. parsedEmail
        // bayatsa (henüz etiketsizken parse edildiyse) isAlreadyDecorated yukarıda
        // false döner. Bu yüzden TAZE çekilen ham mailde decorated header'ını
        // tekrar kontrol ediyoruz — varsa çift 🔴🔴 eklemeyi engelle.
        const rawProbe = original.source.toString('binary');
        if (rawProbe.search(new RegExp('^' + HEADER_DECORATED + '\\s*:', 'im')) !== -1) {
            console.log(`[SubjectDecorator] Mail zaten etiketli (taze fetch'te header bulundu) — atlandı: ${actualFolder}/${actualUid}`);
            return { attempted: true, decorated: false, reason: 'already-decorated-onfetch', folder: actualFolder, uid: actualUid };
        }

        // Raw mail'i değiştir (Subject'i yenile, tracking header'ları ekle)
        const modifiedRaw = rewriteSubjectInRaw(original.source, newSubject, origSubject, riskLevel);

        // \Recent flag'i append'te kabul edilmez — filtrele
        const flags = Array.from(original.flags || []).filter(f => f !== '\\Recent');

        // APPEND — orijinal tarih ve flag'lerle yeni versiyonu yükle
        // NOT: actualFolder kullanılır (locator dış kuralla taşınmışsa farklı klasör)
        console.log(`[SubjectDecorator] APPEND: ${account.email} folder=${actualFolder} uid=${actualUid} (${origSubject.slice(0, 40)}...)`);
        const appendRes = await client.append(actualFolder, modifiedRaw, flags, original.internalDate);

        if (!appendRes || !appendRes.uid) {
            console.warn(`[SubjectDecorator] APPEND başarısız (UID yok) — orijinal mail KORUNDU (folder=${actualFolder} uid=${actualUid})`);
            return { attempted: true, decorated: false, reason: 'append-failed', folder: actualFolder };
        }

        // ─── KRİTİK GÜVENLİK KONTROLÜ — APPEND doğrulanmadan DELETE yapma ──
        let verified = false;
        let verifyError = null;
        try {
            for await (const verifyMsg of client.fetch(appendRes.uid, {
                uid: true, envelope: true
            }, { uid: true })) {
                if (verifyMsg && Number(verifyMsg.uid) === Number(appendRes.uid)) {
                    verified = true;
                    break;
                }
            }
        } catch (e) {
            verifyError = e.message;
        }

        if (!verified) {
            console.error(
                `[SubjectDecorator] DURDURULDU — APPEND başarılı raporlandı ama UID ${appendRes.uid} ` +
                `${actualFolder} klasöründe doğrulanamadı. Orijinal mail KORUNDU (uid=${actualUid}). Hata: ${verifyError || 'fetch-empty'}`
            );
            return {
                attempted: true, decorated: false,
                reason: 'append-not-verified',
                appendedUid: appendRes.uid,
                verifyError,
                folder: actualFolder
            };
        }

        // Doğrulandı → orijinali sil
        console.log(`[SubjectDecorator] Doğrulandı, orijinal siliniyor: ${account.email} folder=${actualFolder} uid=${actualUid} → yeni uid=${appendRes.uid}`);
        await client.messageDelete(actualUid, { uid: true });

        console.log(`[SubjectDecorator] ✓ Başarılı: ${account.email} ${actualFolder}/${actualUid} → ${actualFolder}/${appendRes.uid} (${riskLevel})${movedExternally ? ' [dış kuralla taşınmış]' : ''}`);
        return {
            attempted: true,
            decorated: true,
            newUid:    appendRes.uid,
            newFolder: actualFolder,            // ← önemli: caller bunu quarantine source olarak kullanır
            originalFolder: folder,
            movedExternally,
            prefix,
            riskLevel
        };
    } catch (error) {
        console.error(`[SubjectDecorator] Hata: ${error.message}`);
        return { attempted: true, decorated: false, error: error.message };
    } finally {
        if (lock) { try { await lock.release(); } catch (_) {} }
        if (client) { await client.logout().catch(() => {}); }
    }
}

/**
 * Etiketi kaldırır → orijinal konuyu restore eder, tracking header'ları söker.
 * Kullanıcı veya admin "yanlış pozitif" diyebilir.
 *
 * @param {object} opts
 * @param {object} opts.account
 * @param {number} opts.uid
 * @param {string} [opts.folder='INBOX']
 * @returns {Promise<object>} { attempted, restored, newUid?, reason? }
 */
async function removeDecoration({ account, uid, folder = 'INBOX', messageId = null }) {
    if (!account?.email) {
        return { attempted: false, restored: false, reason: 'no-account' };
    }
    if (!uid) {
        return { attempted: false, restored: false, reason: 'missing-uid' };
    }

    const { parseEmail } = require('../analysis/parser');
    // Diskten taze credential — şifre değişmişse de auth yapabil
    const stored = loadCredentials().find(a => a.email === account.email) || account;

    let client = null;
    let lock = null;
    // B10 fix: dış kuralla başka klasöre taşınmış olabilir
    let actualFolder = folder;
    let actualUid    = uid;
    let movedExternally = false;

    try {
        client = await createConnection(stored);
        await client.connect();

        // ─── PRE-CHECK: tercih edilen klasörde mail var mı? ────────────────
        let foundInPreferred = false;
        try {
            const tryLock = await client.getMailboxLock(folder);
            try {
                const m = await client.search({ uid: String(uid) }, { uid: true });
                foundInPreferred = !!(m && m.length > 0);
            } finally { try { await tryLock.release(); } catch (_) {} }
        } catch (_) {}

        // ─── BULUNAMADIYSA: Message-ID ile diğer klasörlerde ara (B10 fix) ─
        if (!foundInPreferred) {
            if (!messageId) {
                console.warn(`[SubjectDecorator] removeDecoration: mail ${folder}'de yok, messageId yok — locator çalıştırılamıyor.`);
                return { attempted: true, restored: false, reason: 'mail-not-found-no-messageid' };
            }
            console.log(`[SubjectDecorator] removeDecoration: mail "${folder}"de yok, Message-ID ile aranıyor: ${messageId}`);
            const found = await findMessageByMessageId(client, messageId, { preferFolder: folder });
            if (!found) {
                return { attempted: true, restored: false, reason: 'mail-not-found-anywhere', messageId };
            }
            actualFolder = found.folder;
            actualUid    = found.uid;
            movedExternally = true;
            console.log(`[SubjectDecorator] removeDecoration: ✓ Mail bulundu: "${actualFolder}" uid=${actualUid}`);
        }

        // ─── Hedef klasörde lock al ve işle ────────────────────────────────
        lock = await client.getMailboxLock(actualFolder);

        let original = null;
        for await (const msg of client.fetch(actualUid, {
            source:       true,
            internalDate: true,
            flags:        true
        }, { uid: true })) {
            original = msg;
            break;
        }

        if (!original?.source) {
            return { attempted: true, restored: false, reason: 'fetch-failed', folder: actualFolder, uid: actualUid };
        }

        // Parse edip orijinal subject'i header'dan çıkar
        const parsed = await parseEmail(original.source);
        if (!parsed.success) {
            return { attempted: true, restored: false, reason: 'parse-failed' };
        }

        let originalSubject = extractOriginalSubject(parsed.data);
        if (originalSubject === null) {
            // Tracking header yok — mail bizim eklediğimiz emoji ile başlıyorsa onu kaldır
            const cur = String(parsed.data.subject || '');
            if (cur.startsWith(PREFIX_HIGH)) originalSubject = cur.slice(PREFIX_HIGH.length);
            else if (cur.startsWith(PREFIX_MEDIUM)) originalSubject = cur.slice(PREFIX_MEDIUM.length);
            else return { attempted: true, restored: false, reason: 'not-decorated' };
        }

        const cleanedRaw = stripDecorationFromRaw(original.source, originalSubject);
        const flags = Array.from(original.flags || []).filter(f => f !== '\\Recent');

        const appendRes = await client.append(actualFolder, cleanedRaw, flags, original.internalDate);
        if (!appendRes?.uid) {
            console.warn(`[SubjectDecorator] removeDecoration: APPEND başarısız, orijinal mail (${actualFolder}/${actualUid}) korundu`);
            return { attempted: true, restored: false, reason: 'append-failed', folder: actualFolder };
        }

        // Güvenlik kontrolü: yeni UID gerçekten erişilebilir mi?
        let verified = false;
        try {
            for await (const verifyMsg of client.fetch(appendRes.uid, { uid: true }, { uid: true })) {
                if (verifyMsg && Number(verifyMsg.uid) === Number(appendRes.uid)) {
                    verified = true;
                    break;
                }
            }
        } catch (_) {}

        if (!verified) {
            console.error(
                `[SubjectDecorator] removeDecoration DURDURULDU — yeni UID ${appendRes.uid} ` +
                `${actualFolder} klasöründe doğrulanamadı. Etiketli mail (uid=${actualUid}) KORUNDU.`
            );
            return { attempted: true, restored: false, reason: 'append-not-verified', appendedUid: appendRes.uid, folder: actualFolder };
        }

        await client.messageDelete(actualUid, { uid: true });

        console.log(`[SubjectDecorator] Etiket kaldırıldı: ${account.email} ${actualFolder}/${actualUid} → ${appendRes.uid}${movedExternally ? ' [dış kuralla taşınmıştı]' : ''}`);
        return {
            attempted: true,
            restored:  true,
            newUid:    appendRes.uid,
            newFolder: actualFolder,
            movedExternally,
            originalSubject
        };
    } catch (error) {
        console.error(`[SubjectDecorator] removeDecoration hata: ${error.message}`);
        return { attempted: true, restored: false, error: error.message };
    } finally {
        if (lock) { try { await lock.release(); } catch (_) {} }
        if (client) { await client.logout().catch(() => {}); }
    }
}

module.exports = {
    PREFIX_HIGH,
    PREFIX_MEDIUM,
    HEADER_DECORATED,
    HEADER_ORIGINAL_SUBJECT,
    HEADER_RISK_LEVEL,
    isFeatureEnabled,
    prefixForLevel,
    isAlreadyDecorated,
    extractOriginalSubject,
    maybeDecorateSubject,
    removeDecoration
};
