const db = require('./db');
const { v4: uuidv4 } = require('uuid');

// ─── SATIR → OBJEKSİ ─────────────────────────────────────
function rowToDealer(row) {
    if (!row) return null;
    return {
        code:          row.code,
        name:          row.name,
        contactPerson: row.contact_person,
        email:         row.email,
        pinHash:       row.pin_hash,
        discountPct:   row.discount_pct,
        customPrices:  JSON.parse(row.custom_prices || '{}'),
        whiteLabel:    JSON.parse(row.white_label || '{}'),
        active:        Boolean(row.active),
        credits:       row.credits,
        salesCount:    row.sales_count,
        lastSaleAt:    row.last_sale_at,
        createdAt:     row.created_at
    };
}

// ─── OKUMA ───────────────────────────────────────────────
const _all     = db.prepare('SELECT * FROM dealers ORDER BY created_at DESC');
const _byCode  = db.prepare('SELECT * FROM dealers WHERE code = ?');
const _byEmail = db.prepare('SELECT * FROM dealers WHERE lower(email) = lower(?) ORDER BY active DESC, created_at DESC');

function loadDealers() { return _all.all().map(rowToDealer); }
function findDealer(code) { return rowToDealer(_byCode.get(code)); }
function findDealerByEmail(email) { return rowToDealer(_byEmail.get(email)); }

// ─── YAZMA ───────────────────────────────────────────────
const _update = db.prepare(`
    UPDATE dealers SET
        name=?, contact_person=?, email=?, pin_hash=?,
        discount_pct=?, custom_prices=?, white_label=?, active=?
    WHERE code=?`);

const _insert = db.prepare(`
    INSERT INTO dealers
        (code, name, contact_person, email, pin_hash, discount_pct,
         custom_prices, white_label, active, credits, sales_count, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,0,?)`);

function upsertDealer(d) {
    const exists = db.prepare('SELECT 1 FROM dealers WHERE code=?').get(d.code);
    if (exists) {
        const current = findDealer(d.code);
        _update.run(d.name, d.contactPerson||'', d.email||'', d.pinHash,
            d.discountPct||0, JSON.stringify(d.customPrices||{}),
            JSON.stringify(d.whiteLabel !== undefined ? d.whiteLabel : (current?.whiteLabel || {})),
            d.active !== false ? 1 : 0, d.code);
    } else {
        _insert.run(d.code, d.name, d.contactPerson||'', d.email||'', d.pinHash,
            d.discountPct||0, JSON.stringify(d.customPrices||{}),
            JSON.stringify(d.whiteLabel||{}), d.active !== false ? 1 : 0, new Date().toISOString());
    }
    return findDealer(d.code);
}

function deleteDealer(code) {
    db.prepare('DELETE FROM dealers WHERE code=?').run(code);
}

function incrementSales(code) {
    db.prepare('UPDATE dealers SET sales_count=sales_count+1, last_sale_at=? WHERE code=?')
        .run(new Date().toISOString(), code);
}

function getCredits(code) {
    const row = db.prepare('SELECT credits FROM dealers WHERE code=?').get(code);
    return row ? row.credits : null;
}

function addCredits(code, amount) {
    db.prepare('UPDATE dealers SET credits=MAX(0,credits+?) WHERE code=?').run(amount, code);
    const row = db.prepare('SELECT credits FROM dealers WHERE code=?').get(code);
    return row ? row.credits : null;
}

function updateDealerPasswordHash(code, pinHash) {
    const result = db.prepare('UPDATE dealers SET pin_hash=? WHERE code=?').run(pinHash, code);
    return result.changes > 0 ? findDealer(code) : null;
}

// ─── ATOMİK LİSANS ÜRETİM İŞLEMİ ───────────────────────
// Tüm adımlar (bakiye kontrol, kredi kesme, satış kaydı, işlem logu,
// satış sayacı) tek bir SQLite transaction içinde çalışır.
// Herhangi bir adım başarısız olursa tümü geri alınır.
const _generateTx = db.transaction((params) => {
    const { dealerCode, plan, tier, duration, licenseKey, customerNote, creditCost, isFree } = params;

    const row = db.prepare('SELECT credits FROM dealers WHERE code=?').get(dealerCode);
    if (!row) throw Object.assign(new Error('Bayi bulunamadı'), { status: 404 });

    const currentCredits = row.credits;
    let newBalance = currentCredits;
    const now = new Date().toISOString();

    if (!isFree && creditCost > 0) {
        if (currentCredits < creditCost) {
            throw Object.assign(new Error('INSUFFICIENT_CREDITS'),
                { current: currentCredits, creditCost });
        }
        db.prepare('UPDATE dealers SET credits=credits-? WHERE code=?').run(creditCost, dealerCode);
        newBalance = db.prepare('SELECT credits FROM dealers WHERE code=?').get(dealerCode).credits;

        db.prepare(`INSERT INTO credit_transactions
            (id, dealer_code, type, amount, note, balance_after, created_at)
            VALUES (?,?,?,?,?,?,?)`)
            .run(uuidv4(), dealerCode, 'deduct', -creditCost,
                `Lisans: ${plan} ${tier} ${duration === 'Y' ? 'Yıllık' : 'Aylık'}`,
                newBalance, now);
    }

    const saleId = uuidv4();
    db.prepare(`INSERT INTO dealer_sales
        (id, dealer_code, plan, tier, duration, license_key, customer_note, credit_cost, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(saleId, dealerCode, plan, tier, duration, licenseKey, customerNote||'', creditCost, now);

    db.prepare('UPDATE dealers SET sales_count=sales_count+1, last_sale_at=? WHERE code=?')
        .run(now, dealerCode);

    return { saleId, newBalance, createdAt: now };
});

function generateLicenseTx(params) {
    return _generateTx(params);
}

function normalizeWhiteLabel(input = {}) {
    return {
        enabled: input.enabled === true || input.enabled === 'true',
        name: String(input.name || '').trim().slice(0, 120),
        details: String(input.details || '').trim().slice(0, 240),
        contactInfo: String(input.contactInfo || '').trim().slice(0, 500),
        accentColor: /^#[0-9a-f]{6}$/i.test(String(input.accentColor || ''))
            ? String(input.accentColor)
            : ''
    };
}

function updateDealerWhiteLabel(code, whiteLabel) {
    const normalized = normalizeWhiteLabel(whiteLabel);
    db.prepare('UPDATE dealers SET white_label=? WHERE code=?')
        .run(JSON.stringify(normalized), code);
    return findDealer(code)?.whiteLabel || normalized;
}

function getDealerWhiteLabel(code) {
    const dealer = findDealer(code);
    return dealer?.whiteLabel || {};
}

module.exports = {
    loadDealers, findDealer, upsertDealer, deleteDealer,
    findDealerByEmail,
    incrementSales, getCredits, addCredits, generateLicenseTx,
    updateDealerPasswordHash,
    updateDealerWhiteLabel, getDealerWhiteLabel, normalizeWhiteLabel
};
