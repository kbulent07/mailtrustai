'use strict';
// =============================================================
// AuditRepository — audit_log için scoped sorgular.
// Yazma yolu zaten db.audit() üzerinden gidiyor; burası okuma sorguları.
// =============================================================
const { all } = require('../db');

async function listAll({ limit = 500 } = {}) {
    return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
}

/**
 * Dealer'ın gördüğü audit kayıtları:
 *   - kendi (actor=dealerId) yazdığı kayıtlar
 *   - target'ı kendi lisansları olan kayıtlar
 *   - actor'ı kendi müşterileri olan kayıtlar
 */
async function listForDealer(dealerId, { limit = 500 } = {}) {
    return all(
        `SELECT a.* FROM audit_log a
         WHERE a.actor = ?
            OR a.target IN (SELECT id FROM licenses  WHERE dealer_id = ?)
            OR a.actor  IN (SELECT id FROM customers WHERE dealer_id = ?)
         ORDER BY a.id DESC
         LIMIT ?`,
        [dealerId, dealerId, dealerId, limit]
    );
}

module.exports = { listAll, listForDealer };
