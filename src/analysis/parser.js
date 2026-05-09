// ============================================================
// EML / MIME / MSG PARSER
// ============================================================
const path = require('path');
const { simpleParser } = require('mailparser');
const { parseMsgBuffer } = require('./msgParser');

async function parseUploadedEmail(source, originalName = '') {
    const extension = path.extname(String(originalName || '')).toLowerCase();
    if (extension === '.msg') {
        const parsed = await parseMsgBuffer(source);
        if (!parsed.success) return parsed;
        return enrichParsedData(parsed.data, 0);
    }

    return parseEmail(source);
}

async function parseEmail(source, depth = 0) {
    try {
        const parsed = await simpleParser(source);
        const data = {
            messageId: parsed.messageId || '',
            from: parsed.from ? parsed.from.value : [],
            to: parsed.to ? parsed.to.value : [],
            cc: parsed.cc ? parsed.cc.value : [],
            bcc: parsed.bcc ? parsed.bcc.value : [],
            replyTo: parsed.replyTo ? parsed.replyTo.value : [],
            subject: parsed.subject || '(No Subject)',
            date: parsed.date || new Date(),
            inReplyTo: parsed.inReplyTo || '',
            references: parsed.references || [],
            headers: parsed.headers ? Object.fromEntries(parsed.headers) : {},
            headerLines: parsed.headerLines || [],
            text: parsed.text || '',
            html: parsed.html || '',
            textAsHtml: parsed.textAsHtml || '',
            attachments: (parsed.attachments || []).map(mapMailparserAttachment),
            quarantinedAttachments: extractQuarantinedAttachments(parsed),
            receivedHeaders: extractReceivedHeaders(parsed),
            authResults: extractAuthResults(parsed),
            spf: extractSPFFromLines(parsed.headerLines || []),
            dkim: extractDKIMFromLines(parsed.headerLines || []),
            dmarc: extractDMARCFromLines(parsed.headerLines || [])
        };

        return enrichParsedData(data, depth);
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function enrichParsedData(data, depth = 0) {
    const attachments = Array.isArray(data.attachments) ? [...data.attachments] : [];
    const quarantinedAttachments = Array.isArray(data.quarantinedAttachments) ? data.quarantinedAttachments : [];
    const nestedAttachments = depth < 2 ? await extractNestedAttachments(attachments, depth) : [];
    const allAttachments = [...attachments, ...nestedAttachments];

    return {
        success: true,
        data: {
            ...data,
            attachments: allAttachments,
            quarantinedAttachments,
            attachmentCount: allAttachments.length + quarantinedAttachments.length,
            receivedHeaders: data.receivedHeaders || extractReceivedHeaders({ headerLines: data.headerLines || [] }),
            authResults: data.authResults || extractAuthResults({ headerLines: data.headerLines || [] }),
            spf: data.spf || extractSPFFromLines(data.headerLines || []),
            dkim: data.dkim || extractDKIMFromLines(data.headerLines || []),
            dmarc: data.dmarc || extractDMARCFromLines(data.headerLines || [])
        }
    };
}

function mapMailparserAttachment(att) {
    return {
        filename: att.filename || 'unnamed',
        contentType: att.contentType || 'application/octet-stream',
        size: att.size || 0,
        content: att.content,
        checksum: att.checksum,
        contentDisposition: att.contentDisposition || 'attachment',
        // cid + related → inline (signature logoları, gömülü icon'lar)
        cid: att.cid || att.contentId || null,
        related: att.related === true,
        headers: att.headers
    };
}

async function extractNestedAttachments(attachments, depth = 0) {
    const nested = [];

    for (const attachment of attachments) {
        if (!attachment?.content) continue;

        const extension = path.extname(String(attachment.filename || '')).toLowerCase();
        const contentType = String(attachment.contentType || '').toLowerCase();
        const nestedPrefix = attachment.filename || 'nested-message';

        if (extension === '.eml' || contentType === 'message/rfc822') {
            const parsed = await parseEmail(attachment.content, depth + 1);
            if (parsed.success) {
                nested.push(...prefixAttachments(parsed.data.attachments || [], nestedPrefix));
            }
            continue;
        }

        if (extension === '.msg' || contentType.includes('vnd.ms-outlook')) {
            const parsed = await parseMsgBuffer(attachment.content);
            if (parsed.success) {
                const enriched = await enrichParsedData(parsed.data, depth + 1);
                if (enriched.success) {
                    nested.push(...prefixAttachments(enriched.data.attachments || [], nestedPrefix));
                }
            }
        }
    }

    return nested;
}

function prefixAttachments(attachments, prefix) {
    return attachments.map((attachment) => ({
        ...attachment,
        filename: `${prefix} -> ${attachment.filename || 'unnamed'}`
    }));
}

function extractQuarantinedAttachments(parsed) {
    const quarantined = [];
    const seen = new Set();

    if (!parsed.headerLines) return quarantined;

    for (const line of parsed.headerLines) {
        if (line.key !== 'x-attachment') continue;

        const value = line.line.replace(/^X-Attachment:\s*/i, '').trim();
        const parts = value.split('\t').map((item) => item.trim()).filter(Boolean);
        const firstPart = parts[0] || '';
        const hashSeparatorIndex = firstPart.lastIndexOf('#');
        const filename = (hashSeparatorIndex > 0 ? firstPart.slice(0, hashSeparatorIndex) : firstPart).trim();
        const sizeHint = hashSeparatorIndex > 0 ? Number(firstPart.slice(hashSeparatorIndex + 1)) : 0;
        const virusPart = parts.find((item) => /^Virus:/i.test(item)) || '';
        const actionPart = parts.find((item) => !/^Virus:/i.test(item) && item !== firstPart) || '';
        const detection = virusPart.replace(/^Virus:\s*/i, '').trim();
        const action = actionPart.trim();

        if (!filename || seen.has(filename.toLowerCase())) continue;
        seen.add(filename.toLowerCase());

        quarantined.push({
            filename,
            size: Number.isFinite(sizeHint) ? sizeHint : 0,
            contentType: guessContentTypeFromFilename(filename),
            detection,
            action,
            source: 'mail-gateway',
            vtBlockedReason: 'quarantined-upstream'
        });
    }

    return quarantined;
}

function guessContentTypeFromFilename(filename) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.rar')) return 'application/vnd.rar';
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.7z')) return 'application/x-7z-compressed';
    if (lower.endsWith('.js')) return 'application/javascript';
    if (lower.endsWith('.msg')) return 'application/vnd.ms-outlook';
    if (lower.endsWith('.eml')) return 'message/rfc822';
    return 'application/octet-stream';
}

function extractReceivedHeaders(parsed) {
    const received = [];
    if (parsed.headerLines) {
        parsed.headerLines.forEach((line) => {
            if (line.key === 'received') {
                received.push(line.line);
            }
        });
    }
    return received;
}

function extractAuthResults(parsed) {
    const results = [];
    if (parsed.headerLines) {
        parsed.headerLines.forEach((line) => {
            if (line.key === 'authentication-results') {
                results.push(line.line);
            }
        });
    }
    return results;
}

function extractSPFFromLines(headerLines = []) {
    const result = { status: 'unknown', details: '' };
    for (const line of headerLines) {
        if (line.key === 'received-spf') {
            const match = line.line.match(/^Received-SPF:\s*(pass|fail|softfail|neutral|none|temperror|permerror)/i);
            if (match) {
                result.status = match[1].toLowerCase();
                result.details = line.line;
            }
            break;
        }
        if (line.key === 'authentication-results' && line.line.includes('spf=')) {
            const match = line.line.match(/spf=(pass|fail|softfail|neutral|none|temperror|permerror)/i);
            if (match) {
                result.status = match[1].toLowerCase();
                result.details = line.line;
            }
        }
    }
    return result;
}

function extractDKIMFromLines(headerLines = []) {
    const result = { status: 'unknown', details: '' };
    for (const line of headerLines) {
        if (line.key === 'authentication-results' && line.line.includes('dkim=')) {
            const match = line.line.match(/dkim=(pass|fail|neutral|none|temperror|permerror)/i);
            if (match) {
                result.status = match[1].toLowerCase();
                result.details = line.line;
            }
            break;
        }
    }
    return result;
}

function extractDMARCFromLines(headerLines = []) {
    const result = { status: 'unknown', details: '' };
    for (const line of headerLines) {
        if (line.key === 'authentication-results' && line.line.includes('dmarc=')) {
            const match = line.line.match(/dmarc=(pass|fail|none|bestguesspass)/i);
            if (match) {
                result.status = match[1].toLowerCase();
                result.details = line.line;
            }
            break;
        }
    }
    return result;
}

module.exports = { parseEmail, parseUploadedEmail };
