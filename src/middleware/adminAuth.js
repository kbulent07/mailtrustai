const bcrypt = require('bcrypt');
const { loadSettings } = require('../storage/settingsStore');

// Supports both bcrypt-hashed passwords (new) and legacy plaintext passwords (migration).
async function requireAdminAuth(req, res, next) {
    const settings = loadSettings();
    const stored = settings.adminPassword || '';
    const provided = req.headers['x-admin-password'] || req.body?.adminPassword || '';

    if (!stored || !provided) {
        return res.status(403).json({ error: 'Admin authentication required' });
    }

    const isBcrypt = stored.startsWith('$2b$') || stored.startsWith('$2a$');
    const match = isBcrypt
        ? await bcrypt.compare(provided, stored)
        : provided === stored;

    if (!match) return res.status(403).json({ error: 'Admin authentication required' });
    next();
}

module.exports = { requireAdminAuth };
