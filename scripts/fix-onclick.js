'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'index.html');
let src = fs.readFileSync(filePath, 'utf8');

const before = (src.match(/onclick=/g) || []).length;

// Complex DOM handlers — leave as-is
const KEEP = new Set([
    "document.getElementById('imapAlertReportToInput').focus()",
    "document.getElementById('listsPanel').style.display='none'",
    "document.getElementById('userTdImportFile').click()",
    "if(event.target===this)closeListDetailModal()",
]);

// Compound action map: onclick value → data-fn value
const COMPOUND = {
    "showLicenseModal(); closeMobileMenu()":    'showLicense_closeMenu',
    "showPage('home');  closeMobileMenu()":     'showHome_closeMenu',
    "showPage('otx-approval'); closeMobileMenu()": 'showOtxApproval_closeMenu',
    "showPage('scan');  closeMobileMenu()":     'showScan_closeMenu',
    "showPage('scan');selectMode('imap')":      'showScan_imap',
    "showPage('scan');selectMode('upload')":    'showScan_upload',
    "showPage('scan-list'); closeMobileMenu()": 'showScanList_closeMenu',
    "showPage('stats'); closeMobileMenu()":     'showStats_closeMenu',
    "showSettings(); closeMobileMenu()":        'showSettings_closeMenu',
    "toggleLang(); closeMobileMenu()":          'showLang_closeMenu',
};

let replaced = 0;

// Replace onclick="VALUE" with appropriate data-fn / data-arg attributes
src = src.replace(/\bonclick="([^"]*)"/g, (match, value) => {
    // Keep complex DOM handlers
    if (KEEP.has(value)) return match;

    // Compound actions
    if (COMPOUND[value]) {
        replaced++;
        return `data-fn="${COMPOUND[value]}"`;
    }

    // funcName('arg') — single quoted string arg
    const argMatch = value.match(/^(\w+)\('([^']*)'\)$/);
    if (argMatch) {
        replaced++;
        return `data-fn="${argMatch[1]}" data-arg="${argMatch[2]}"`;
    }

    // funcName(number) — numeric arg
    const numMatch = value.match(/^(\w+)\((\d+)\)$/);
    if (numMatch) {
        replaced++;
        return `data-fn="${numMatch[1]}" data-arg="${numMatch[2]}"`;
    }

    // funcName() — no args
    const noArgMatch = value.match(/^(\w+)\(\)$/);
    if (noArgMatch) {
        replaced++;
        return `data-fn="${noArgMatch[1]}"`;
    }

    // Unmatched — leave as-is
    console.warn('[fix-onclick] Unmatched:', value);
    return match;
});

// Add events.js script tag before i18n.js
src = src.replace(
    '<script src="/js/i18n.js"></script>',
    '<script src="/js/events.js"></script>\n<script src="/js/i18n.js"></script>'
);

const after = (src.match(/onclick=/g) || []).length;
fs.writeFileSync(filePath, src, 'utf8');
console.log(`onclick: ${before} -> ${after} (replaced ${replaced}, kept ${after})`);
