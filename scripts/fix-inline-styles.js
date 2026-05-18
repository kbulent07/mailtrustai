// Replace most-repeated inline styles with utility classes in JS-generated HTML
'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'js', 'app.js');
let src = fs.readFileSync(filePath, 'utf8');

// Count helper
function count(str, needle) { return (str.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length; }

const before = count(src, 'style=');

// Replace inline style="X" with class="u-Y" ONLY when the style is the entire content
// and there's no existing class. These are safe single-property patterns.
const replacements = [
  // Single-style attributes that can be fully replaced
  [/\bstyle="color:#f87171;font-weight:600"/g, 'class="u-err-b"'],
  [/\bstyle="color:#f87171"/g, 'class="u-err"'],
  [/\bstyle="color:var\(--green,#00e676\)"/g, 'class="u-ok"'],
  [/\bstyle="color:#34d399"/g, 'class="u-ok2"'],
  [/\bstyle="flex:1;min-width:0"/g, 'class="u-flex1-0"'],
  [/\bstyle="flex:1"/g, 'class="u-flex1"'],
  [/\bstyle="margin-top:8px;?"/g, 'class="u-mt8"'],
  [/\bstyle="margin-top:8px"/g, 'class="u-mt8"'],
  [/\bstyle="margin-bottom:8px;?"/g, 'class="u-mb8"'],
  [/\bstyle="margin-bottom:14px"/g, 'class="u-mb14"'],
  [/\bstyle="margin-bottom:16px;?"/g, 'class="u-mb16"'],
  [/\bstyle="margin-bottom:20px"/g, 'class="u-mb20"'],
  [/\bstyle="font-size:11px"/g, 'class="u-xs"'],
  [/\bstyle="font-size:12px"/g, 'class="u-sm"'],
  [/\bstyle="font-size:11px;color:var\(--text-secondary\)"/g, 'class="u-xs-m"'],
  [/\bstyle="text-align:center;padding:10px"/g, 'class="u-center u-p10"'],
  [/\bstyle="display:flex;align-items:flex-start;gap:10px"/g, 'class="u-row-10"'],
];

let replaced = 0;
for (const [pattern, replacement] of replacements) {
  const before2 = count(src, 'style=');
  src = src.replace(pattern, replacement);
  replaced += before2 - count(src, 'style=');
}

const after = count(src, 'style=');
fs.writeFileSync(filePath, src, 'utf8');
console.log(`Inline styles: ${before} -> ${after} (reduced by ${before - after})`);
