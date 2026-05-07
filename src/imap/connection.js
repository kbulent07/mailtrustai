// ============================================================
// IMAP CONNECTION MANAGER — Encrypted credential storage
// ============================================================
const { ImapFlow } = require('imapflow');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CRED_FILE = path.join(__dirname, '..', '..', 'data', 'credentials.enc');
const ENC_PASSWORD = process.env.MSA_ENC_PASSWORD;
const ENC_SALT = process.env.MSA_ENC_SALT;
if (!ENC_PASSWORD || !ENC_SALT) {
    if (process.env.NODE_ENV === 'production') {
        console.error('[Connection] FATAL: MSA_ENC_PASSWORD ve MSA_ENC_SALT ortam değişkenleri zorunludur.');
        process.exit(1);
    }
    console.warn('[Connection] UYARI: MSA_ENC_PASSWORD / MSA_ENC_SALT tanımlı değil — güvensiz varsayılan kullanılıyor (yalnızca geliştirme).');
}
const _ENC_PASSWORD = ENC_PASSWORD || 'MSA_IMAP_ENC_2024_DEV';
const _ENC_SALT     = ENC_SALT     || 'salt_msa_dev';
const ENC_KEY = crypto.scryptSync(_ENC_PASSWORD, _ENC_SALT, 32);
const IV_LENGTH = 16;

function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENC_KEY, iv);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return iv.toString('hex') + ':' + enc;
}

function decrypt(text) {
    const [ivHex, encHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY, iv);
    let dec = decipher.update(encHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

function saveCredentials(accounts) {
    const dir = path.dirname(CRED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const encrypted = encrypt(JSON.stringify(accounts));
    fs.writeFileSync(CRED_FILE, encrypted, 'utf8');
}

function loadCredentials() {
    try {
        if (!fs.existsSync(CRED_FILE)) return [];
        const encrypted = fs.readFileSync(CRED_FILE, 'utf8');
        return JSON.parse(decrypt(encrypted));
    } catch { return []; }
}

function addAccount(account) {
    const accounts = loadCredentials();
    const existing = accounts.findIndex(a => a.email === account.email);
    if (existing >= 0) accounts[existing] = account;
    else accounts.push(account);
    saveCredentials(accounts);
    return accounts;
}

function removeAccount(email) {
    const accounts = loadCredentials().filter(a => a.email !== email);
    saveCredentials(accounts);
    return accounts;
}

function updateAccount(email, patch) {
    const accounts = loadCredentials();
    const idx = accounts.findIndex(a => a.email === email);
    if (idx < 0) return null;
    accounts[idx] = { ...accounts[idx], ...patch, email };
    saveCredentials(accounts);
    return accounts[idx];
}

async function createConnection(account) {
    const client = new ImapFlow({
        host: account.host,
        port: account.port || 993,
        secure: account.secure !== false,
        auth: { user: account.email, pass: account.password },
        tls: { rejectUnauthorized: account.rejectUnauthorized === false ? false : true },
        connectionTimeout: 15000,
        greetingTimeout: 8000,
        socketTimeout: 30000,
        logger: false
    });
    
    // Prevent unhandled error events from crashing the Node.js server
    client.on('error', err => {
        console.error(`[IMAP Error - ${account.email}]:`, err.message);
    });

    return client;
}

async function testConnection(account) {
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const client = await createConnection(account);
        try {
            await client.connect();
            await client.logout();
            return { success: true, message: 'Connection successful' };
        } catch (e) {
            lastError = e.message;
            await client.logout().catch(() => {});
            if (!isRetryableConnectionError(e) || attempt === 3) break;
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        }
    }
    return { success: false, message: lastError };
}

function isRetryableConnectionError(error) {
    return /ECONNRESET|Connection not available|socket|timeout/i.test(String(error?.message || error || ''));
}

module.exports = { createConnection, testConnection, addAccount, removeAccount, updateAccount, loadCredentials, encrypt, decrypt };
