// Replaces currentLang ternaries with _tLit(...)
// Pass 1: single-quoted literals  (may have extra alignment spaces)
// Pass 2: variable references like data.labelTR / data.labelEN
'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'js', 'app.js');
let src = fs.readFileSync(filePath, 'utf8');

const before = (src.match(/currentLang === 'tr'/g) || []).length;

// Pass 1: single-quoted literals with any spacing around ':'
// Pattern: currentLang === 'tr' ? '<sq>' <spaces>: '<sq>'
const SQ = "'(?:[^'\\\\]|\\\\.)*'";
const p1 = new RegExp(
  "currentLang === 'tr' \\? (" + SQ + ")\\s*:\\s*(" + SQ + ")",
  'g'
);
src = src.replace(p1, '_tLit($1, $2)');

// Pass 2: identifier/property references (e.g. data.labelTR : data.labelEN)
const IDENT = '[a-zA-Z_$][a-zA-Z0-9_$.]*';
const p2 = new RegExp(
  "currentLang === 'tr' \\? (" + IDENT + ")\\s*:\\s*(" + IDENT + ")",
  'g'
);
src = src.replace(p2, '_tLit($1, $2)');

const after = (src.match(/currentLang === 'tr'/g) || []).length;
fs.writeFileSync(filePath, src, 'utf8');
console.log(`Replaced this run: ${before - after} | Remaining: ${after}`);
