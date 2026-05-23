// ============================================================
// MESSAGE LOCATOR — Maili Message-ID ile tüm klasörlerde bul
//
// Senaryo: kullanıcı/server kuralı (Sieve, Outlook filter) maili INBOX'tan
// başka bir klasöre taşımış olabilir. UID arama başarısız olunca bu modül
// devreye girer ve tüm klasörlerde Message-ID ile arar.
//
// Atlanan klasörler: sistem klasörleri (Sent, Drafts, Trash, Spam, [Gmail]/...,
// ve bizim rapor toplama klasörü mailreports). Bu klasörlere bizim hiçbir
// otomatik işlem uygulanmamalı.
// ============================================================
'use strict';

// Atlanacak klasörler (case-insensitive eşleşme)
const SKIP_FOLDERS_LOWER = new Set([
    'inbox/mailreports',
    'inbox.mailreports',
    'mailreports',
    'drafts', 'taslaklar',
    'sent', 'gönderilenler', 'gönderilmiş öğeler', 'sent items', 'sent mail',
    'trash', 'çöp kutusu', 'silinmiş öğeler', 'deleted items', 'deleted messages',
    'spam', 'junk', 'önemsiz e-posta', 'junk e-mail'
]);

const SKIP_PATTERNS = [
    /^\[Gmail\]\/(Sent Mail|Drafts|Trash|Spam|Important|Starred|All Mail)/i,
    /\/Trash$/i, /\/Drafts$/i, /\/Sent$/i, /\/Junk$/i, /\/Spam$/i,
    /\/INBOX\.Trash$/i, /\/INBOX\.Drafts$/i, /\/INBOX\.Sent$/i,
    /^Sent$|^Drafts$|^Trash$|^Junk$|^Spam$/i
];

function shouldSkipFolder(path, flags) {
    if (!path) return true;
    const lower = String(path).toLowerCase();
    if (SKIP_FOLDERS_LOWER.has(lower)) return true;
    if (SKIP_PATTERNS.some(p => p.test(path))) return true;

    // \Noselect: parent folder, mesaj içermez. \NonExistent: hiç yok.
    if (flags) {
        const checkFlag = (f) => {
            if (flags.has && typeof flags.has === 'function') return flags.has(f);
            if (Array.isArray(flags)) return flags.includes(f);
            return false;
        };
        if (checkFlag('\\Noselect') || checkFlag('\\NonExistent')) return true;
    }
    return false;
}

/**
 * Bir maili Message-ID ile hesabın tüm uygun klasörlerinde arar.
 *
 * Çağıran taraf:
 *   - client zaten connect() edilmiş olmalı
 *   - LOCK TUTMAMALIDIR — bu fonksiyon kendi lock'larını alır
 *
 * @param {object} client - bağlı imapflow client
 * @param {string} messageId - aranan Message-ID (RFC 822, "<id@domain>" formatı)
 * @param {object} [opts]
 * @param {string} [opts.preferFolder='INBOX'] - önce bu klasörde ara
 * @returns {Promise<{folder: string, uid: number} | null>}
 */
async function findMessageByMessageId(client, messageId, opts = {}) {
    if (!messageId) return null;
    const preferFolder = opts.preferFolder || 'INBOX';

    // Önce tercih edilen klasör (genelde INBOX)
    try {
        const lock = await client.getMailboxLock(preferFolder);
        try {
            const matches = await client.search(
                { header: { 'message-id': messageId } },
                { uid: true }
            );
            if (matches && matches.length > 0) {
                return { folder: preferFolder, uid: Number(matches[0]) };
            }
        } finally { try { await lock.release(); } catch (_) {} }
    } catch (_) { /* preferFolder erişilemiyor — diğerlerine geç */ }

    // ─── Gmail X-GM-RAW fast path (B9 fix) ──────────────────────────────────
    // Gmail X-GM-EXT-1 capability'sini destekler. Tek SEARCH ile TÜM label'larda
    // (klasörlerde) ara — N folder × 30ms (~1s) yerine 1 query ~100ms.
    // Önemli: önce All Mail klasörüne girmek gerek (tüm Gmail içeriği orada).
    try {
        const caps = client.capabilities;
        const supportsGmail = caps && (
            (typeof caps.has === 'function' && caps.has('X-GM-EXT-1')) ||
            (Array.isArray(caps) && caps.includes('X-GM-EXT-1'))
        );
        if (supportsGmail) {
            // [Gmail]/All Mail (lokalize: 'Tüm Postalar', vs.) — namespace ile dene
            const allMailCandidates = ['[Gmail]/All Mail', '[Gmail]/Tüm Postalar', '[Google Mail]/All Mail'];
            for (const allMailPath of allMailCandidates) {
                try {
                    const lock = await client.getMailboxLock(allMailPath);
                    try {
                        // X-GM-RAW: Gmail search syntax. rfc822msgid: header'ı için.
                        // messageId genelde <id@host> formatında; çıplak gönderelim.
                        const cleanId = String(messageId).replace(/^<|>$/g, '');
                        const matches = await client.search(
                            { gmraw: `rfc822msgid:${cleanId}` },
                            { uid: true }
                        );
                        if (matches && matches.length > 0) {
                            // Sonuç All Mail'de — gerçek klasör için X-GM-LABELS bakalım
                            let realFolder = allMailPath;
                            try {
                                for await (const msg of client.fetch(matches[0],
                                    { 'x-gm-labels': true, uid: true }, { uid: true })) {
                                    const labels = msg['x-gm-labels'] || msg.gmailLabels || [];
                                    // İlk non-system label'ı tercih et (INBOX > diğer)
                                    if (Array.isArray(labels) && labels.length) {
                                        const inbox = labels.find(l => /^\\Inbox$/i.test(l) || /^INBOX$/i.test(l));
                                        realFolder = inbox ? 'INBOX' : (labels.find(l => !l.startsWith('\\')) || allMailPath);
                                    }
                                    break;
                                }
                            } catch (_) {}
                            console.log(
                                `[MessageLocator] ✓ Gmail fast-path: "${messageId}" → folder="${realFolder}" uid=${matches[0]}`
                            );
                            return { folder: realFolder, uid: Number(matches[0]) };
                        }
                    } finally { try { await lock.release(); } catch (_) {} }
                    break;  // All Mail erişildi, başka aday deneme
                } catch (_) { /* bu yol çalışmıyor, sonraki aday */ }
            }
        }
    } catch (e) {
        // Gmail fast-path başarısız — generic loop'a düş
        console.warn('[MessageLocator] Gmail fast-path hatası, generic arama:', e.message);
    }

    // Tüm klasörleri listele (generic)
    let folders;
    try { folders = await client.list(); }
    catch (e) {
        console.error('[MessageLocator] client.list başarısız:', e.message);
        return null;
    }

    if (!Array.isArray(folders) || folders.length === 0) return null;

    let scanned = 0;
    for (const fld of folders) {
        const path = fld?.path;
        if (!path || path === preferFolder) continue;
        if (shouldSkipFolder(path, fld.flags)) continue;

        scanned++;
        try {
            const lock = await client.getMailboxLock(path);
            try {
                const matches = await client.search(
                    { header: { 'message-id': messageId } },
                    { uid: true }
                );
                if (matches && matches.length > 0) {
                    console.log(
                        `[MessageLocator] ✓ Mail bulundu: "${messageId}" ` +
                        `→ folder="${path}" uid=${matches[0]} ` +
                        `(${scanned} klasör tarandı)`
                    );
                    return { folder: path, uid: Number(matches[0]) };
                }
            } finally { try { await lock.release(); } catch (_) {} }
        } catch (e) {
            // Bazı klasörler erişilemez (özel haklar, vb.) — sessizce geç
            continue;
        }
    }

    console.warn(
        `[MessageLocator] ✗ Mail hiçbir klasörde bulunamadı: "${messageId}" ` +
        `(${scanned} klasör tarandı, sistem klasörleri atlandı)`
    );
    return null;
}

module.exports = { findMessageByMessageId, shouldSkipFolder };
