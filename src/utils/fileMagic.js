// ============================================================
// FILE MAGIC NUMBER DETECTOR
// Multer'da fileFilter ve route handler'larda upload edilen
// dosyalarin gercek formatini dosya basligindan dogrular.
// "file-type" paketi v19+ ESM-only oldugu icin CJS uyumlu
// kucuk bir inline detector kullaniyoruz.
// ============================================================

const SIGNATURES = [
    // [name, magic bytes (hex), offset]
    { name: 'pdf',    hex: '255044462d',          offset: 0 }, // %PDF-
    { name: 'ole2',   hex: 'd0cf11e0a1b11ae1',    offset: 0 }, // .msg, eski .doc/.xls
    { name: 'zip',    hex: '504b0304',            offset: 0 }, // .docx, .xlsx, .pptx, .zip
    { name: 'zip',    hex: '504b0506',            offset: 0 }, // empty zip
    { name: 'zip',    hex: '504b0708',            offset: 0 }, // spanned zip
    { name: 'rar',    hex: '526172211a0700',      offset: 0 },
    { name: 'rar5',   hex: '526172211a070100',    offset: 0 },
    { name: '7z',     hex: '377abcaf271c',        offset: 0 },
    { name: 'gz',     hex: '1f8b',                offset: 0 },
    { name: 'png',    hex: '89504e470d0a1a0a',    offset: 0 },
    { name: 'jpeg',   hex: 'ffd8ff',              offset: 0 },
    { name: 'gif',    hex: '474946383761',        offset: 0 },
    { name: 'gif',    hex: '474946383961',        offset: 0 },
    { name: 'bmp',    hex: '424d',                offset: 0 },
    { name: 'webp',   hex: '52494646',            offset: 0 }, // RIFF (genel)
    { name: 'exe',    hex: '4d5a',                offset: 0 }, // MZ — PE/DOS
    { name: 'elf',    hex: '7f454c46',            offset: 0 },
    { name: 'macho',  hex: 'feedface',            offset: 0 },
    { name: 'macho',  hex: 'feedfacf',            offset: 0 },
    { name: 'class',  hex: 'cafebabe',            offset: 0 }, // .class veya macho fat
];

/**
 * Buffer'in ilk birkac byte'indan format tahmin eder.
 * Bilinmeyen ya da text/binary ayrimi yapilamayan → 'unknown'.
 * EML (RFC 822) text-based oldugu icin magic'i yoktur; ayri kontrol edilir.
 */
function detectFormat(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 2) return 'unknown';
    const head = buffer.subarray(0, 32).toString('hex').toLowerCase();
    for (const sig of SIGNATURES) {
        const start = sig.offset * 2;
        if (head.startsWith(sig.hex, start)) return sig.name;
    }
    return 'unknown';
}

/**
 * EML formatini sezgisel kontrol eder — text icerigi RFC 822 basliklarini
 * icermeli (From:/To:/Subject:/Received:/Date: gibi). 'msg' OLE2.
 */
function looksLikeEml(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
    // Ilk 8 KB'a bak (header bolumu burada olmalı)
    const head = buffer.subarray(0, Math.min(8192, buffer.length)).toString('utf8');
    // En az iki standart mail header satiri olsun
    const headerCount = [
        /^From:\s/im, /^To:\s/im, /^Subject:\s/im,
        /^Date:\s/im, /^Received:\s/im, /^Message-ID:\s/im,
        /^MIME-Version:\s/im, /^Return-Path:\s/im
    ].reduce((n, re) => n + (re.test(head) ? 1 : 0), 0);
    return headerCount >= 2;
}

/**
 * Multer fileFilter helper'i: izin verilen format kumesini alir,
 * dosya magic'ine bakar, uygun degilse reject eder.
 *
 * @param {Set<string>} allowedFormats — 'eml','msg','pdf','zip','png',...
 * @returns multer fileFilter callback
 *
 * NOT: multer memoryStorage ile calistiginda req.file.buffer henuz dolmamis olur.
 * Bu sebeple gercek dogrulama route handler icinde (assertFileFormat) yapilmali.
 * fileFilter sadece uzanti/MIME on-kontrolu icin.
 */
function makeUploadFilter(allowedExtensions) {
    const allowed = new Set(allowedExtensions.map(s => s.toLowerCase().replace(/^\./, '')));
    return function fileFilter(req, file, cb) {
        const name = String(file.originalname || '').toLowerCase();
        const ext = (name.match(/\.([a-z0-9]{1,12})$/i) || [, ''])[1].toLowerCase();
        if (!allowed.has(ext)) {
            return cb(new Error(`Bu dosya tipi kabul edilmiyor (.${ext || 'bilinmiyor'})`));
        }
        cb(null, true);
    };
}

/**
 * Route handler icinde req.file.buffer dolu — gercek magic kontrolu burada.
 * Mismatch ise throw eder, handler 400 doner.
 */
function assertFileFormat(buffer, originalName, allowedFormats) {
    const ext = (String(originalName || '').match(/\.([a-z0-9]{1,12})$/i) || [, ''])[1].toLowerCase();
    const detected = detectFormat(buffer);
    const allowed = new Set(allowedFormats);

    // EML icin ayri kontrol
    if (ext === 'eml' || allowed.has('eml')) {
        if (looksLikeEml(buffer)) return { ok: true, format: 'eml' };
    }
    if (detected !== 'unknown' && allowed.has(detected)) {
        return { ok: true, format: detected };
    }
    // Bilinmeyen format → ek (attachment) tarama icin izin ver,
    // ama eml/msg gibi spesifik route'larda reddet.
    return {
        ok: false,
        format: detected,
        reason: `Dosya icerigi beklenen formatta degil (uzanti: .${ext}, tespit: ${detected})`
    };
}

module.exports = {
    detectFormat,
    looksLikeEml,
    makeUploadFilter,
    assertFileFormat
};
