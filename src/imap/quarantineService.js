const { createConnection, loadCredentials } = require('./connection');

const DEFAULT_QUARANTINE_FOLDER = process.env.MSA_IMAP_QUARANTINE_FOLDER || 'Quarantine';
const DEFAULT_COLLECT_FOLDER    = process.env.MSA_IMAP_COLLECT_FOLDER    || 'mailscanresult';

function isQuarantineMoveEnabled(account) {
    return account?.moveHighRiskToQuarantine === true || account?.moveHighRiskToQuarantine === 'true';
}

function shouldMoveMessageToQuarantine(result) {
    if (!result) return false;
    if (String(result.level || '').toLowerCase() === 'high') return true;
    return (result.findings || []).some((finding) => String(finding?.severity || '').toLowerCase() === 'critical');
}

async function maybeMoveMessageToQuarantine({ account, uid, sourceFolder = 'INBOX', result }) {
    // Re-read the flag from disk on every call so settings changes (e.g. enabling the
    // checkbox in the IMAP accounts form) take effect without restarting the monitor.
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

    console.log(`[Quarantine] Taşıma başlatılıyor: ${account?.email} uid=${uid} level=${result?.level}`);
    return moveMessageToQuarantine({
        account,
        uid,
        sourceFolder,
        destinationFolder: DEFAULT_QUARANTINE_FOLDER
    });
}

async function moveMessageToQuarantine({ account, uid, sourceFolder = 'INBOX', destinationFolder = DEFAULT_QUARANTINE_FOLDER }) {
    if (!account?.email) {
        return { attempted: true, moved: false, destinationFolder, error: 'Missing IMAP account email' };
    }

    let client = null;
    let lock = null;
    try {
        client = await createConnection(account);
        await client.connect();
        lock = await client.getMailboxLock(sourceFolder);

        if (destinationFolder !== sourceFolder) {
            await ensureMailbox(client, destinationFolder);
            await client.messageMove(uid, destinationFolder, { uid: true });
        }

        console.log(`[Quarantine] Taşıma başarılı: uid=${uid} → ${destinationFolder}`);
        return { attempted: true, moved: true, destinationFolder };
    } catch (error) {
        console.error(`[Quarantine] Taşıma başarısız: uid=${uid} hata=${error.message}`);
        return {
            attempted: true,
            moved: false,
            destinationFolder,
            error: error.message
        };
    } finally {
        if (lock) lock.release();
        if (client) await client.logout().catch(() => {});
    }
}

async function ensureMailbox(client, destinationFolder) {
    try {
        await client.mailboxCreate(destinationFolder);
    } catch (error) {
        if (!/exists|already/i.test(String(error?.message || ''))) {
            throw error;
        }
    }
}

// ============================================================
// TARAMA TOPLAMA: Taranan mailler tek klasörde topla
// ============================================================

function isCollectScannedEnabled(account) {
    return account?.collectScannedMails === true || account?.collectScannedMails === 'true';
}

/**
 * Tarama tamamlandıktan sonra maili `mailscanresult` klasörüne taşır.
 * Yalnızca hesapta `collectScannedMails=true` ise ve mail zaten Quarantine'e
 * taşınmamışsa (kaynak hâlâ INBOX'ta) çağrılmalıdır.
 *
 * @param {object} account      - IMAP hesap nesnesi
 * @param {number} uid          - Taşınacak mailin IMAP UID'si
 * @param {string} sourceFolder - Kaynak klasör (varsayılan: INBOX)
 */
async function maybeMoveScannedMailToCollection({ account, uid, sourceFolder = 'INBOX' }) {
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
    // moveMessageToQuarantine zaten genel bir IMAP taşıma fonksiyonu; destinationFolder ile yönlendiriyoruz
    return moveMessageToQuarantine({
        account,
        uid,
        sourceFolder,
        destinationFolder: DEFAULT_COLLECT_FOLDER
    });
}

module.exports = {
    DEFAULT_QUARANTINE_FOLDER,
    DEFAULT_COLLECT_FOLDER,
    isQuarantineMoveEnabled,
    shouldMoveMessageToQuarantine,
    maybeMoveMessageToQuarantine,
    isCollectScannedEnabled,
    maybeMoveScannedMailToCollection
};
