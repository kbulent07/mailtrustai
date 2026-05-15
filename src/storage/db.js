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

// ─── SCAN HISTORY (e-posta tarama geçmişi) ──────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS scan_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id     TEXT,
        timestamp   TEXT NOT NULL,
        level       TEXT,
        score       INTEGER,
        scan_source TEXT,
        from_email  TEXT,
        subject     TEXT,
        payload     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_ts     ON scan_history(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_history_level  ON scan_history(level);
    CREATE INDEX IF NOT EXISTS idx_history_source ON scan_history(scan_source);
`);

// scan_history'e sonradan user_key kolonunu güvenli ekleme (migration)
(function ensureUserKeyColumn() {
    const cols = db.prepare(`PRAGMA table_info(scan_history)`).all();
    if (!cols.find(c => c.name === 'user_key')) {
        db.exec(`ALTER TABLE scan_history ADD COLUMN user_key TEXT`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_history_user ON scan_history(user_key)`);
        console.log('[DB] scan_history.user_key kolonu eklendi.');
    }
})();

// scan_history'e IMAP cache kolonları (imap_email + imap_uid)
// Aynı maile tıklandığında DB'den cache lookup için kullanılır.
(function ensureImapCacheColumns() {
    const cols = db.prepare(`PRAGMA table_info(scan_history)`).all();
    const names = new Set(cols.map(c => c.name));
    if (!names.has('imap_email') || !names.has('imap_uid')) {
        if (!names.has('imap_email')) db.exec(`ALTER TABLE scan_history ADD COLUMN imap_email TEXT`);
        if (!names.has('imap_uid'))   db.exec(`ALTER TABLE scan_history ADD COLUMN imap_uid TEXT`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_history_imap ON scan_history(imap_email, imap_uid)`);
        console.log('[DB] scan_history.imap_email + imap_uid kolonları eklendi (IMAP cache).');
    }
})();

// dealers tablosuna white_label kolonu ekleme (migration)
(function ensureWhiteLabelColumn() {
    const cols = db.prepare(`PRAGMA table_info(dealers)`).all();
    if (!cols.find(c => c.name === 'white_label')) {
        db.exec(`ALTER TABLE dealers ADD COLUMN white_label TEXT NOT NULL DEFAULT '{}'`);
        console.log('[DB] dealers.white_label kolonu eklendi.');
    }
})();

// ─── BAYİ MÜŞTERİLERİ ────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS dealer_customers (
        id          TEXT PRIMARY KEY,
        dealer_code TEXT NOT NULL REFERENCES dealers(code),
        name        TEXT NOT NULL,
        email       TEXT NOT NULL DEFAULT '',
        phone       TEXT NOT NULL DEFAULT '',
        company     TEXT NOT NULL DEFAULT '',
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dcust_dealer  ON dealer_customers(dealer_code);
    CREATE INDEX IF NOT EXISTS idx_dcust_created ON dealer_customers(created_at DESC);
`);

// dealer_sales: fingerprint + customer_id kolonları (migration)
(function ensureDealerSalesMigrations() {
    const cols = db.prepare(`PRAGMA table_info(dealer_sales)`).all();
    const names = new Set(cols.map(c => c.name));
    if (!names.has('fingerprint'))  db.exec(`ALTER TABLE dealer_sales ADD COLUMN fingerprint TEXT`);
    if (!names.has('customer_id'))  db.exec(`ALTER TABLE dealer_sales ADD COLUMN customer_id TEXT REFERENCES dealer_customers(id)`);
    if (names.has('fingerprint') || !names.has('customer_id')) {
        // sadece yeni eklendiyse log bas
    }
})();


// ─── MÜŞTERİ KULLANICILARI (admin + user rolleri) ────────
db.exec(`
    CREATE TABLE IF NOT EXISTS customer_users (
        email      TEXT PRIMARY KEY,
        pwd_hash   TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
        imap_email TEXT,                            -- yalnız 'user' rolünde dolu
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_login TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cuser_role ON customer_users(role);
    CREATE INDEX IF NOT EXISTS idx_cuser_imap ON customer_users(imap_email);
`);

// customer_users: şifre sıfırlama token kolonları (migration)
(function ensureResetTokenColumns() {
    const cols = db.prepare(`PRAGMA table_info(customer_users)`).all();
    const names = new Set(cols.map(c => c.name));
    if (!names.has('reset_token'))         db.exec(`ALTER TABLE customer_users ADD COLUMN reset_token TEXT`);
    if (!names.has('reset_token_expires')) db.exec(`ALTER TABLE customer_users ADD COLUMN reset_token_expires TEXT`);
})();

// ─── TEHDİT PATERNI VE MARKA DOMAIN TABLOLARI ────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS brand_domains (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        domain    TEXT NOT NULL UNIQUE,
        alias     TEXT NOT NULL,
        enabled   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS trusted_domains (
        domain     TEXT PRIMARY KEY,
        category   TEXT NOT NULL DEFAULT 'custom',  -- 'standard'|'tech'|'cloud'|'social'|'tr_service'|'finance'|'cdn'|'ai'|'custom'
        added_by   TEXT NOT NULL DEFAULT 'admin',   -- 'seed'|'admin'|'auto'
        note       TEXT NOT NULL DEFAULT '',
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trusted_enabled ON trusted_domains(enabled);
    CREATE INDEX IF NOT EXISTS idx_trusted_category ON trusted_domains(category);

    CREATE TABLE IF NOT EXISTS fp_suggestions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        domain          TEXT NOT NULL,
        finding_category TEXT NOT NULL DEFAULT '',
        finding_severity TEXT NOT NULL DEFAULT '',
        finding_message  TEXT NOT NULL DEFAULT '',
        scan_id         TEXT,
        reporter        TEXT NOT NULL DEFAULT '',
        report_count    INTEGER NOT NULL DEFAULT 1,
        status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'rejected'
        first_seen_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(domain, status)
    );
    CREATE INDEX IF NOT EXISTS idx_fp_status ON fp_suggestions(status, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS threat_patterns (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        category   TEXT NOT NULL,   -- 'urgency'|'credential'|'threat'|'reward'|'sextortion'|'bec_content'|'bec_subject'|'bec_body'
        pattern    TEXT NOT NULL,   -- RegExp source (flags ayrı saklanır)
        flags      TEXT NOT NULL DEFAULT 'i',
        lang       TEXT NOT NULL DEFAULT 'any',  -- 'tr'|'en'|'any'
        severity   TEXT NOT NULL DEFAULT 'warning',
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_patterns_category ON threat_patterns(category, enabled);
`);

// fp_suggestions tablosunu yeni şemaya güncelleme (migration)
(function ensureFpSuggestionsSchema() {
    const cols = db.prepare('PRAGMA table_info(fp_suggestions)').all();
    const colNames = new Set(cols.map(c => c.name));

    // Yeni şemada beklenen kolonlar (albattani branch)
    const toAdd = [
        ['finding_category', "TEXT NOT NULL DEFAULT ''"],
        ['finding_severity',  "TEXT NOT NULL DEFAULT ''"],
        ['finding_message',   "TEXT NOT NULL DEFAULT ''"],
        ['scan_id',           'TEXT'],
        ['reporter',          "TEXT NOT NULL DEFAULT ''"],
        ['first_seen_at',     "TEXT NOT NULL DEFAULT ''"],
        ['last_seen_at',      "TEXT NOT NULL DEFAULT ''"],
    ];
    let migrated = false;
    for (const [col, def] of toAdd) {
        if (!colNames.has(col)) {
            db.exec(`ALTER TABLE fp_suggestions ADD COLUMN ${col} ${def}`);
            migrated = true;
        }
    }
    if (migrated) {
        if (colNames.has('finding_msg') && !colNames.has('_migrated')) {
            db.exec(`UPDATE fp_suggestions SET finding_message = COALESCE(finding_msg, '') WHERE finding_message = ''`);
        }
        if (colNames.has('severity') && !colNames.has('finding_severity')) {
            db.exec(`UPDATE fp_suggestions SET finding_severity = COALESCE(severity, '') WHERE finding_severity = ''`);
        }
        if (colNames.has('reported_at')) {
            db.exec(`UPDATE fp_suggestions SET first_seen_at = COALESCE(reported_at, first_seen_at), last_seen_at = COALESCE(reported_at, last_seen_at) WHERE first_seen_at = ''`);
        }
        try { db.exec(`CREATE INDEX IF NOT EXISTS idx_fp_status ON fp_suggestions(status, last_seen_at DESC)`); } catch {}
        console.log('[DB] fp_suggestions şema migration tamamlandı.');
    }
})();

(function seedStaticData() {
    const brandCount = db.prepare('SELECT COUNT(*) AS n FROM brand_domains').get().n;
    if (brandCount === 0) {
        const ins = db.prepare('INSERT OR IGNORE INTO brand_domains (domain, alias) VALUES (?, ?)');
        const brands = [
            ['paypal.com','paypal'],['amazon.com','amazon'],['microsoft.com','microsoft'],
            ['apple.com','apple'],['google.com','google'],['netflix.com','netflix'],
            ['facebook.com','facebook'],['instagram.com','instagram'],['twitter.com','twitter'],
            ['linkedin.com','linkedin'],['dropbox.com','dropbox'],['ebay.com','ebay'],
            ['fedex.com','fedex'],['dhl.com','dhl'],['ups.com','ups'],
            ['turkiye.gov.tr','turkiye'],['gib.gov.tr','gib'],['sgk.gov.tr','sgk'],
            ['ziraatbank.com.tr','ziraat'],['isbank.com.tr','isbank'],['garantibbva.com.tr','garanti'],
            ['akbank.com','akbank'],['yapikredi.com.tr','yapikredi'],['halkbank.com.tr','halkbank'],
            ['vakifbank.com.tr','vakifbank'],['pttsepet.com','ptt'],['ptt.gov.tr','ptt'],
            ['trendyol.com','trendyol'],['hepsiburada.com','hepsiburada'],['n11.com','n11'],
            ['vodafone.com.tr','vodafone'],['turkcell.com.tr','turkcell'],['turktelekom.com.tr','turktelekom']
        ];
        db.transaction(() => { for (const [d, a] of brands) ins.run(d, a); })();
        console.log(`[DB] ${brands.length} marka domain seed edildi.`);
    }

    // Trusted domains (OTX whitelist) — kategori başına seed
    const trustedCount = db.prepare('SELECT COUNT(*) AS n FROM trusted_domains').get().n;
    if (trustedCount === 0) {
        const ins = db.prepare('INSERT OR IGNORE INTO trusted_domains (domain, category, added_by, note) VALUES (?, ?, ?, ?)');
        const seed = [
            // Google ekosistemi
            ['google.com','tech'],['gmail.com','tech'],['googlemail.com','tech'],
            ['youtube.com','tech'],['youtu.be','tech'],['google.com.tr','tech'],
            ['googleusercontent.com','cdn'],['gstatic.com','cdn'],['doubleclick.net','cdn'],
            ['googletagmanager.com','cdn'],['google-analytics.com','cdn'],
            // Microsoft
            ['microsoft.com','tech'],['office.com','tech'],['office365.com','tech'],
            ['outlook.com','tech'],['live.com','tech'],['hotmail.com','tech'],['msn.com','tech'],
            ['bing.com','tech'],['sharepoint.com','tech'],['onedrive.live.com','tech'],
            ['azure.com','cloud'],['azureedge.net','cloud'],['windows.net','cloud'],
            ['microsoftonline.com','cloud'],['teams.microsoft.com','tech'],
            // Apple
            ['apple.com','tech'],['icloud.com','tech'],['me.com','tech'],['mac.com','tech'],
            // Sosyal medya
            ['facebook.com','social'],['fb.com','social'],['fbcdn.net','cdn'],
            ['instagram.com','social'],['whatsapp.com','social'],['messenger.com','social'],
            ['twitter.com','social'],['x.com','social'],['twimg.com','cdn'],
            ['linkedin.com','social'],['licdn.com','cdn'],['tiktok.com','social'],
            ['snapchat.com','social'],['pinterest.com','social'],['reddit.com','social'],
            ['discord.com','social'],['discordapp.com','social'],
            ['telegram.org','social'],['t.me','social'],
            // Bulut / dev
            ['amazon.com','cloud'],['amazonaws.com','cloud'],['cloudfront.net','cdn'],
            ['github.com','cloud'],['githubusercontent.com','cdn'],['gitlab.com','cloud'],
            ['bitbucket.org','cloud'],['cloudflare.com','cloud'],['dropbox.com','cloud'],
            ['box.com','cloud'],['wetransfer.com','cloud'],
            ['zoom.us','tech'],['webex.com','tech'],
            // E-ticaret / ödeme
            ['paypal.com','finance'],['stripe.com','finance'],['shopify.com','tech'],
            ['wix.com','tech'],['wordpress.com','tech'],
            ['godaddy.com','tech'],['namecheap.com','tech'],
            // Türkiye servisleri
            ['yandex.com','tech'],['yandex.com.tr','tech'],['yandex.ru','tech'],
            ['turkiye.gov.tr','tr_service'],['gib.gov.tr','tr_service'],['sgk.gov.tr','tr_service'],
            ['pttsepet.com','tr_service'],['ptt.gov.tr','tr_service'],
            ['trendyol.com','tr_service'],['hepsiburada.com','tr_service'],['n11.com','tr_service'],
            ['gittigidiyor.com','tr_service'],['sahibinden.com','tr_service'],['arabam.com','tr_service'],
            ['turkcell.com.tr','tr_service'],['turktelekom.com.tr','tr_service'],['vodafone.com.tr','tr_service'],
            ['ziraatbank.com.tr','finance'],['isbank.com.tr','finance'],['garantibbva.com.tr','finance'],
            ['akbank.com','finance'],['yapikredi.com.tr','finance'],['halkbank.com.tr','finance'],
            ['vakifbank.com.tr','finance'],
            // CDN / popüler
            ['wikipedia.org','tech'],['wikimedia.org','cdn'],['mozilla.org','tech'],['firefox.com','tech'],
            ['adobe.com','tech'],['salesforce.com','tech'],
            ['jsdelivr.net','cdn'],['unpkg.com','cdn'],['jquery.com','cdn'],['fontawesome.com','cdn'],
            ['mailchimp.com','cdn'],['sendgrid.net','cdn'],['mailgun.org','cdn'],['sendpulse.com','cdn'],
            // Standart/namespace URI'ları
            ['w3.org','standard'],['ietf.org','standard'],['iana.org','standard'],
            ['rfc-editor.org','standard'],['schema.org','standard'],
            ['json-schema.org','standard'],['opensearch.org','standard'],
            // AI
            ['anthropic.com','ai'],['claude.ai','ai'],['openai.com','ai'],
            ['chatgpt.com','ai'],['huggingface.co','ai']
        ];
        db.transaction(() => { for (const [d, cat] of seed) ins.run(d, cat, 'seed', ''); })();
        console.log(`[DB] ${seed.length} trusted domain seed edildi.`);
    }

    const patternCount = db.prepare('SELECT COUNT(*) AS n FROM threat_patterns').get().n;
    if (patternCount === 0) {
        const ins = db.prepare(
            'INSERT INTO threat_patterns (category, pattern, flags, lang, severity) VALUES (?,?,?,?,?)'
        );
        const patterns = [
            // Türkçe aciliyet
            ['urgency', 'hemen\\s+işlem', 'i', 'tr', 'warning'],
            ['urgency', 'acil', 'i', 'tr', 'warning'],
            ['urgency', 'derhal', 'i', 'tr', 'warning'],
            ['urgency', 'son\\s+şans', 'i', 'tr', 'warning'],
            ['urgency', 'süreniz\\s+dol', 'i', 'tr', 'warning'],
            ['urgency', 'hesabınız\\s+(askıya|kapatıl)', 'i', 'tr', 'warning'],
            ['urgency', 'şifrenizi\\s+değiştir', 'i', 'tr', 'warning'],
            ['urgency', 'güncelle', 'i', 'tr', 'warning'],
            ['urgency', 'doğrula', 'i', 'tr', 'warning'],
            ['urgency', '24\\s*saat', 'i', 'tr', 'warning'],
            ['urgency', '48\\s*saat', 'i', 'tr', 'warning'],
            ['urgency', 'sınırlı\\s+süre', 'i', 'tr', 'warning'],
            // İngilizce aciliyet
            ['urgency', 'immediate\\s+action', 'i', 'en', 'warning'],
            ['urgency', 'urgent', 'i', 'en', 'warning'],
            ['urgency', 'act\\s+now', 'i', 'en', 'warning'],
            ['urgency', 'expires?\\s+soon', 'i', 'en', 'warning'],
            ['urgency', 'account\\s+(suspend|clos|deactivat|restrict)', 'i', 'en', 'warning'],
            ['urgency', 'verify\\s+your', 'i', 'en', 'warning'],
            ['urgency', 'confirm\\s+your\\s+(identity|account|payment)', 'i', 'en', 'warning'],
            ['urgency', 'last\\s+chance', 'i', 'en', 'warning'],
            ['urgency', 'within\\s+\\d+\\s*hours?', 'i', 'en', 'warning'],
            ['urgency', 'limited\\s+time', 'i', 'en', 'warning'],
            ['urgency', 'failure\\s+to', 'i', 'en', 'warning'],
            // Kimlik bilgisi
            ['credential', 'password', 'i', 'en', 'critical'],
            ['credential', 'şifre', 'i', 'tr', 'critical'],
            ['credential', 'parola', 'i', 'tr', 'critical'],
            ['credential', 'credit\\s*card', 'i', 'en', 'critical'],
            ['credential', 'kredi\\s*kart', 'i', 'tr', 'critical'],
            ['credential', 'social\\s*security', 'i', 'en', 'critical'],
            ['credential', 'ssn', 'i', 'en', 'critical'],
            ['credential', 'tc\\s*kimlik', 'i', 'tr', 'critical'],
            ['credential', 'bank\\s*account', 'i', 'en', 'critical'],
            ['credential', 'banka\\s*hesab', 'i', 'tr', 'critical'],
            ['credential', 'pin\\s*(code|kodu)', 'i', 'any', 'critical'],
            ['credential', 'cvv', 'i', 'any', 'critical'],
            ['credential', 'expire?\\s*date', 'i', 'en', 'critical'],
            ['credential', 'son\\s*kullanma', 'i', 'tr', 'critical'],
            // Tehdit
            ['threat', 'legal\\s*action', 'i', 'en', 'warning'],
            ['threat', 'yasal\\s*işlem', 'i', 'tr', 'warning'],
            ['threat', 'law\\s*enforcement', 'i', 'en', 'warning'],
            ['threat', 'police', 'i', 'en', 'warning'],
            ['threat', 'polis', 'i', 'tr', 'warning'],
            ['threat', 'mahkeme', 'i', 'tr', 'warning'],
            ['threat', 'court', 'i', 'en', 'warning'],
            ['threat', 'arrest', 'i', 'en', 'warning'],
            ['threat', 'fine\\s*of', 'i', 'en', 'warning'],
            ['threat', 'ceza', 'i', 'tr', 'warning'],
            ['threat', 'dava', 'i', 'tr', 'warning'],
            // Ödül / dolandırıcılık
            ['reward', 'congratulations', 'i', 'en', 'warning'],
            ['reward', 'tebrikler', 'i', 'tr', 'warning'],
            ['reward', 'you\\s*(have\\s+)?won', 'i', 'en', 'warning'],
            ['reward', 'kazandınız', 'i', 'tr', 'warning'],
            ['reward', 'prize', 'i', 'en', 'warning'],
            ['reward', 'ödül', 'i', 'tr', 'warning'],
            ['reward', 'lottery', 'i', 'en', 'warning'],
            ['reward', 'piyango', 'i', 'tr', 'warning'],
            ['reward', 'million\\s*dollar', 'i', 'en', 'warning'],
            ['reward', 'free\\s*gift', 'i', 'en', 'warning'],
            ['reward', 'hediye', 'i', 'tr', 'warning'],
            ['reward', 'inheritance', 'i', 'en', 'warning'],
            ['reward', 'miras', 'i', 'tr', 'warning'],
            // Sextortion TR
            ['sextortion', 'şifren[ei]\\s+(ele\\s+geçir|çaldım|bildim)', 'i', 'tr', 'critical'],
            ['sextortion', 'kamera\\s*(kaydın[ıi]|görüntün[üu])', 'i', 'tr', 'critical'],
            ['sextortion', 'bitcoin\\s*(gönder|öde|transfer)', 'i', 'tr', 'critical'],
            ['sextortion', 'web\\s*kameras[ıi]', 'i', 'tr', 'critical'],
            ['sextortion', 'müstehcen\\s*(video|görüntü)', 'i', 'tr', 'critical'],
            ['sextortion', '\\d+\\s*bitcoin\\s*gönder', 'i', 'tr', 'critical'],
            // Sextortion EN
            ['sextortion', 'i\\s+have\\s+(hacked|access\\s+to)\\s+your', 'i', 'en', 'critical'],
            ['sextortion', 'your\\s+password\\s+is', 'i', 'en', 'critical'],
            ['sextortion', 'i\\s+recorded\\s+you', 'i', 'en', 'critical'],
            ['sextortion', 'your\\s+webcam\\s+(was\\s+)?(hacked|activated)', 'i', 'en', 'critical'],
            ['sextortion', 'send\\s+\\d+\\s*bitcoin', 'i', 'en', 'critical'],
            ['sextortion', 'malware\\s*(installed|on\\s+your)', 'i', 'en', 'critical'],
            ['sextortion', 'adult\\s*(content|website|video)', 'i', 'en', 'critical'],
            // BEC içerik
            ['bec_content', '\\biban\\b.*değiş', 'i', 'tr', 'critical'],
            ['bec_content', '\\biban\\b.*update', 'i', 'en', 'critical'],
            ['bec_content', '\\biban\\b.*new\\b', 'i', 'en', 'critical'],
            ['bec_content', 'hesap\\s*numarası.*değiş', 'i', 'tr', 'critical'],
            ['bec_content', 'account.*number.*change', 'i', 'en', 'critical'],
            ['bec_content', 'yeni\\s*banka\\s*bilgi', 'i', 'tr', 'critical'],
            ['bec_content', 'new\\s*bank\\s*(detail|account)', 'i', 'en', 'critical'],
            ['bec_content', 'ödemeyi?\\s+.*bu\\s+hesab', 'i', 'tr', 'critical'],
            ['bec_content', 'payment.*this\\s+(account|iban)', 'i', 'en', 'critical'],
            ['bec_content', 'tedarikçi.*hesab.*değiş', 'i', 'tr', 'critical'],
            ['bec_content', 'vendor.*account.*change', 'i', 'en', 'critical'],
            // BEC konu
            ['bec_subject', '\\b(CEO|CFO|COO|CTO|genel\\s*müdür|yönetim\\s*kurulu|direktör)\\b', 'i', 'any', 'warning'],
            ['bec_subject', '\\bacil\\s*(havale|ödeme|transfer)\\b', 'i', 'tr', 'warning'],
            ['bec_subject', '\\b(wire\\s*transfer|bank\\s*transfer|swift)\\b', 'i', 'en', 'warning'],
            ['bec_subject', '\\b(fatura|invoice)\\s*(değişikliği|güncelleme|update|change)\\b', 'i', 'any', 'warning'],
            ['bec_subject', '\\b(tedarikçi|vendor|supplier)\\s*(hesap|account)\\s*(değişikliği|change|update)\\b', 'i', 'any', 'warning'],
            // BEC gövde
            ['bec_body', '\\b(banka\\s*hesabı|hesap\\s*numarası|iban)\\s*(değişti|değişiyor|güncellendi)\\b', 'i', 'tr', 'warning'],
            ['bec_body', '\\b(bank\\s*account|account\\s*number)\\s*(has\\s*)?(changed|updated)\\b', 'i', 'en', 'warning'],
            ['bec_body', '\\b(lütfen|please)\\s+.{0,30}\\s*(havale|transfer|gönder|send)\\b', 'i', 'any', 'warning'],
            ['bec_body', '\\b(gizli\\s*tut|confidential|strictly\\s*private)\\b', 'i', 'any', 'warning'],
            ['bec_body', '\\b(bu\\s*işlemi|this\\s*transaction)\\s+.{0,20}\\s*(kimseye|nobody|anyone)\\b', 'i', 'any', 'warning']
        ];
        db.transaction(() => {
            for (const [cat, pat, flags, lang, sev] of patterns) {
                ins.run(cat, pat, flags, lang, sev);
            }
        })();
        console.log(`[DB] ${patterns.length} tehdit kalıbı seed edildi.`);
    }
})();

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
