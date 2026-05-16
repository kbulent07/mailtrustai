'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const { asyncH, env } = require('@mailtrustai/shared');
const { sha256 } = require('@mailtrustai/security');
const { db, audit } = require('../db');

const router = express.Router();

// Dealer authentication check — dealer portal kullanır.
// Public (no admin bearer); dealer kendi credential'ı ile doğrulanır.
router.post('/dealer/auth/verify', asyncH(async (req, res) => {
    const { dealerId, password } = req.body || {};
    if (!dealerId || !password) return res.status(400).json({ error: 'dealerId ve password gerekli' });

    const dealer = db.prepare('SELECT id, name, email, api_token_hash FROM dealers WHERE id=?').get(dealerId);
    if (!dealer || !dealer.api_token_hash) {
        audit(dealerId, 'dealer.auth.fail', null, { reason: 'no-record' });
        return res.status(401).json({ error: 'geçersiz kimlik' });
    }

    const ok = await bcrypt.compare(password, dealer.api_token_hash);
    if (!ok) {
        audit(dealerId, 'dealer.auth.fail', null, { reason: 'bad-password' });
        return res.status(401).json({ error: 'geçersiz kimlik' });
    }

    audit(dealerId, 'dealer.auth.ok', null, null);
    res.json({ ok: true, dealerId: dealer.id, name: dealer.name, email: dealer.email });
}));

module.exports = router;
