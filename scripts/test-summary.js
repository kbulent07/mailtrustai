#!/usr/bin/env node
'use strict';
const fs = require('fs');
const text = fs.readFileSync(process.argv[2] || '/tmp/t3.txt', 'utf8');
const lines = text.split(/\r?\n/);
const fails = {}, passes = {};
let currentFile = null;
for (const line of lines) {
    const m = line.match(/^[▶> ]+(tests[\\/].*\.test\.js)/);
    if (m) currentFile = m[1].replace(/\\/g, '/');
    if (/^✖/.test(line) && currentFile) fails[currentFile] = (fails[currentFile] || 0) + 1;
    if (/^✔/.test(line) && currentFile) passes[currentFile] = (passes[currentFile] || 0) + 1;
}
const all = [...new Set([...Object.keys(passes), ...Object.keys(fails)])].sort();
let totalPass = 0, totalFail = 0;
for (const f of all) {
    const p = passes[f] || 0, fa = fails[f] || 0;
    totalPass += p; totalFail += fa;
    const mark = fa === 0 && p > 0 ? '✓ ' : (fa > 0 ? '✗ ' : '? ');
    console.log(`  ${mark}${f}: ${p} pass, ${fa} fail`);
}
console.log(`\nTOTAL: ${totalPass} pass, ${totalFail} fail`);
