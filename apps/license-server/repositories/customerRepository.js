'use strict';
// =============================================================
// CustomerRepository — customers tablosu için tüm SQL erişimi.
// Route'lar artık SQL yazmaz; bu modülden çağırır. Dialect (sqlite/mariadb)
// farkları db.js içindeki upsert() helper'ına izole edildi.
// =============================================================
const { get, all, run, upsert } = require('../db');

// Genişletilmiş kayıt için INSERT/UPDATE'e dahil tüm kolonlar.
const UPSERT_COLS_FULL = [
    'id', 'dealer_id', 'company_name', 'email', 'created_at',
    'tax_office', 'tax_number', 'billing_address',
    'contact_name', 'contact_email', 'contact_phone',
    'address', 'phone'
];

// COALESCE ile korunan (UPDATE tarafında) kolonlar — id ve created_at hariç.
const UPSERT_COLS_UPDATE = UPSERT_COLS_FULL.filter((c) => c !== 'id' && c !== 'created_at');

// Sadeleştirilmiş upsert (license.create akışı): dealer_id + company_name + email.
const UPSERT_COLS_SLIM = ['id', 'dealer_id', 'company_name', 'email', 'created_at'];
const UPSERT_COLS_SLIM_UPDATE = ['dealer_id', 'company_name', 'email'];

/**
 * Genişletilmiş müşteri upsert: fatura/iletişim/adres alanları dahil.
 * Boş gelen alanlar COALESCE ile mevcut kayıttan korunur.
 */
async function upsertFull(record) {
    const row = {};
    for (const c of UPSERT_COLS_FULL) row[c] = record[c] !== undefined ? record[c] : null;
    if (!row.id) throw new Error('customerRepository.upsertFull: id zorunlu');
    if (!row.created_at) row.created_at = Date.now();
    return upsert('customers', row, { keys: ['id'], update: UPSERT_COLS_UPDATE });
}

/**
 * Sade upsert: license.create akışında dealer/company/email senkronu için.
 */
async function upsertSlim({ id, dealerId, companyName, email }) {
    if (!id) throw new Error('customerRepository.upsertSlim: id zorunlu');
    return upsert('customers',
        { id, dealer_id: dealerId || null, company_name: companyName || null, email: email || null, created_at: Date.now() },
        { keys: ['id'], update: UPSERT_COLS_SLIM_UPDATE });
}

async function findById(id) {
    return get('SELECT * FROM customers WHERE id = ?', [id]);
}

async function listByDealer(dealerId, { limit = 500 } = {}) {
    return all('SELECT * FROM customers WHERE dealer_id = ? ORDER BY created_at DESC LIMIT ?', [dealerId, limit]);
}

module.exports = {
    upsertFull,
    upsertSlim,
    findById,
    listByDealer
};
