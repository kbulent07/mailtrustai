'use strict';
// =============================================================
// LicenseRepository — licenses tablosu için tüm SQL erişimi.
// =============================================================
const { get, all, run } = require('../db');

async function findByKeyHash(keyHash) {
    return get('SELECT * FROM licenses WHERE license_key_hash = ?', [keyHash]);
}

async function findById(id) {
    return get('SELECT * FROM licenses WHERE id = ?', [id]);
}

async function listByCustomerAndDealer(customerId, dealerId) {
    return all(
        'SELECT id, plan, tier, status, issued_at, expires_at FROM licenses WHERE customer_id=? AND dealer_id=?',
        [customerId, dealerId]
    );
}

async function insertLicense(record) {
    const cols = [
        'id', 'customer_id', 'dealer_id', 'license_key_hash', 'license_key_masked',
        'plan', 'tier', 'status', 'issued_at', 'expires_at', 'grace_days',
        'features_json', 'limits_json', 'label'
    ];
    const placeholders = cols.map(() => '?').join(',');
    const values = cols.map((c) => record[c] === undefined ? null : record[c]);
    return run(
        `INSERT INTO licenses(${cols.join(',')}) VALUES(${placeholders})`,
        values
    );
}

async function setStatus(id, status) {
    return run('UPDATE licenses SET status=? WHERE id=?', [status, id]);
}

async function extendExpiry(id, expiresAt) {
    return run('UPDATE licenses SET expires_at=?, status=? WHERE id=?', [expiresAt, 'active', id]);
}

async function addExtraScans(id, amount) {
    return run('UPDATE licenses SET extra_scans = extra_scans + ? WHERE id = ?', [amount, id]);
}

module.exports = {
    findByKeyHash,
    findById,
    listByCustomerAndDealer,
    insertLicense,
    setStatus,
    extendExpiry,
    addExtraScans
};
