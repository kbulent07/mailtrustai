// ============================================================
// HTTP routes: Müşteri Kullanıcıları (Customer Users) CRUD
//
// Yetki:
//   Tüm bu endpoint'ler MÜŞTERİ ADMIN rolü gerektirir (requireCustomerAdmin).
//   - admin: API key, IMAP, webhook, ayarlar, kullanıcı yönetimi → her şey
//   - user : sadece kendi imap_email IMAP hesabını görür/manuel tarar
// ============================================================
const express = require('express');
const router = express.Router();

const _cuStore = require('../../../storage/customerUserStore');
const { requireCustomerAdmin } = require('../../../middleware/customerAuth');
const { recordAudit } = require('../../../storage/auditLog');

// Response sanitizer — pwdHash leak'i engelle
function _sanitize(u) {
    if (!u) return u;
    const { pwdHash, ...safe } = u;
    return safe;
}

// Tüm endpoint'lere admin guard
router.use('/customer-users', requireCustomerAdmin);

// GET — tüm kullanıcıları listele
router.get('/customer-users', (req, res) => {
    try {
        const users = _cuStore.listAll().map(_sanitize);
        res.json({ users });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST — yeni kullanıcı oluştur
router.post('/customer-users', async (req, res) => {
    try {
        const { email, password, role, imapEmail, active } = req.body || {};
        const user = await _cuStore.createUser({
            email,
            password,
            role:      role || 'user',
            imapEmail: role === 'admin' ? null : imapEmail,
            active:    active !== false
        });
        recordAudit({
            req, actorType: 'customer-admin', actorId: req.customerUser.email,
            action: 'customer-user.create',
            details: { email: user.email, role: user.role, imapEmail: user.imapEmail }
        });
        res.json({ success: true, user: _sanitize(user) });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// PATCH — kullanıcı güncelle (rol/imap/active/şifre)
router.patch('/customer-users/:email', async (req, res) => {
    try {
        const targetEmail = String(req.params.email || '').trim().toLowerCase();
        const target = _cuStore.findByEmail(targetEmail);
        if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

        const { password, role, imapEmail, active } = req.body || {};

        // Kendini düşürmeyi/silmeyi engelle (frontend de uyarsın)
        const isSelf = req.customerUser.email === targetEmail;

        if (password !== undefined && password !== '') {
            await _cuStore.setPassword(targetEmail, password);
        }
        if (role !== undefined) {
            if (isSelf && role !== 'admin') {
                return res.status(400).json({ error: 'Kendi rolünüzü düşüremezsiniz.' });
            }
            _cuStore.setRole(targetEmail, role, role === 'admin' ? null : imapEmail);
        } else if (imapEmail !== undefined && target.role === 'user') {
            _cuStore.setImapEmail(targetEmail, imapEmail);
        }
        if (active !== undefined) {
            if (isSelf && !active) {
                return res.status(400).json({ error: 'Kendi hesabınızı pasifleştiremezsiniz.' });
            }
            _cuStore.setActive(targetEmail, !!active);
        }

        const updated = _cuStore.findByEmail(targetEmail);
        recordAudit({
            req, actorType: 'customer-admin', actorId: req.customerUser.email,
            action: 'customer-user.update',
            details: { email: targetEmail, fields: Object.keys(req.body || {}) }
        });
        res.json({ success: true, user: _sanitize(updated) });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE — kullanıcı sil
router.delete('/customer-users/:email', (req, res) => {
    try {
        const targetEmail = String(req.params.email || '').trim().toLowerCase();
        if (req.customerUser.email === targetEmail) {
            return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz.' });
        }
        _cuStore.deleteUser(targetEmail);
        recordAudit({
            req, actorType: 'customer-admin', actorId: req.customerUser.email,
            action: 'customer-user.delete',
            details: { email: targetEmail }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;
