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

function getDealerDetailedStats(dealerCode) {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const where = dealerCode ? 'WHERE dealer_code=?' : '';
    const params = dealerCode ? [dealerCode] : [];

    // Özet
    const summary = db.prepare(`
        SELECT COUNT(*) AS total,
            SUM(CASE WHEN substr(created_at,1,7)=? THEN 1 ELSE 0 END) AS this_month,
            SUM(CASE WHEN plan='PRO' THEN 1 ELSE 0 END) AS pro,
            SUM(CASE WHEN plan='ENT' THEN 1 ELSE 0 END) AS ent,
            COALESCE(SUM(credit_cost),0) AS total_credit,
            CASE WHEN COUNT(*)>0 THEN ROUND(CAST(COALESCE(SUM(credit_cost),0) AS REAL)/COUNT(*),1) ELSE 0 END AS avg_credit
        FROM dealer_sales ${where}`)
        .get(monthPrefix, ...params);

    // Son 6 ayın aylık trendi
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const monthlyTrend = months.map(m => {
        const r = db.prepare(
            `SELECT COUNT(*) AS cnt FROM dealer_sales WHERE substr(created_at,1,7)=? ${dealerCode ? 'AND dealer_code=?' : ''}`
        ).get(m, ...(dealerCode ? [dealerCode] : []));
        return { month: m, count: r.cnt || 0 };
    });

    // Tier dağılımı
    const tierRows = db.prepare(
        `SELECT tier, COUNT(*) AS cnt FROM dealer_sales ${where} GROUP BY tier ORDER BY tier`
    ).all(...params);
    const byTier = {};
    for (const r of tierRows) byTier[r.tier] = r.cnt;

    // Süre dağılımı
    const durRows = db.prepare(
        `SELECT duration, COUNT(*) AS cnt FROM dealer_sales ${where} GROUP BY duration`
    ).all(...params);
    const byDuration = {};
    for (const r of durRows) byDuration[r.duration] = r.cnt;

    // Son 30 günün günlük dağılımı
    const dailyRows = db.prepare(
        `SELECT substr(created_at,1,10) AS day, COUNT(*) AS cnt
         FROM dealer_sales
         WHERE created_at >= date('now','-29 days') ${dealerCode ? 'AND dealer_code=?' : ''}
         GROUP BY day ORDER BY day`
    ).all(...params);
    const dailyMap = {};
    for (const r of dailyRows) dailyMap[r.day] = r.cnt;
    const daily = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        daily.push({ day: key, count: dailyMap[key] || 0 });
    }

    return {
        total:          summary.total       || 0,
        thisMonth:      summary.this_month  || 0,
        byPlan:         { PRO: summary.pro || 0, ENT: summary.ent || 0 },
        totalCreditCost: summary.total_credit || 0,
        avgCreditCost:  summary.avg_credit  || 0,
        monthlyTrend,
        daily,
        byTier,
        byDuration
    };
}

module.exports = { recordSale, getSalesByDealer, getAllSales, getSalesStats, getDealerDetailedStats };
