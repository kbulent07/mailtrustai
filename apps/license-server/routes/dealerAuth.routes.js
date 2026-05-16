'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { asyncH } = require('@mailtrustai/shared');
const { get, audit } = require('../db');

const router = express.Router();

router.post('/dealer/auth/verify', asyncH(async (req, res) => {
    const { dealerId, password } = req.body || {};
    if (!dealerId || !password) return res.status(400).json({ error: 'dealerId ve password gerekli' });

    const dealer = await get('SELECT id, name, email, api_token_hash FROM dealers WHERE id=?', [dealerId]);
    if (!dealer || !dealer.api_token_hash) {
        await audit(dealerId, 'dealer.auth.fail', null, { reason: 'no-record' });
        return res.status(401).json({ error: 'geçersiz kimlik' });
    }

    const ok = await bcrypt.compare(password, dealer.api_token_hash);
    if (!ok) {
        await audit(dealerId, 'dealer.auth.fail', null, { reason: 'bad-password' });
        return res.status(401).json({ error: 'geçersiz kimlik' });
    }

    await audit(dealerId, 'dealer.auth.ok', null, null);
    res.json({ ok: true, dealerId: dealer.id, name: dealer.name, email: dealer.email });
}));

module.exports = router;
