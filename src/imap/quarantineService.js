const { createConnection, loadCredentials } = require('./connection');
const { findMessageByMessageId } = require('./messageLocator');

// ─── Klasör adı varsayılanları ──────────────────────────────────────────────
// Her ikisi de INBOX altında (subfolder) — mail istemcilerinde INBOX dalı altında
// "Quarantine" ve "mailreports" şeklinde gözükür; INBOX dışında dağınık root
// klasörler oluşturmayı önler. Delimiter (`/` vs `.`) sunucuya göre runtime'da
// resolveFolderPath() ile dönüştürülür.
//   Eski adı korumak isteyenler:
//     MSA_IMAP_QUARANTINE_FOLDER=Quarantine
//     MSA_IMAP_COLLECT_FOLDER=mailscanresult
const DEFAULT_QUARANTINE_FOLDER = process.env.MSA_IMAP_QUARANTINE_FOLDER || 'INBOX/Quarantine';
const DEFAULT_COLLECT_FOLDER    = process.env.MSA_IMAP_COLLECT_FOLDER    || 'INBOX/mailreports';

/**
 * Klasör yolunu sunucunun namespace delimiter'ına göre normalize eder.
 *   'INBOX/foo' → Cyrus/Dovecot (delim='.') → 'INBOX.foo'
 *   'INBOX/foo' → Zimbra/Gmail (delim='/') → değişiklik yok
 * Defansif: namespace okunamazsa olduğu gibi döner.
 */
function resolveFolderPath(client, requested) {
    if (!requested) return requested;
    let delim = '/';
    try {
        const ns = client?.namespace;
        // imapflow versiyonuna göre iki olası şekil:
        //   { delimiter: '/' }  veya  { personal: [{ delimiter: '.' }] }
        delim = ns?.delimiter
             || ns?.personal?.[0]?.delimiter
             || '/';
    } catch (_) { /* ignore */ }

    if (delim === '/') return requested;
    return requested.replace(/^INBOX\//, `INBOX${delim}`);
}

function isQuarantineMoveEnabled(account) {
    return account?.moveHighRiskToQuarantine === true || account?.moveHighRiskToQuarantine === 'true';
}

function shouldMoveMessageToQuarantine(result) {
    if (!result) return false;
    if (String(result.level || '').toLowerCase() === 'high') return true;
    return (result.findings || []).some((finding) => String(finding?.severity || '').toLowerCase() === 'critical');
}

async function maybeMoveMessageToQuarantine({ account, uid, sourceFolder = 'INBOX', result, messageId = null }) {
    const stored = account?.email
        ? (loadCredentials().find(a => a.email === account.email) || account)
        : account;

    if (!isQuarantineMoveEnabled(stored)) {
        return { attempted: false, moved: false, reason: 'disabled' };
    }
    if (!uid) {
        return { attempted: false, moved: false, reason: 'missing-uid' };
    }
    if (!shouldMoveMessageToQuarantine(result)) {
        return { attempted: false, moved: false, reason: 'not-eligible' };
    }

    console.log(`[Quarantine] Taşıma başlatılıyor: ${account?.email} source=${sourceFolder} uid=${uid} level=${result?.level}`);
    return moveMessageToQuarantine({
        account,
        uid,
        sourceFolder,
        destinationFolder: DEFAULT_QUARANTINE_FOLDER,
        messageId
    });
}

async function moveMessageToQuarantine({ account, uid, sourceFolder = 'INBOX', destinationFolder = DEFAULT_QUARANTINE_FOLDER, messageId = null }) {
    if (!account?.email) {
        return { attempted: true, moved: false, destinationFolder, error: 'Missing IMAP account email' };
    }

    let client = null;
    let lock = null;
    let actualSource = sourceFolder;
    let actualUid    = uid;
    let movedExternally = false;

    try {
        client = await createConnection(account);
        await client.connect();
        // Sunucu delimiter'ine göre 'INBOX/foo' → 'INBOX.foo' gibi normalize et
        const resolvedDest = resolveFolderPath(client, destinationFolder);

        // ─── PRE-CHECK: mail beklenen klasörde mi? ──────────────────────────
        let foundInSource = false;
        try {
            const tryLock = await client.getMailboxLock(sourceFolder);
            try {
                const m = await client.search({ uid: String(uid) }, { uid: true });
                foundInSource = !!(m && m.length > 0);
            } finally { tryLock.release(); }
        } catch (_) { /* fall through to locator */ }

        // ─── BULUNAMADIYSA: Message-ID ile arama (dış kural taşımış olabilir) ─
        if (!foundInSource) {
            if (!messageId) {
                console.warn(`[FolderMove] ⚠ Mail ${sourceFolder} klasöründe yok, Message-ID bilinmiyor — arama yapılamaz.`);
                return {
                    attempted: true, moved: false,
                    destinationFolder: resolvedDest,
                    reason: 'mail-not-found-no-messageid'
                };
            }
            console.log(`[FolderMove] Mail "${sourceFolder}" klasöründe yok — Message-ID ile aranıyor: ${messageId}`);
            const found = await findMessageByMessageId(client, messageId, { preferFolder: sourceFolder });
            if (!found) {
                return {
                    attempted: true, moved: false,
                    destinationFolder: resolvedDest,
                    reason: 'mail-not-found-anywhere',
                    messageId
                };
            }
            actualSource = found.folder;
            actualUid    = found.uid;
            movedExternally = true;
            console.log(`[FolderMove] ✓ Mail bulundu: "${actualSource}" uid=${actualUid} — oradan ${resolvedDest}'e taşınıyor`);
        }

        // Hedef klasörle aynı mı? (örn. zaten Quarantine'deyse)
        if (resolvedDest === actualSource) {
            console.log(`[FolderMove] Mail zaten hedef klasörde: ${actualSource} — taşıma atlandı`);
            return { attempted: true, moved: true, destinationFolder: resolvedDest, alreadyThere: true };
        }

        // ─── Asıl taşıma: actualSource → resolvedDest ───────────────────────
        lock = await client.getMailboxLock(actualSource);
        await ensureMailbox(client, resolvedDest);

        console.log(`[FolderMove] ${account.email} uid=${actualUid}: ${actualSource} → ${resolvedDest}${movedExternally ? ' [dış kuralla taşınmıştı]' : ''}`);
        const moveRes = await client.messageMove(actualUid, resolvedDest, { uid: true });
        console.log(`[FolderMove] ✓ Başarılı: uid=${actualUid} → ${resolvedDest} (yeni uid=${moveRes?.uidMap?.get?.(actualUid) || '?'})`);

        return {
            attempted: true,
            moved: true,
            destinationFolder: resolvedDest,
            sourceFolder:      actualSource,
            movedExternally
        };
    } catch (error) {
        const errMsg = String(error?.message || '');
        const raceCond = /no such message|not found|expunge|invalid uid/i.test(errMsg);
        if (raceCond) {
            console.warn(
                `[FolderMove] ⚠ Yarış koşulu: uid=${actualUid} ${actualSource} → ${destinationFolder}. ` +
                `Mail bu sırada başka bir kural tarafından taşındı/silindi.`
            );
            return {
                attempted: true, moved: false, destinationFolder,
                reason: 'mail-moved-during-operation', error: errMsg
            };
        }
        console.error(`[FolderMove] ✗ Başarısız: ${account.email} uid=${actualUid} (${actualSource}) → ${destinationFolder}: ${errMsg}`);
        return {
            attempted: true,
            moved: false,
            destinationFolder,
            error: errMsg
        };
    } finally {
        if (lock) lock.release();
        if (client) await client.logout().catch(() => {});
    }
}

/**
 * Hedef klasörü oluşturur; zaten varsa sessizce geçer.
 * Farklı IMAP sunucularının "zaten var" mesajları:
 *   • Gmail/Dovecot   : "Folder already exists" / "Mailbox already exists"
 *   • Outlook/Exchange: "ALREADYEXISTS" / "duplicate"
 *   • Cyrus           : "Mailbox already exists" / "DUPLICATEEXCEPTION"
 *   • Yahoo           : "Folder name already in use"
 *
 * imapflow ayrıca alreadyExists hatası fırlatabilir (responseCode 'ALREADYEXISTS').
 */
async function ensureMailbox(client, destinationFolder) {
    try {
        await client.mailboxCreate(destinationFolder);
        console.log(`[IMAP] Klasör oluşturuldu: ${destinationFolder}`);
    } catch (error) {
        // ImapFlow error.message her zaman "Command failed" diye geliyor;
        // gerçek IMAP yanıtı error.responseText'te.
        // Zimbra örneği: responseText='CREATE failed: mailbox already exists'
        // Bu yüzden message + responseText + responseCode/serverResponseCode
        // hepsini kontrol etmek lazım.
        const msg  = String(error?.message      || '');
        const text = String(error?.responseText || '');
        const code = String(error?.responseCode || error?.serverResponseCode || '');
        const existsPattern = /exists|already|duplicate|in[- ]?use/i;
        const alreadyExists =
            existsPattern.test(msg)  ||
            existsPattern.test(text) ||
            /ALREADYEXISTS|DUPLICATE/i.test(code);
        if (!alreadyExists) {
            console.error(`[IMAP] Klasör oluşturulamadı (${destinationFolder}): ${msg}` +
                (text ? `  [imap="${text}"]` : ''));
            throw error;
        }
        // Klasör zaten var — normal durum, log yok
    }
}

/**
 * Verilen hesap için klasörü proaktif olarak oluşturur (best-effort).
 * Ayar etkinleştirildiğinde çağrılır → kullanıcı klasörü email client'ında hemen görür.
 * Hata olursa atılır, lazy create yine çalışır (ensureMailbox via moveMessageToQuarantine).
 *
 * @param {object} account
 * @param {string} folder
 * @returns {Promise<{ok: boolean, folder: string, error?: string}>}
 */
async function ensureFolderForAccount(account, folder) {
    if (!account?.email) return { ok: false, folder, error: 'no-account' };

    let client = null;
    try {
        client = await createConnection(account);
        await client.connect();
        // 'INBOX/foo' → sunucu delimiter'i `.` ise 'INBOX.foo' olarak normalize
        const resolved = resolveFolderPath(client, folder);
        await ensureMailbox(client, resolved);
        return { ok: true, folder: resolved };
    } catch (error) {
        console.error(`[IMAP] ${account.email} için "${folder}" oluşturulamadı:`, error.message);
        return { ok: false, folder, error: error.message };
    } finally {
        if (client) await client.logout().catch(() => {});
    }
}

// ============================================================
// TARAMA TOPLAMA: Taranan mailler tek klasörde topla
// ============================================================

function isCollectScannedEnabled(account) {
    return account?.collectScannedMails === true || account?.collectScannedMails === 'true';
}

/**
 * Tarama tamamlandıktan sonra maili `mailreports` klasörüne taşır.
 * Yalnızca hesapta `collectScannedMails=true` ise ve mail zaten Quarantine'e
 * taşınmamışsa (kaynak hâlâ INBOX'ta) çağrılmalıdır.
 *
 * @param {object} account      - IMAP hesap nesnesi
 * @param {number} uid          - Taşınacak mailin IMAP UID'si
 * @param {string} sourceFolder - Kaynak klasör (varsayılan: INBOX)
 */
async function maybeMoveScannedMailToCollection({ account, uid, sourceFolder = 'INBOX', messageId = null }) {
    const stored = account?.email
        ? (loadCredentials().find(a => a.email === account.email) || account)
        : account;

    if (!isCollectScannedEnabled(stored)) {
        return { attempted: false, moved: false, reason: 'disabled' };
    }
    if (!uid) {
        return { attempted: false, moved: false, reason: 'missing-uid' };
    }

    console.log(`[Collect] Tarama klasörüne taşınıyor: ${account?.email} uid=${uid} → ${DEFAULT_COLLECT_FOLDER}`);
    return moveMessageToQuarantine({
        account,
        uid,
        sourceFolder,
        destinationFolder: DEFAULT_COLLECT_FOLDER,
        messageId
    });
}

module.exports = {
    DEFAULT_QUARANTINE_FOLDER,
    DEFAULT_COLLECT_FOLDER,
    isQuarantineMoveEnabled,
    shouldMoveMessageToQuarantine,
    maybeMoveMessageToQuarantine,
    isCollectScannedEnabled,
    maybeMoveScannedMailToCollection,
    ensureFolderForAccount
};
