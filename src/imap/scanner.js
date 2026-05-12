// ============================================================
// IMAP INBOX SCANNER — Scan existing emails
// ============================================================
const { createConnection } = require('./connection');
const pool = require('./connectionPool');
const { parseEmail } = require('../analysis/parser');
const { getImapSenderSkipInfo } = require('./scanExclusions');

const imapCooldowns = new Map();
const IMAP_RESET_COOLDOWN_MS = 60 * 1000;

async function listEmails(account, folder = 'INBOX', limit = 50) {
    return withImapRetries(() => listEmailsOnce(account, folder, limit), 'Sunucu Reddi');
}

async function listEmailsOnce(account, folder = 'INBOX', limit = 50) {
    let client = null;
    let usedPool = false;
    try {
        // Havuzdan bağlantı almayı dene; başarısız olursa yeni bağlantı aç
        try {
            client = await pool.acquire(account);
            usedPool = true;
        } catch {
            client = await createConnection(account);
            await client.connect();
        }

        const lock = await client.getMailboxLock(folder);
        const messages = [];
        try {
            const mailboxSize = client.mailbox?.exists || 0;
            if (mailboxSize === 0) {
                return { success: true, messages: [], total: 0, loaded: 0, hasMore: false };
            }

            const normalizedLimit = Math.max(parseInt(limit, 10) || 50, 1);
            const startSeq = Math.max(mailboxSize - normalizedLimit + 1, 1);
            const range = `${startSeq}:${mailboxSize}`;

            let skipped = 0;
            for await (const msg of client.fetch(range, { envelope: true, uid: true })) {
                const from = msg.envelope.from?.[0] || {};
                const skipInfo = getImapSenderSkipInfo({ account, from });
                if (skipInfo.skip) {
                    skipped += 1;
                    continue;
                }

                messages.push({
                    uid: msg.uid, seq: msg.seq,
                    from,
                    to: msg.envelope.to || [],
                    subject: msg.envelope.subject || '(No Subject)',
                    date: msg.envelope.date || new Date()
                });
            }

            const loaded = messages.length;
            const hasMore = startSeq > 1;

            return {
                success: true,
                messages: messages.reverse(),
                total: mailboxSize,
                loaded,
                skipped,
                hasMore
            };
        } finally {
            lock.release();
            if (usedPool) pool.release(account);
            else await client.logout().catch(() => {});
        }
    } catch (e) {
        if (usedPool && client) await pool.invalidate(account).catch(() => {});
        else if (client) await client.logout().catch(() => {});
        const errorMsg = e.responseText || e.response || e.message;
        return { success: false, error: `Sunucu Reddi: ${errorMsg}` };
    }
}

async function fetchAndParseEmail(account, uid, folder = 'INBOX') {
    const attempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const result = await fetchAndParseEmailOnce(account, uid, folder);
        if (result.success || !isRetryableImapError(result.error) || attempt === attempts) {
            return result;
        }

        lastError = result.error;
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }

    return { success: false, error: lastError || 'IMAP fetch failed' };
}

async function fetchAndParseEmailOnce(account, uid, folder = 'INBOX') {
    let client = null;
    let usedPool = false;
    try {
        // Havuzdan bağlantı almayı dene
        try {
            client = await pool.acquire(account);
            usedPool = true;
        } catch {
            client = await createConnection(account);
            await client.connect();
        }

        const lock = await client.getMailboxLock(folder);
        try {
            const msg = await client.fetchOne(uid, { source: true, bodyStructure: true }, { uid: true });
            if (msg && msg.source) {
                const parsed = await parseEmail(msg.source);
                if (parsed.success) {
                    const skipInfo = getImapSenderSkipInfo({ account, from: parsed.data.from });
                    if (skipInfo.skip) {
                        return {
                            success: false,
                            skipped: true,
                            reason: skipInfo.reason,
                            from: skipInfo.fromEmail,
                            error: 'Bu mesaj, gonderen adresi tarama disi oldugu icin analiz edilmedi.'
                        };
                    }
                }
                if (parsed.success) {
                    try {
                        await supplementImapBodyStructureAttachments(client, uid, msg.bodyStructure, parsed.data);
                    } catch (error) {
                        addUnavailableBodyStructureAttachments(msg.bodyStructure, parsed.data, error.message);
                    }
                }
                return parsed;
            }
            return { success: false, error: 'Message not found' };
        } finally {
            lock.release();
            if (usedPool) pool.release(account);
            else await client.logout().catch(() => {});
        }
    } catch (e) {
        if (usedPool && client) await pool.invalidate(account).catch(() => {});
        else if (client) await client.logout().catch(() => {});
        const errorMsg = e.responseText || e.response || e.message;
        return { success: false, error: `Hata: ${errorMsg}` };
    }
}

function isRetryableImapError(error) {
    return /ECONNRESET|Connection not available|socket|timeout/i.test(String(error || ''));
}

async function withImapRetries(operation, label, attempts = 2) {
    const cooldownKey = operation.name || label || 'imap';
    const cooldownUntil = imapCooldowns.get(cooldownKey) || 0;
    if (Date.now() < cooldownUntil) {
        const seconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
        return {
            success: false,
            error: `${label}: Zimbra IMAP bağlantıyı resetledi. ${seconds} sn sonra tekrar deneyin.`
        };
    }

    let lastResult = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        lastResult = await operation();
        if (lastResult.success || !isRetryableImapError(lastResult.error) || attempt === attempts) {
            if (!lastResult.success && isRetryableImapError(lastResult.error)) {
                imapCooldowns.set(cooldownKey, Date.now() + IMAP_RESET_COOLDOWN_MS);
                return {
                    success: false,
                    error: `${label}: Zimbra IMAP bağlantıyı resetledi. IMAP servisi geçici olarak bağlantıları kapatıyor olabilir; 60 sn sonra tekrar deneyin.`
                };
            }
            return lastResult;
        }

        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }

    return lastResult || { success: false, error: `${label}: IMAP operation failed` };
}

async function supplementImapBodyStructureAttachments(client, uid, bodyStructure, parsedData) {
    const bodyAttachments = collectBodyStructureAttachments(bodyStructure);
    if (!bodyAttachments.length) return;

    const existing = new Set((parsedData.attachments || []).map((att) => normalizeFilename(att.filename)));
    const quarantined = parsedData.quarantinedAttachments || [];
    const additions = [];

    for (const bodyPart of bodyAttachments) {
        const normalized = normalizeFilename(bodyPart.filename);
        if (!normalized || existing.has(normalized)) continue;

        const quarantineMatch = quarantined.find((item) => isSameAttachmentName(item.filename, bodyPart.filename));
        let downloaded;
        try {
            downloaded = await downloadBodyPart(client, uid, bodyPart.part);
        } catch (error) {
            downloaded = { content: null, error: error.message };
        }

        additions.push({
            filename: bodyPart.filename,
            contentType: bodyPart.contentType,
            size: downloaded.content?.length || bodyPart.size || 0,
            content: downloaded.content || null,
            contentDisposition: bodyPart.disposition || 'attachment',
            headers: new Map(),
            imapPart: bodyPart.part,
            imapDownloadError: downloaded.error || null,
            gatewayDetection: quarantineMatch?.detection || '',
            gatewayAction: quarantineMatch?.action || ''
        });
        existing.add(normalized);
    }

    if (!additions.length) return;

    mergeBodyStructureAdditions(parsedData, additions);
}

function addUnavailableBodyStructureAttachments(bodyStructure, parsedData, errorMessage) {
    const bodyAttachments = collectBodyStructureAttachments(bodyStructure);
    if (!bodyAttachments.length) return;

    const existing = new Set((parsedData.attachments || []).map((att) => normalizeFilename(att.filename)));
    const quarantined = parsedData.quarantinedAttachments || [];
    const additions = [];

    for (const bodyPart of bodyAttachments) {
        const normalized = normalizeFilename(bodyPart.filename);
        if (!normalized || existing.has(normalized)) continue;

        const quarantineMatch = quarantined.find((item) => isSameAttachmentName(item.filename, bodyPart.filename));
        additions.push({
            filename: bodyPart.filename,
            contentType: bodyPart.contentType,
            size: bodyPart.size || 0,
            content: null,
            contentDisposition: bodyPart.disposition || 'attachment',
            headers: new Map(),
            imapPart: bodyPart.part,
            imapDownloadError: errorMessage || 'IMAP body part download failed',
            gatewayDetection: quarantineMatch?.detection || '',
            gatewayAction: quarantineMatch?.action || ''
        });
        existing.add(normalized);
    }

    mergeBodyStructureAdditions(parsedData, additions);
}

function mergeBodyStructureAdditions(parsedData, additions) {
    if (!additions.length) return;

    parsedData.attachments = [...(parsedData.attachments || []), ...additions];
    parsedData.quarantinedAttachments = (parsedData.quarantinedAttachments || []).filter((item) => {
        return !additions.some((att) => isSameAttachmentName(att.filename, item.filename));
    });
    parsedData.attachmentCount = parsedData.attachments.length + parsedData.quarantinedAttachments.length;
}

function collectBodyStructureAttachments(node, result = []) {
    if (!node) return result;

    if (Array.isArray(node.childNodes)) {
        for (const child of node.childNodes) collectBodyStructureAttachments(child, result);
    }

    const filename = node.dispositionParameters?.filename || node.parameters?.name || '';
    const disposition = String(node.disposition || '').toLowerCase();
    const type = String(node.type || '').toLowerCase();
    const isAttachment = filename && (disposition === 'attachment' || !type.startsWith('text/'));

    if (node.part && isAttachment) {
        result.push({
            part: node.part,
            filename,
            contentType: node.type || 'application/octet-stream',
            size: node.size || 0,
            disposition: node.disposition || 'attachment'
        });
    }

    return result;
}

async function downloadBodyPart(client, uid, part) {
    const attempts = [
        {
            label: `BODY.PEEK[${part}]`,
            run: () => fetchBodyPart(client, uid, { bodyParts: [part] }, { uid: true, binary: false }, part)
        },
        {
            label: `BODY.PEEK[${part}] partial`,
            run: () => fetchBodyPart(client, uid, { bodyParts: [{ key: part, start: 0, maxLength: 50 * 1024 * 1024 }] }, { uid: true, binary: false }, part)
        },
        {
            label: `BINARY.PEEK[${part}]`,
            run: () => fetchBodyPart(client, uid, { bodyParts: [part] }, { uid: true, binary: true }, part)
        },
        {
            label: `download(${part})`,
            run: () => downloadPartStream(client, uid, part)
        },
        {
            label: `downloadMany(${part})`,
            run: () => downloadManyPart(client, uid, part)
        }
    ];

    const errors = [];
    for (const attempt of attempts) {
        try {
            const content = await attempt.run();
            if (Buffer.isBuffer(content) && content.length > 0) {
                return { content, method: attempt.label };
            }
            errors.push(`${attempt.label}: empty`);
        } catch (error) {
            errors.push(`${attempt.label}: ${error.message}`);
        }
    }

    return { content: null, error: errors.join('; ') || 'IMAP server returned an empty body part' };
}

async function fetchBodyPart(client, uid, query, options, part) {
    const msg = await client.fetchOne(uid, query, options);
    const bodyParts = msg?.bodyParts;
    if (!bodyParts) return null;

    const exact = bodyParts.get(part);
    if (Buffer.isBuffer(exact)) return exact;

    for (const value of bodyParts.values()) {
        if (Buffer.isBuffer(value) && value.length > 0) return value;
    }

    return null;
}

async function downloadPartStream(client, uid, part) {
    const downloaded = await client.download(uid, part, { uid: true, binary: false });
    if (!downloaded?.content) return null;
    return streamToBuffer(downloaded.content);
}

async function downloadManyPart(client, uid, part) {
    const downloaded = await client.downloadMany(uid, [part], { uid: true, binary: false });
    const item = downloaded?.[part];
    if (Buffer.isBuffer(item?.content)) return item.content;
    if (item?.content) return streamToBuffer(item.content);
    return null;
}

async function streamToBuffer(stream) {
    const chunks = [];
    try {
        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }
    } catch {
        return null;
    }
    return Buffer.concat(chunks);
}

function normalizeFilename(filename) {
    return String(filename || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w.]+/g, '')
        .toLowerCase();
}

function isSameAttachmentName(left, right) {
    const normalizedLeft = normalizeFilename(left);
    const normalizedRight = normalizeFilename(right);
    if (normalizedLeft && normalizedLeft === normalizedRight) return true;

    const leftExt = getFilenameExtension(left);
    const rightExt = getFilenameExtension(right);
    if (!leftExt || leftExt !== rightExt) return false;

    const leftDigits = String(left || '').match(/\d+/g)?.join('') || '';
    const rightDigits = String(right || '').match(/\d+/g)?.join('') || '';
    if (leftDigits && leftDigits === rightDigits) return true;

    return false;
}

function getFilenameExtension(filename) {
    return String(filename || '').match(/(\.[a-z0-9]{1,12})$/i)?.[1]?.toLowerCase() || '';
}

module.exports = { listEmails, fetchAndParseEmail };
