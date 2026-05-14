// ============================================================
// MÜŞTERİ KULLANICILARI (Customer Users) — CRUD + migration
//
// Roller:
//   admin → Müşteri panelindeki HER ŞEYİ yapabilir (API key, IMAP, webhook,
//           ayarlar, kullanıcı yönetimi, vb.)
//   user  → Yalnız kendisine atanan imap_email ile çalışır:
//           o IMAP hesabını görür, manuel mail tarayabilir, başka hiçbir şeye
//           erişemez (settings, dealer, license generation, vb. yasak).
// ============================================================
const bcrypt = require('bcrypt');
const db = require('./db');

function _normEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function _isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── Sorgular (prepared statements) ──────────────────────────────────────────
const _stmtFindByEmail = db.prepare(`
    SELECT email, pwd_hash AS pwdHash, role, imap_email AS imapEmail,
           active, created_at AS createdAt, last_login AS lastLogin
      FROM customer_users WHERE email = ?
`);

const _stmtCount = db.prepare(`SELECT COUNT(*) AS n FROM customer_users`);

const _stmtCountAdmins = db.prepare(`SELECT COUNT(*) AS n FROM customer_users WHERE role='admin' AND active=1`);

const _stmtList = db.prepare(`
    SELECT email, role, imap_email AS imapEmail,
           active, created_at AS createdAt, last_login AS lastLogin
      FROM customer_users ORDER BY created_at ASC
`);

const _stmtInsert = db.prepare(`
    INSERT INTO customer_users (email, pwd_hash, role, imap_email, active)
    VALUES (?, ?, ?, ?, ?)
`);

const _stmtUpdatePwd = db.prepare(`UPDATE customer_users SET pwd_hash = ? WHERE email = ?`);

const _stmtUpdateRole = db.prepare(`UPDATE customer_users SET role = ?, imap_email = ? WHERE email = ?`);

const _stmtUpdateActive = db.prepare(`UPDATE customer_users SET active = ? WHERE email = ?`);

const _stmtUpdateImap = db.prepare(`UPDATE customer_users SET imap_email = ? WHERE email = ?`);

const _stmtDelete = db.prepare(`DELETE FROM customer_users WHERE email = ?`);

const _stmtTouchLogin = db.prepare(
    `UPDATE customer_users SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email = ?`
);

// ─── Public API ──────────────────────────────────────────────────────────────
function findByEmail(email) {
    const e = _normEmail(email);
    if (!e) return null;
    return _stmtFindByEmail.get(e) || null;
}

function countAll() {
    return _stmtCount.get().n;
}

function countActiveAdmins() {
    return _stmtCountAdmins.get().n;
}

function listAll() {
    return _stmtList.all();
}

async function createUser({ email, password, role = 'user', imapEmail = null, active = true }) {
    const e = _normEmail(email);
    if (!_isValidEmail(e)) throw new Error('Geçersiz e-posta adresi.');
    if (!password || password.length < 6) throw new Error('Şifre en az 6 karakter olmalıdır.');
    if (!['admin', 'user'].includes(role)) throw new Error('Geçersiz rol.');

    const imap = role === 'user' ? _normEmail(imapEmail) : null;
    if (role === 'user' && !_isValidEmail(imap)) {
        throw new Error('Müşteri kullanıcısı için geçerli bir IMAP e-postası gerekli.');
    }

    if (findByEmail(e)) throw new Error('Bu e-posta zaten kayıtlı.');

    const hash = await bcrypt.hash(String(password), 10);
    _stmtInsert.run(e, hash, role, imap, active ? 1 : 0);
    return findByEmail(e);
}

async function setPassword(email, newPassword) {
    const e = _normEmail(email);
    if (!findByEmail(e)) throw new Error('Kullanıcı bulunamadı.');
    if (!newPassword || newPassword.length < 6) throw new Error('Şifre en az 6 karakter olmalıdır.');
    const hash = await bcrypt.hash(String(newPassword), 10);
    _stmtUpdatePwd.run(hash, e);
}

function setRole(email, role, imapEmail = null) {
    const e = _normEmail(email);
    const user = findByEmail(e);
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    if (!['admin', 'user'].includes(role)) throw new Error('Geçersiz rol.');
    const imap = role === 'user' ? _normEmail(imapEmail) : null;
    if (role === 'user' && !_isValidEmail(imap)) {
        throw new Error('Müşteri kullanıcısı için geçerli bir IMAP e-postası gerekli.');
    }

    // Son admin'i user'a düşürmeyi engelle
    if (user.role === 'admin' && role !== 'admin' && countActiveAdmins() <= 1) {
        throw new Error('En az bir aktif admin olmalı — son admin\'i düşüremezsiniz.');
    }
    _stmtUpdateRole.run(role, imap, e);
}

function setActive(email, active) {
    const e = _normEmail(email);
    const user = findByEmail(e);
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    // Son aktif admin'i pasifleştirmeyi engelle
    if (user.role === 'admin' && !active && countActiveAdmins() <= 1) {
        throw new Error('En az bir aktif admin olmalı — son admin\'i pasifleştiremezsiniz.');
    }
    _stmtUpdateActive.run(active ? 1 : 0, e);
}

function setImapEmail(email, imapEmail) {
    const e = _normEmail(email);
    const user = findByEmail(e);
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    if (user.role !== 'user') throw new Error('IMAP atama yalnızca user rolünde.');
    if (!_isValidEmail(imapEmail)) throw new Error('Geçersiz IMAP e-postası.');
    _stmtUpdateImap.run(_normEmail(imapEmail), e);
}

function deleteUser(email) {
    const e = _normEmail(email);
    const user = findByEmail(e);
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    if (user.role === 'admin' && countActiveAdmins() <= 1) {
        throw new Error('En az bir aktif admin olmalı — son admin\'i silemezsiniz.');
    }
    _stmtDelete.run(e);
}

function touchLogin(email) {
    _stmtTouchLogin.run(_normEmail(email));
}

async function verifyPassword(email, plain) {
    const u = findByEmail(email);
    if (!u || !u.active || !u.pwdHash) return null;
    const ok = await bcrypt.compare(String(plain || ''), u.pwdHash).catch(() => false);
    return ok ? u : null;
}

function isInitialized() {
    return countActiveAdmins() > 0;
}

// ─── Migration: eski settings.customerPassword → DB'ye admin olarak taşı ─────
async function migrateFromLegacySettings() {
    try {
        if (countAll() > 0) return; // zaten taşınmış / yeni kurulum

        const { loadSettings, saveSettings } = require('./settingsStore');
        const settings = loadSettings();
        const legacyHash = settings.customerPassword || '';
        if (!legacyHash) return;  // yedeklenmiş şifre yok

        const legacyEmail = String(process.env.MSA_RECOVERY_EMAIL || 'admin@local').trim().toLowerCase();
        if (!_isValidEmail(legacyEmail)) {
            console.warn('[CustomerUsers] Migration atlandı: MSA_RECOVERY_EMAIL geçersiz veya eksik.');
            return;
        }

        // Bcrypt hash mi düz metin mi?
        const isBcrypt = legacyHash.startsWith('$2b$') || legacyHash.startsWith('$2a$') || legacyHash.startsWith('$2y$');
        const pwdHash = isBcrypt ? legacyHash : await bcrypt.hash(String(legacyHash), 10);

        _stmtInsert.run(legacyEmail, pwdHash, 'admin', null, 1);
        console.log(`[CustomerUsers] Eski customerPassword admin olarak taşındı: ${legacyEmail}`);

        // settings.customerPassword'ü temizle (artık DB'de)
        saveSettings({ ...settings, customerPassword: '' });
    } catch (e) {
        console.error('[CustomerUsers] Migration hatası:', e.message);
    }
}

module.exports = {
    findByEmail,
    listAll,
    countAll,
    countActiveAdmins,
    createUser,
    setPassword,
    setRole,
    setActive,
    setImapEmail,
    deleteUser,
    touchLogin,
    verifyPassword,
    isInitialized,
    migrateFromLegacySettings,
    _normEmail,
    _isValidEmail
};
