// ============================================================
// SQLite veritabanı — tek bağlantı noktası (singleton)
// WAL modu: okumalar yazmaları bloklamaz; yazma işlemleri
// SQLite tarafından serileştirilir — race condition olmaz.
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'msa.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL'); // WAL ile güvenli, tam sync'den daha hızlı

// ─── ŞEMA ───────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS dealers (
        code         TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        contact_person TEXT NOT NULL DEFAULT '',
        email        TEXT NOT NULL DEFAULT '',
        pin_hash     TEXT NOT NULL,
        discount_pct INTEGER NOT NULL DEFAULT 0,
        custom_prices TEXT NOT NULL DEFAULT '{}',
        active       INTEGER NOT NULL DEFAULT 1,
        credits      INTEGER NOT NULL DEFAULT 0,
        sales_count  INTEGER NOT NULL DEFAULT 0,
        last_sale_at TEXT,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS dealer_sales (
        id            TEXT PRIMARY KEY,
        dealer_code   TEXT NOT NULL REFERENCES dealers(code),
        plan          TEXT NOT NULL,
        tier          TEXT NOT NULL,
        duration      TEXT NOT NULL,
        license_key   TEXT NOT NULL,
        customer_note TEXT NOT NULL DEFAULT '',
        credit_cost   INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_dealer  ON dealer_sales(dealer_code);
    CREATE INDEX IF NOT EXISTS idx_sales_created ON dealer_sales(created_at DESC);

    CREATE TABLE IF NOT EXISTS credit_transactions (
        id           TEXT PRIMARY KEY,
        dealer_code  TEXT NOT NULL REFERENCES dealers(code),
        type         TEXT NOT NULL,
        amount       INTEGER NOT NULL,
        note         TEXT NOT NULL DEFAULT '',
        balance_after INTEGER NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tx_dealer  ON credit_transactions(dealer_code);
    CREATE INDEX IF NOT EXISTS idx_tx_created ON credit_transactions(created_at DESC);
`);

// ─── JSON → SQLite TEK SEFERLİK GEÇİŞ ──────────────────
(function migrateFromJson() {
    const counts = {
        dealers: db.prepare('SELECT COUNT(*) AS n FROM dealers').get().n,
        sales:   db.prepare('SELECT COUNT(*) AS n FROM dealer_sales').get().n,
        txs:     db.prepare('SELECT COUNT(*) AS n FROM credit_transactions').get().n,
    };

    function readJson(filename) {
        const file = path.join(DATA_DIR, filename);
        if (!fs.existsSync(file)) return [];
        try { return JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch { return []; }
    }

    if (counts.dealers === 0) {
        const dealers = readJson('dealers.json');
        if (dealers.length) {
            const ins = db.prepare(`INSERT OR IGNORE INTO dealers
                (code, name, contact_person, email, pin_hash, discount_pct,
                 custom_prices, active, credits, sales_count, last_sale_at, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
            db.transaction(() => {
                for (const d of dealers) ins.run(
                    d.code, d.name, d.contactPerson||'', d.email||'',
                    d.pinHash, d.discountPct||0, JSON.stringify(d.customPrices||{}),
                    d.active ? 1 : 0, d.credits||0, d.salesCount||0,
                    d.lastSaleAt||null, d.createdAt||new Date().toISOString()
                );
            })();
            console.log(`[DB] Geçiş: ${dealers.length} bayi JSON'dan aktarıldı.`);
        }
    }

    if (counts.sales === 0) {
        const sales = readJson('dealer-sales.json');
        if (sales.length) {
            const ins = db.prepare(`INSERT OR IGNORE INTO dealer_sales
                (id, dealer_code, plan, tier, duration, license_key, customer_note, credit_cost, created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`);
            db.transaction(() => {
                for (const s of sales) {
                    // FK constraint: sadece bilinen bayi kodları için ekle
                    const exists = db.prepare('SELECT 1 FROM dealers WHERE code=?').get(s.dealerCode);
                    if (exists) ins.run(s.id, s.dealerCode, s.plan, s.tier, s.duration,
                        s.licenseKey, s.customerNote||'', s.creditCost||0,
                        s.createdAt||new Date().toISOString());
                }
            })();
            console.log(`[DB] Geçiş: ${sales.length} satış JSON'dan aktarıldı.`);
        }
    }

    if (counts.txs === 0) {
        const txs = readJson('credit-transactions.json');
        if (txs.length) {
            const ins = db.prepare(`INSERT OR IGNORE INTO credit_transactions
                (id, dealer_code, type, amount, note, balance_after, created_at)
                VALUES (?,?,?,?,?,?,?)`);
            db.transaction(() => {
                for (const t of txs) {
                    const exists = db.prepare('SELECT 1 FROM dealers WHERE code=?').get(t.dealerCode);
                    if (exists) ins.run(t.id, t.dealerCode, t.type,
                        t.amount, t.note||'', t.balanceAfter,
                        t.createdAt||new Date().toISOString());
                }
            })();
            console.log(`[DB] Geçiş: ${txs.length} kredi işlemi JSON'dan aktarıldı.`);
        }
    }
})();

module.exports = db;
