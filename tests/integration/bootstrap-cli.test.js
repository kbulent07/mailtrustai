'use strict';
// Bootstrap CLI smoke test — daha önce sync `db.prepare()` ile broken'di,
// async run/get/all ile yeniden yazıldı; regression koruması.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'msa-cli-'));
const SCRIPT = path.resolve(__dirname, '..', '..', 'apps', 'license-server', 'bin', 'bootstrap.js');

function runCli(args) {
    const env = {
        ...process.env,
        DATA_DIR: TMP,
        LICENSE_DB_CLIENT: 'sqlite',
        LICENSE_DB_PATH: path.join(TMP, 'cli.sqlite'),
        LICENSE_SIGNING_SECRET: 'cli-test-secret',
        NODE_ENV: 'development'
    };
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 30000 });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('bootstrap CLI: tum komutlar runtime hatasi atmaz', async () => {
    // create-dealer
    let r = runCli(['create-dealer', '--id', 'cli-dlr', '--name', 'CLI Dealer', '--email', 'cli@x.com']);
    assert.strictEqual(r.code, 0, `create-dealer exit: ${r.code}\nstderr: ${r.err}`);
    assert.match(r.out, /dealer olu/);

    // set-dealer-password (kisa parola reddedilir)
    r = runCli(['set-dealer-password', '--id', 'cli-dlr', '--password', 'short']);
    assert.notStrictEqual(r.code, 0, 'kisa parola kabul edilmemeli');
    assert.match(r.err, /en az 8 karakter/);

    r = runCli(['set-dealer-password', '--id', 'cli-dlr', '--password', 'strong-password-123']);
    assert.strictEqual(r.code, 0, `set-password exit: ${r.code}\nstderr: ${r.err}`);
    assert.match(r.out, /şifre güncellendi/);

    // create-license
    r = runCli(['create-license', '--customerId', 'cli-cust', '--dealerId', 'cli-dlr',
                '--plan', 'pro', '--validDays', '90', '--companyName', 'CLI Co']);
    assert.strictEqual(r.code, 0, `create-license exit: ${r.code}\nstderr: ${r.err}`);
    assert.match(r.out, /licenseKey: MTAI-/);
    assert.match(r.out, /plan:\s+pro/);

    // Negatif: gecersiz plan
    r = runCli(['create-license', '--customerId', 'x', '--plan', 'INVALID']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.err + r.out, /plan ge[çc]ersiz/);

    // Negatif: olmayan dealer
    r = runCli(['create-license', '--customerId', 'y', '--dealerId', 'nope', '--plan', 'pro']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.err + r.out, /dealer bulunamad/);

    // list-dealers
    r = runCli(['list-dealers']);
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /cli-dlr/);

    // list-licenses
    r = runCli(['list-licenses']);
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /cli-cust/);

    // Bilinmeyen komut
    r = runCli(['unknown-cmd']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.err, /Komutlar:/);
});

test('bootstrap CLI: olmayan dealer parolasi 1 ile cikar', () => {
    const r = runCli(['set-dealer-password', '--id', 'gibberish-no-such-dealer', '--password', 'long-enough-pw']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.err, /dealer bulunamad/);
});
