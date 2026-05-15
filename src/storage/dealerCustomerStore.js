const db = require('./db');
const { v4: uuidv4 } = require('uuid');

function rowToCustomer(row) {
    return {
        id:         row.id,
        dealerCode: row.dealer_code,
        name:       row.name,
        email:      row.email,
        phone:      row.phone,
        company:    row.company,
        notes:      row.notes,
        createdAt:  row.created_at
    };
}

function addCustomer({ dealerCode, name, email = '', phone = '', company = '', notes = '' }) {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO dealer_customers (id, dealer_code, name, email, phone, company, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, dealerCode, name, email, phone, company, notes, createdAt);
    return { id, dealerCode, name, email, phone, company, notes, createdAt };
}

function updateCustomer(id, dealerCode, { name, email, phone, company, notes }) {
    const result = db.prepare(
        `UPDATE dealer_customers SET name=?, email=?, phone=?, company=?, notes=?
         WHERE id=? AND dealer_code=?`
    ).run(name, email ?? '', phone ?? '', company ?? '', notes ?? '', id, dealerCode);
    if (result.changes === 0) return null;
    return getCustomerById(id);
}

function deleteCustomer(id, dealerCode) {
    const result = db.prepare('DELETE FROM dealer_customers WHERE id=? AND dealer_code=?').run(id, dealerCode);
    return result.changes > 0;
}

function getCustomerById(id) {
    const row = db.prepare('SELECT * FROM dealer_customers WHERE id=?').get(id);
    return row ? rowToCustomer(row) : null;
}

function getCustomersByDealer(dealerCode, limit = 500) {
    const customers = db.prepare(
        'SELECT * FROM dealer_customers WHERE dealer_code=? ORDER BY created_at DESC LIMIT ?'
    ).all(dealerCode, Math.min(limit, 2000)).map(rowToCustomer);

    // Her müşterinin lisanslarını ekle
    return customers.map(c => {
        const sales = db.prepare(
            `SELECT id, plan, tier, duration, license_key, credit_cost, fingerprint, created_at
             FROM dealer_sales WHERE customer_id=? ORDER BY created_at DESC`
        ).all(c.id);
        return {
            ...c,
            sales: sales.map(s => ({
                id:         s.id,
                plan:       s.plan,
                tier:       s.tier,
                duration:   s.duration,
                licenseKey: s.license_key,
                creditCost: s.credit_cost,
                hasFingerprint: !!s.fingerprint,
                createdAt:  s.created_at
            }))
        };
    });
}

function getAllCustomers(limit = 2000) {
    const customers = db.prepare(
        `SELECT dc.*, d.name AS dealer_name
         FROM dealer_customers dc
         LEFT JOIN dealers d ON dc.dealer_code = d.code
         ORDER BY dc.created_at DESC LIMIT ?`
    ).all(Math.min(limit, 5000));

    return customers.map(row => {
        const c = {
            id:         row.id,
            dealerCode: row.dealer_code,
            dealerName: row.dealer_name || row.dealer_code,
            name:       row.name,
            email:      row.email,
            phone:      row.phone,
            company:    row.company,
            notes:      row.notes,
            createdAt:  row.created_at
        };
        const sales = db.prepare(
            `SELECT id, plan, tier, duration, license_key, credit_cost, fingerprint, created_at
             FROM dealer_sales WHERE customer_id=? ORDER BY created_at DESC`
        ).all(c.id);
        return {
            ...c,
            sales: sales.map(s => ({
                id:         s.id,
                plan:       s.plan,
                tier:       s.tier,
                duration:   s.duration,
                licenseKey: s.license_key,
                creditCost: s.credit_cost,
                hasFingerprint: !!s.fingerprint,
                createdAt:  s.created_at
            }))
        };
    });
}

module.exports = { addCustomer, updateCustomer, deleteCustomer, getCustomerById, getCustomersByDealer, getAllCustomers };
