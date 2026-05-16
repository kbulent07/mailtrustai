#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const skipSmoke = args.has('--skip-smoke');
const onlyTests = args.has('--only-tests');
function runStep(name, command, args) {
    console.log(`\n[precheck] ${name} -> ${command} ${args.join(' ')}`);
    const res = spawnSync(command, args, {
        cwd: root,
        stdio: 'inherit',
        shell: false,
        env: process.env
    });
    if (res.error) {
        throw new Error(`${name} failed to start: ${res.error.message}`);
    }
    if (res.status !== 0) {
        const code = res.status === null ? `signal=${res.signal || 'unknown'}` : `exit code ${res.status}`;
        throw new Error(`${name} failed with ${code}`);
    }
}

function copyTree(src, dst) {
    if (!fs.existsSync(src)) return;
    const st = fs.statSync(src);
    if (st.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
            copyTree(path.join(src, entry), path.join(dst, entry));
        }
        return;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
}

function rmSafe(base, rel) {
    try {
        fs.rmSync(path.join(base, rel), { recursive: true, force: true });
    } catch (_) {}
}

function runCustomerImageGate() {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-release-stage-'));
    const required = ['apps/customer', 'packages', 'src', 'public', 'scripts', 'docs'];
    for (const rel of required) copyTree(path.join(root, rel), path.join(stage, rel));

    const prune = [
        'packages/license-core',
        'src/license/keygenTool.js',
        'src/license/license-generator.js',
        'src/routes/dealerApi.js',
        'src/interfaces/http/routes/resellers.routes.js',
        'src/interfaces/http/routes/admin.routes.js',
        'src/storage/dealerStore.js',
        'src/storage/dealerCustomerStore.js',
        'src/storage/dealerSales.js',
        'src/storage/resellerStore.js',
        'src/storage/issuedLicenseStore.js',
        'src/storage/creditTransactionStore.js',
        'src/middleware/adminAuth.js',
        'src/utils/dealerLock.js',
        'public/bayi.html',
        'public/keygen.html',
        'public/js/bayi-app.js'
    ];
    for (const rel of prune) rmSafe(stage, rel);

    console.log(`\n[precheck] customer package image gate -> staged tree ${stage}`);
    const res = spawnSync('node', ['scripts/check-customer-package.js'], {
        cwd: stage,
        stdio: 'inherit',
        shell: false,
        env: process.env
    });
    rmSafe(stage, '.');
    if (res.status !== 0) throw new Error(`customer package image gate failed with exit code ${res.status}`);
}

function main() {
    const start = Date.now();
    console.log('[precheck] release precheck basladi');
    if (onlyTests) console.log('[precheck] mode: --only-tests');
    if (skipSmoke) console.log('[precheck] mode: --skip-smoke');

    runStep(
        'integration+security tests',
        'node',
        ['--test', 'tests/unit/*.test.js', 'tests/integration/*.test.js', 'tests/security/*.test.js']
    );

    if (onlyTests) {
        const sec = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`\n[precheck] SUCCESS tests-only (${sec}s)`);
        return;
    }

    runCustomerImageGate();

    if (!skipSmoke) {
        runStep(
            'central flow smoke',
            'node',
            ['scripts/smoke-central-flow.js']
        );
    } else {
        console.log('\n[precheck] central flow smoke adimi atlandi (--skip-smoke)');
    }

    const sec = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n[precheck] SUCCESS (${sec}s)`);
}

main();
