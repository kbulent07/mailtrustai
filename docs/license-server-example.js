// ============================================================
// MERKEZİ LİSANS SUNUCUSU — Örnek Uygulama
// ============================================================
// NOT: Bu dosya tarihi referans — MailTrustAI ana sunucusu artik kendi
// icinde POST /api/license/check endpoint'ini sunuyor (license.routes.js).
// Merkezi keygen sunucusu: mailtrustai.com
//
// Bu ornek yalniz baska bir teknoloji ile (Python/Go/PHP) lisans sunucusu
// kurmak isteyenler icin protokol referansidir.
// ayrı bir Node.js servisi olarak çalıştırın.
//
// Müşteri sunucuları bu servise sorgu atar.
// Siz bu servis üzerinden lisansları iptal edebilirsiniz.
//
// Kurulum:
//   npm install express
//   node license-server-example.js
// ============================================================
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(express.json());

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'DEGISTIRIN_GUCLU_SIFRE';
const REVOKED_FILE = './central-revoked.json';
const LICENSE_SECRET = process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#';

// ─── Lisans format doğrulama (müşteri ile aynı mantık) ───
function verifyChecksum(key) {
    const parts = key.split('-');
    if (parts.length < 7 || parts[0] !== 'MSA') return false;
    const [prefix, plan, tier, duration, reseller, date, checksum] = parts;
    const payload = `${prefix}-${plan}-${tier}-${duration}-${reseller}-${date}`;
    const expected = crypto.createHmac('sha256', LICENSE_SECRET)
        .update(payload).digest('hex').substring(0, 8).toUpperCase();
    return checksum === expected;
}

function loadRevoked() {
    try {
        if (!fs.existsSync(REVOKED_FILE)) return [];
        return JSON.parse(fs.readFileSync(REVOKED_FILE, 'utf8'));
    } catch { return []; }
}

function saveRevoked(list) {
    fs.writeFileSync(REVOKED_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ─── Müşteri sunucusu bu endpoint'i sorgular ─────────────
app.post('/api/license/check', (req, res) => {
    const { key } = req.body;
    if (!key || typeof key !== 'string') {
        return res.status(400).json({ error: 'key required' });
    }

    // Lisans format kontrolü
    if (!verifyChecksum(key)) {
        return res.json({ valid: false, revokedAt: null });
    }

    // İptal kontrolü
    const revoked = loadRevoked();
    const entry = revoked.find(r => r.key === key);
    if (entry) {
        return res.json({ valid: false, revokedAt: entry.revokedAt });
    }

    res.json({ valid: true, revokedAt: null });
});

// ─── Admin: Lisans iptal ──────────────────────────────────
app.post('/api/admin/revoke', (req, res) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const { key, reason } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });

    const list = loadRevoked();
    if (!list.find(r => r.key === key)) {
        list.push({ key, revokedAt: new Date().toISOString(), reason: reason || '' });
        saveRevoked(list);
    }
    res.json({ success: true, key });
});

// ─── Admin: İptal kaldır ─────────────────────────────────
app.delete('/api/admin/revoke/:key', (req, res) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const key = req.params.key;
    const updated = loadRevoked().filter(r => r.key !== key);
    saveRevoked(updated);
    res.json({ success: true });
});

// ─── Admin: İptal listesi ─────────────────────────────────
app.get('/api/admin/revoked', (req, res) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(loadRevoked());
});

app.listen(process.env.PORT || 4000, () => {
    console.log('Merkezi lisans sunucusu çalışıyor...');
    console.log('Müşteri endpoint: POST /api/license/check');
    console.log('Admin revoke:     POST /api/admin/revoke  (x-admin-secret header gerekli)');
});
