const db = require('./db');
const { v4: uuidv4 } = require('uuid');

function rowToSale(row) {
    return {
        id:           row.id,
        dealerCode:   row.dealer_code,
        plan:         row.plan,
        tier:         row.tier,
        duration:     row.duration,
        licenseKey:   row.license_key,
        customerNote: row.customer_note,
        creditCost:   row.credit_cost,
        createdAt:    row.created_at
    };
}

function recordSale({ dealerCode, plan, tier, duration, licenseKey, customerNote, creditCost }) {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO dealer_sales
        (id, dealer_code, plan, tier, duration, license_key, customer_note, credit_cost, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, dealerCode, plan, tier, duration, licenseKey, customerNote||'', creditCost||0, createdAt);
    return { id, dealerCode, plan, tier, duration, licenseKey, customerNote: customerNote||'', creditCost: creditCost||0, createdAt };
}

function getSalesByDealer(code, limit = 200) {
    return db.prepare('SELECT * FROM dealer_sales WHERE dealer_code=? ORDER BY created_at DESC LIMIT ?')
        .all(code, Math.min(limit, 500)).map(rowToSale);
}

function getAllSales(limit = 1000) {
    return db.prepare('SELECT * FROM dealer_sales ORDER BY created_at DESC LIMIT ?')
        .all(Math.min(limit, 5000)).map(rowToSale);
}

function getSalesStats(dealerCode) {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (dealerCode) {
        const row = db.prepare(`
            SELECT COUNT(*) AS total,
                SUM(CASE WHEN substr(created_at,1,7)=? THEN 1 ELSE 0 END) AS this_month,
                SUM(CASE WHEN plan='PRO' THEN 1 ELSE 0 END) AS pro,
                SUM(CASE WHEN plan='ENT' THEN 1 ELSE 0 END) AS ent
            FROM dealer_sales WHERE dealer_code=?`).get(monthPrefix, dealerCode);
        return { total: row.total||0, thisMonth: row.this_month||0,
                 byPlan: { PRO: row.pro||0, ENT: row.ent||0 } };
    }

    const row = db.prepare(`
        SELECT COUNT(*) AS total,
            SUM(CASE WHEN substr(created_at,1,7)=? THEN 1 ELSE 0 END) AS this_month,
            SUM(CASE WHEN plan='PRO' THEN 1 ELSE 0 END) AS pro,
            SUM(CASE WHEN plan='ENT' THEN 1 ELSE 0 END) AS ent
        FROM dealer_sales`).get(monthPrefix);
    return { total: row.total||0, thisMonth: row.this_month||0,
             byPlan: { PRO: row.pro||0, ENT: row.ent||0 } };
}

module.exports = { recordSale, getSalesByDealer, getAllSales, getSalesStats };
