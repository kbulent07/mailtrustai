const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const POWERSHELL = 'powershell';
const TRANSPORT_HEADERS_PROP = 'http://schemas.microsoft.com/mapi/proptag/0x007D001F';

async function parseMsgBuffer(buffer) {
    const tempDir = path.join(os.tmpdir(), `msa-msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    const msgPath = path.join(tempDir, 'message.msg');
    const scriptPath = path.join(tempDir, 'parse-msg.ps1');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(msgPath, buffer);
    fs.writeFileSync(scriptPath, buildPowerShellScript(), 'utf8');

    try {
        const result = spawnSync(POWERSHELL, [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-MsgPath', msgPath,
            '-OutDir', tempDir
        ], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 120000
        });

        if (result.status !== 0) {
            return {
                success: false,
                error: (result.stderr || result.stdout || 'MSG parse failed').trim()
            };
        }

        const jsonText = String(result.stdout || '').trim();
        const parsed = JSON.parse(jsonText);
        const attachments = (parsed.attachments || []).map((att) => {
            const content = fs.readFileSync(att.savedPath);
            // .msg formatında embedded image flag'ı `att.isInline` veya
            // `att.dispositionType` ile gelebilir (parser sürümüne göre değişir).
            const inline = att.isInline === true
                || String(att.dispositionType || att.contentDisposition || '').toLowerCase() === 'inline';
            return {
                filename: att.filename || 'unnamed',
                contentType: att.contentType || guessContentTypeFromFilename(att.filename),
                size: att.size || content.length,
                content,
                contentDisposition: inline ? 'inline' : 'attachment',
                cid: att.contentId || att.cid || null,
                headers: {}
            };
        });

        return {
            success: true,
            data: {
                messageId: '',
                from: parsed.from ? [parsed.from] : [],
                to: asArray(parsed.to),
                cc: asArray(parsed.cc),
                bcc: asArray(parsed.bcc),
                replyTo: asArray(parsed.replyTo),
                subject: parsed.subject || '(No Subject)',
                date: parsed.date || new Date().toISOString(),
                inReplyTo: '',
                references: [],
                headers: headerObjectFromRaw(parsed.transportHeaders || ''),
                headerLines: headerLinesFromRaw(parsed.transportHeaders || ''),
                text: parsed.text || '',
                html: parsed.html || '',
                textAsHtml: '',
                attachments,
                quarantinedAttachments: [],
                attachmentCount: attachments.length,
                receivedHeaders: [],
                authResults: [],
                spf: { status: 'unknown', details: '' },
                dkim: { status: 'unknown', details: '' },
                dmarc: { status: 'unknown', details: '' }
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }
}

function buildPowerShellScript() {
    return `
param(
    [string]$MsgPath,
    [string]$OutDir
)
$ErrorActionPreference = 'Stop'

function Get-ContentType([string]$Name) {
    $ext = [System.IO.Path]::GetExtension($Name).ToLowerInvariant()
    switch ($ext) {
        '.rar' { 'application/vnd.rar'; break }
        '.zip' { 'application/zip'; break }
        '.7z' { 'application/x-7z-compressed'; break }
        '.png' { 'image/png'; break }
        '.jpg' { 'image/jpeg'; break }
        '.jpeg' { 'image/jpeg'; break }
        '.gif' { 'image/gif'; break }
        '.pdf' { 'application/pdf'; break }
        '.msg' { 'application/vnd.ms-outlook'; break }
        '.eml' { 'message/rfc822'; break }
        '.js' { 'application/javascript'; break }
        default { 'application/octet-stream' }
    }
}

function Get-RecipientsByType($Mail, [int]$Type) {
    $items = @()
    foreach ($recipient in $Mail.Recipients) {
        if ($recipient.Type -eq $Type) {
            $items += [pscustomobject]@{
                name = $recipient.Name
                address = $recipient.Address
            }
        }
    }
    return $items
}

$outlook = $null
$mail = $null
try {
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')
    $mail = $namespace.OpenSharedItem($MsgPath)

    $transportHeaders = ''
    try {
        $transportHeaders = $mail.PropertyAccessor.GetProperty('${TRANSPORT_HEADERS_PROP}')
    } catch {}

    $attachments = @()
    for ($i = 1; $i -le $mail.Attachments.Count; $i++) {
        $attachment = $mail.Attachments.Item($i)
        $fileName = if ($attachment.FileName) { [System.IO.Path]::GetFileName($attachment.FileName) } else { "attachment-$i.bin" }
        $safeSavedPath = Join-Path $OutDir ("attachment-$i.bin")
        $attachment.SaveAsFile($safeSavedPath)
        $fileInfo = Get-Item $safeSavedPath

        $attachments += [pscustomobject]@{
            filename = $fileName
            savedPath = $safeSavedPath
            size = $fileInfo.Length
            contentType = Get-ContentType $fileName
        }
    }

    $payload = [pscustomobject]@{
        subject = $mail.Subject
        date = (Get-Date $mail.SentOn -Format o)
        from = [pscustomobject]@{
            name = $mail.SenderName
            address = $mail.SenderEmailAddress
        }
        to = Get-RecipientsByType $mail 1
        cc = Get-RecipientsByType $mail 2
        bcc = Get-RecipientsByType $mail 3
        replyTo = @()
        text = $mail.Body
        html = $mail.HTMLBody
        transportHeaders = $transportHeaders
        attachments = $attachments
    }

    $payload | ConvertTo-Json -Depth 8 -Compress
} finally {
    if ($mail) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($mail) | Out-Null }
    if ($outlook) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null }
    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}
`;
}

function headerLinesFromRaw(rawHeaders) {
    return String(rawHeaders || '')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
            const separatorIndex = line.indexOf(':');
            const key = separatorIndex > 0 ? line.slice(0, separatorIndex).trim().toLowerCase() : '';
            return { key, line };
        })
        .filter((item) => item.key);
}

function headerObjectFromRaw(rawHeaders) {
    const result = {};
    headerLinesFromRaw(rawHeaders).forEach((item) => {
        if (!(item.key in result)) {
            result[item.key] = item.line;
        }
    });
    return result;
}

function guessContentTypeFromFilename(filename) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.rar')) return 'application/vnd.rar';
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.7z')) return 'application/x-7z-compressed';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.msg')) return 'application/vnd.ms-outlook';
    if (lower.endsWith('.eml')) return 'message/rfc822';
    if (lower.endsWith('.js')) return 'application/javascript';
    return 'application/octet-stream';
}

function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

module.exports = { parseMsgBuffer };
