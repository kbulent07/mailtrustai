// ============================================================
// ATTACHMENT SECURITY ANALYZER
// ============================================================
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const zlib = require('zlib');

const DANGEROUS_EXTENSIONS = ['.exe','.scr','.bat','.cmd','.com','.pif','.vbs','.vbe','.js','.jse','.wsf','.wsh','.ps1','.msi','.msp','.hta','.cpl','.reg','.inf','.dll','.sys'];
const SUSPICIOUS_EXTENSIONS = ['.zip','.rar','.7z','.tar','.gz','.iso','.img','.docm','.xlsm','.pptm','.dotm','.xltm'];
const MACRO_MIMES = ['application/vnd.ms-excel.sheet.macroEnabled','application/vnd.ms-word.document.macroEnabled'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];

function analyzeAttachments(attachments) {
    const findings = []; let score = 0; const results = [];

    for (const att of attachments) {
        const r = {
            filename: att.filename,
            size: att.size,
            contentType: att.contentType,
            issues: [],
            hash: null,
            archiveEntries: [],
            archiveScan: null,
            vtEligible: true,
            vtSkipReason: null,
            localScanner: 'attachment-rules',
            imageAnalysis: null,
            imapPart: att.imapPart || null,
            imapDownloadError: att.imapDownloadError || null,
            gatewayDetection: att.gatewayDetection || '',
            gatewayAction: att.gatewayAction || ''
        };

        // Generate SHA-256 hash
        if (att.content) {
            r.hash = crypto.createHash('sha256').update(att.content).digest('hex');
        }

        if (att.gatewayDetection) {
            findings.push({
                severity: 'critical',
                category: 'attachment',
                message: `Mail gateway flagged attachment: ${att.filename} (${att.gatewayDetection}${att.gatewayAction ? `, ${att.gatewayAction}` : ''})`
            });
            r.issues.push('gateway-quarantine-header');
            score += 18;
        }

        if (att.imapDownloadError) {
            findings.push({
                severity: 'warning',
                category: 'attachment',
                message: `Attachment body part could not be downloaded over IMAP after alternate fetch attempts: ${att.filename} (${att.imapDownloadError})`
            });
            r.issues.push('imap-part-unavailable');
            r.vtEligible = false;
            r.vtSkipReason = 'imap-part-unavailable';
            score += 8;
        }

        const ext = getExtension(att.filename);
        const exts = getAllExtensions(att.filename);

        // Double extension
        if (exts.length > 1 && DANGEROUS_EXTENSIONS.includes(exts[exts.length - 1])) {
            findings.push({ severity: 'critical', category: 'attachment', message: `Double extension trick: ${att.filename}` });
            r.issues.push('double-extension'); score += 15;
        }
        // Dangerous extension
        else if (DANGEROUS_EXTENSIONS.includes(ext)) {
            findings.push({ severity: 'critical', category: 'attachment', message: `Dangerous file type: ${att.filename}` });
            r.issues.push('dangerous-extension'); score += 12;
        }
        // Suspicious archive/macro
        else if (SUSPICIOUS_EXTENSIONS.includes(ext)) {
            findings.push({ severity: 'warning', category: 'attachment', message: `Suspicious file type: ${att.filename}` });
            r.issues.push('suspicious-extension'); score += 5;
        }

        // MIME type mismatch
        if (ext && att.contentType) {
            const mismatch = checkMimeMismatch(ext, att.contentType);
            if (mismatch) {
                findings.push({ severity: 'critical', category: 'attachment', message: `Extension/MIME mismatch: ${att.filename} (${att.contentType})` });
                r.issues.push('mime-mismatch'); score += 10;
            }
        }

        // Macro-enabled documents
        if (MACRO_MIMES.some(m => att.contentType?.includes(m)) || ['.docm','.xlsm','.pptm'].includes(ext)) {
            findings.push({ severity: 'warning', category: 'attachment', message: `Macro-enabled document: ${att.filename}` });
            r.issues.push('macro-enabled'); score += 8;
        }

        if (isImageAttachment(ext, att.contentType)) {
            r.vtEligible = false;
            r.vtSkipReason = 'image-local-scan';
            r.localScanner = 'image-integrity';
            r.imageAnalysis = inspectImagePayload(att);

            if (!r.imageAnalysis.validSignature) {
                findings.push({
                    severity: 'warning',
                    category: 'attachment',
                    message: `Image signature mismatch: ${att.filename}`
                });
                r.issues.push('image-signature-mismatch');
                score += 6;
            }

            if (r.imageAnalysis.trailingPayload) {
                findings.push({
                    severity: 'critical',
                    category: 'attachment',
                    message: `Image contains suspicious trailing payload: ${att.filename}`
                });
                r.issues.push('image-trailing-payload');
                score += 18;
            }

            if (r.imageAnalysis.suspiciousMarkers.length) {
                findings.push({
                    severity: 'critical',
                    category: 'attachment',
                    message: `Image contains suspicious embedded marker(s): ${att.filename} -> ${r.imageAnalysis.suspiciousMarkers.join(', ')}`
                });
                r.issues.push('image-embedded-marker');
                score += 12;
            }
        }

        // ─── YENİ: Şifreli arşiv tespiti ───────────────────────
        if (isArchiveExtension(ext) && att.content) {
            const encResult = detectEncryptedArchive(att.filename, att.content);
            if (encResult.encrypted) {
                findings.push({
                    severity: 'warning',
                    category: 'attachment',
                    message: `Şifreli/parola korumalı arşiv tespit edildi: ${att.filename} — içerik taranamadı`
                });
                r.issues.push('encrypted-archive');
                r.vtEligible = false;
                r.vtSkipReason = 'encrypted-archive';
                score += 10;
            }
        }

        // ─── YENİ: Office makro VBA içerik analizi ─────────
        if (['.docm', '.xlsm', '.pptm', '.dotm', '.xltm'].includes(ext) && att.content) {
            const macroResult = inspectOfficeMacros(att.content);
            if (macroResult.hasMacros) {
                const sev = macroResult.dangerousCommands.length > 0 ? 'critical' : 'warning';
                const cmdList = macroResult.dangerousCommands.slice(0, 5).join(', ');
                findings.push({
                    severity: sev,
                    category: 'attachment',
                    message: `VBA makro içeriği analiz edildi: ${att.filename}${cmdList ? ` — şüpheli komut: ${cmdList}` : ' — makro içeriği mevcut'}`
                });
                r.issues.push(sev === 'critical' ? 'macro-dangerous-commands' : 'macro-content');
                score += sev === 'critical' ? 20 : 5;
            }
        }

        if (isArchiveExtension(ext) && att.content) {
            const archiveScan = inspectArchiveContents(att.filename, att.content);
            r.archiveScan = archiveScan;
            r.archiveEntries = archiveScan.entries || [];

            if (!archiveScan.inspected) {
                findings.push({
                    severity: 'warning',
                    category: 'attachment',
                    message: `Archive contents could not be inspected: ${att.filename}`
                });
                r.issues.push('archive-uninspectable');
                score += 6;
            } else {
                const dangerousEntries = archiveScan.entries.filter((entry) => entry.severity === 'critical');
                const suspiciousEntries = archiveScan.entries.filter((entry) => entry.severity === 'warning');

                if (dangerousEntries.length) {
                    findings.push({
                        severity: 'critical',
                        category: 'attachment',
                        message: `Archive contains dangerous file(s): ${att.filename} -> ${dangerousEntries.map((entry) => entry.name).join(', ')}`
                    });
                    r.issues.push('archive-contains-dangerous-file');
                    score += 18;
                } else if (suspiciousEntries.length) {
                    findings.push({
                        severity: 'warning',
                        category: 'attachment',
                        message: `Archive contains suspicious file(s): ${att.filename} -> ${suspiciousEntries.map((entry) => entry.name).join(', ')}`
                    });
                    r.issues.push('archive-contains-suspicious-file');
                    score += 8;
                }
            }
        }

        // Unusually large
        if (att.size > 25 * 1024 * 1024) {
            findings.push({ severity: 'info', category: 'attachment', message: `Large attachment: ${att.filename} (${(att.size/1024/1024).toFixed(1)}MB)` });
            r.issues.push('large-file');
        }

        if (r.issues.length === 0) r.issues.push('clean');
        results.push(r);
    }

    if (attachments.length === 0) {
        findings.push({ severity: 'safe', category: 'attachment', message: 'No attachments' });
    } else if (score === 0) {
        findings.push({ severity: 'safe', category: 'attachment', message: `${attachments.length} attachment(s) — no issues found` });
    }

    return { findings, score: Math.min(score, 30), results };
}

function getExtension(filename) {
    const m = filename?.match(/(\.[a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : '';
}

function getAllExtensions(filename) {
    const parts = filename?.split('.') || [];
    return parts.length > 1 ? parts.slice(1).map(p => '.' + p.toLowerCase()) : [];
}

function checkMimeMismatch(ext, mime) {
    const map = {
        '.pdf':  ['application/pdf'],
        '.doc':  ['application/msword'],
        '.docx': ['application/vnd.openxmlformats-officedocument', 'application/zip'],
        '.xls':  ['application/vnd.ms-excel'],
        '.xlsx': ['application/vnd.openxmlformats-officedocument', 'application/zip'],
        '.jpg':  ['image/jpeg'],
        '.png':  ['image/png'],
        '.gif':  ['image/gif'],
        '.txt':  ['text/plain'],
        '.html': ['text/html'],
        '.csv':  ['text/csv', 'text/plain'],
        '.zip':  ['application/zip', 'application/x-zip'],
        '.rar':  ['application/x-rar', 'application/vnd.rar']
    };
    const expected = map[ext];
    if (!expected) return false;
    const mimeLower = mime.toLowerCase();
    return !expected.some(e => mimeLower.includes(e));
}

function isArchiveExtension(ext) {
    return ['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext);
}

function isImageAttachment(ext, mime) {
    return IMAGE_EXTENSIONS.includes(ext) || String(mime || '').toLowerCase().startsWith('image/');
}

function getArchiveCommand(ext) {
    // tar handles .zip on Windows 10+ and handles .tar/.gz natively
    if (ext === '.zip' || ext === '.tar' || ext === '.gz') {
        return { cmd: 'tar', args: ['-tf'] };
    }
    // .rar and .7z require specialized tools not guaranteed to be present
    return null;
}

function inspectArchiveContents(filename, content) {
    const ext = getExtension(filename);
    const archiveCmd = getArchiveCommand(ext);

    if (!archiveCmd) {
        return {
            inspected: false,
            error: `No inspection tool available for ${ext} archives`,
            entries: []
        };
    }

    const tempName = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext || '.bin'}`;
    const tempPath = path.join(os.tmpdir(), tempName);

    try {
        fs.writeFileSync(tempPath, content);
        const result = spawnSync(archiveCmd.cmd, [...archiveCmd.args, tempPath], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 15000
        });

        if (result.status !== 0) {
            return {
                inspected: false,
                error: (result.stderr || result.stdout || 'archive listing failed').trim(),
                entries: []
            };
        }

        const entries = String(result.stdout || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((name) => classifyArchiveEntry(name));

        return { inspected: true, entries };
    } catch (error) {
        return { inspected: false, error: error.message, entries: [] };
    } finally {
        try { fs.unlinkSync(tempPath); } catch {}
    }
}

function classifyArchiveEntry(name) {
    const ext = getExtension(name);
    let severity = 'safe';

    if (DANGEROUS_EXTENSIONS.includes(ext)) {
        severity = 'critical';
    } else if (SUSPICIOUS_EXTENSIONS.includes(ext) || ['.docm', '.xlsm', '.pptm'].includes(ext)) {
        severity = 'warning';
    }

    return { name, extension: ext, severity };
}

function inspectImagePayload(att) {
    const content = att.content || Buffer.alloc(0);
    const ext = getExtension(att.filename);
    const mime = String(att.contentType || '').toLowerCase();
    const suspiciousMarkers = detectSuspiciousMarkers(content);

    if (ext === '.png' || mime === 'image/png') {
        const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const validSignature = content.subarray(0, 8).equals(signature);
        const iend = Buffer.from('49454e44ae426082', 'hex');
        const endIndex = content.lastIndexOf(iend);
        const trailingPayload = endIndex >= 0 && endIndex + iend.length < content.length;
        return {
            type: 'png',
            validSignature,
            trailingPayload,
            suspiciousMarkers
        };
    }

    if (ext === '.jpg' || ext === '.jpeg' || mime === 'image/jpeg') {
        const validSignature = content.length >= 4
            && content[0] === 0xFF && content[1] === 0xD8
            && content[content.length - 2] === 0xFF && content[content.length - 1] === 0xD9;
        return {
            type: 'jpeg',
            validSignature,
            trailingPayload: false,
            suspiciousMarkers
        };
    }

    if (ext === '.gif' || mime === 'image/gif') {
        const header = content.subarray(0, 6).toString('ascii');
        return {
            type: 'gif',
            validSignature: header === 'GIF87a' || header === 'GIF89a',
            trailingPayload: false,
            suspiciousMarkers
        };
    }

    return {
        type: ext.replace('.', '') || 'image',
        validSignature: true,
        trailingPayload: false,
        suspiciousMarkers
    };
}

function detectSuspiciousMarkers(content) {
    const haystack = content.toString('latin1');
    const markers = [
        { label: 'MZ executable header', pattern: /MZ/ },
        { label: 'ZIP archive header', pattern: /PK\x03\x04/ },
        { label: 'RAR archive header', pattern: /Rar!/ },
        { label: 'HTML script tag', pattern: /<script/i },
        { label: 'javascript keyword', pattern: /javascript/i }
    ];

    return markers
        .filter((marker) => marker.pattern.test(haystack))
        .map((marker) => marker.label);
}

// ─── YENİ: ŞİFRELİ ARŞİV TESPİTİ ──────────────────────────
// ZIP dosyalarında Local File Header encryption flag (bit 0 of general purpose bit flag) kontrolü.
// RFC 1950 / ZIP spec: offset 6 = general purpose bit flag; bit 0 set → encrypted.

function detectEncryptedArchive(filename, content) {
    const ext = getExtension(filename);

    if (ext === '.zip' || ['.docm', '.xlsm', '.pptm', '.dotm', '.xltm', '.docx', '.xlsx', '.pptx'].includes(ext)) {
        // ZIP magic: PK\x03\x04
        if (content.length < 30) return { encrypted: false };
        let offset = 0;
        while (offset + 30 < content.length) {
            // Local file header signature
            if (content[offset] === 0x50 && content[offset+1] === 0x4B &&
                content[offset+2] === 0x03 && content[offset+3] === 0x04) {
                const flags = content.readUInt16LE(offset + 6);
                if (flags & 0x01) return { encrypted: true }; // bit 0 = encryption
                // Move to next entry: skip header + filename + extra
                const fnLen = content.readUInt16LE(offset + 26);
                const extraLen = content.readUInt16LE(offset + 28);
                const compSize = content.readUInt32LE(offset + 18);
                offset += 30 + fnLen + extraLen + compSize;
                if (offset <= 30) break; // sanity check
            } else {
                break;
            }
        }
        return { encrypted: false };
    }

    if (ext === '.rar') {
        // RAR4: look for file header with encryption bit (0x04)
        // Simple heuristic: search for "Rar!" signature then check flags
        const rarSig = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]);
        if (content.subarray(0, 6).equals(rarSig)) {
            // Check block flags at offset 10 bit 2 (encryption)
            if (content.length > 24 && (content[24] & 0x04)) return { encrypted: true };
        }
        return { encrypted: false };
    }

    return { encrypted: false };
}

// ─── YENİ: OFFİCE VBA MAKRO ANALİZİ ────────────────────────
// .docm/.xlsm dosyaları ZIP arşividir. İçinde vbaProject.bin varsa makro içerir.
// vbaProject.bin içindeki metin taranarak tehlikeli komutlar aranır.

const DANGEROUS_VBA_PATTERNS = [
    /Shell\s*\(/i, /WScript\.Shell/i, /CreateObject\s*\(/i,
    /powershell/i, /cmd\.exe/i, /mshta/i, /wscript/i, /cscript/i,
    /DownloadFile/i, /DownloadString/i, /Invoke-Expression/i,
    /environ\s*\(/i, /FSO\s*=/i, /FileSystemObject/i,
    /http:\/\//i, /https:\/\//i, /ftp:\/\//i,
    /AutoOpen/i, /Auto_Open/i, /Document_Open/i, /Workbook_Open/i,
    /\bExec\s*\(/i, /\bRun\s*\(/i, /Chr\s*\(/i
];

function inspectOfficeMacros(content) {
    // Office Open XML files are ZIP archives
    if (content.length < 4) return { hasMacros: false, dangerousCommands: [] };

    // Check ZIP signature
    if (content[0] !== 0x50 || content[1] !== 0x4B) {
        return { hasMacros: false, dangerousCommands: [] };
    }

    // Extract vbaProject.bin from the ZIP using tar (Windows/cross-platform)
    const tempZip = path.join(os.tmpdir(), `msa-macro-${Date.now()}.zip`);
    const tempDir = path.join(os.tmpdir(), `msa-macro-${Date.now()}`);
    try {
        fs.writeFileSync(tempZip, content);
        fs.mkdirSync(tempDir, { recursive: true });

        // List zip contents
        const listResult = spawnSync('tar', ['-tf', tempZip], {
            encoding: 'utf8', windowsHide: true, timeout: 10000
        });

        const entries = String(listResult.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const vbaEntry = entries.find(e => /vbaProject\.bin$/i.test(e) || /vba\//i.test(e));

        if (!vbaEntry) return { hasMacros: false, dangerousCommands: [] };

        // Extract vbaProject.bin
        const extractResult = spawnSync('tar', ['-xf', tempZip, '-C', tempDir, vbaEntry], {
            windowsHide: true, timeout: 10000
        });

        const vbaPath = path.join(tempDir, vbaEntry.replace(/\//g, path.sep));
        if (!fs.existsSync(vbaPath)) return { hasMacros: true, dangerousCommands: [] };

        const vbaContent = fs.readFileSync(vbaPath).toString('latin1');

        const dangerousCommands = DANGEROUS_VBA_PATTERNS
            .filter(p => p.test(vbaContent))
            .map(p => p.toString().replace(/^\/|\/i$/g, '').split('\\s')[0]);

        return { hasMacros: true, dangerousCommands: [...new Set(dangerousCommands)] };
    } catch {
        return { hasMacros: true, dangerousCommands: [] }; // vbaProject.bin var ama okunamadı → yine de uyar
    } finally {
        try { fs.unlinkSync(tempZip); } catch {}
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
}

module.exports = { analyzeAttachments };
