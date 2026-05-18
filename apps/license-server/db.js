'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { env, envInt, logger } = require('@mailtrustai/shared');

const DB_CLIENT = String(env('LICENSE_DB_CLIENT') || (env('MARIADB_HOST') ? 'mariadb' : 'sqlite')).toLowerCase();
const DB_PATH = env('LICENSE_DB_PATH', path.join(env('DATA_DIR', './data'), 'license-server.sqlite'));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let db = null;
let pool = null;

function _sqliteMigrationFiles() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((file) => /^\d{4}_.+\.sql$/.test(file) && !file.endsWith('.mariadb.sql'))
        .sort();
}

function _mariaMigrationFiles() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((file) => /^\d{4}_.+\.mariadb\.sql$/.test(file))
        .sort();
}

function _migrationId(file) {
    return file.replace(/\.mariadb\.sql$/i, '.sql');
}

function _ensureSqliteDir() {
    try {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    } catch (_) {
        // ignore
    }
}

function _initSqlite() {
    _ensureSqliteDir();
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // WAL modunda eş zamanlı yazma çakışmalarını önlemek için busy_timeout.
    // SQLite varsayılanı 0ms (hemen hata) — 5 saniye bekleme toleransı ekle.
    db.pragma('busy_timeout = 5000');
    db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
    );`);

    if (!fs.existsSync(MIGRATIONS_DIR)) return;
    const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map((row) => row.id));
    for (const file of _sqliteMigrationFiles()) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        const tx = db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO _migrations(id, applied_at) VALUES(?,?)').run(file, Date.now());
        });
        tx();
        logger.info(`[license-server] sqlite migration uygulandı: ${file}`);
    }
    logger.info(`[license-server] SQLite DB hazır: ${DB_PATH}`);
}

async function _waitMaria() {
    const mysql = require('mysql2/promise');
    const retries = envInt('MARIADB_CONNECT_RETRIES', 20);
    const delayMs = envInt('MARIADB_CONNECT_DELAY_MS', 3000);

    // multipleStatements: havuzda KAPALI bırakılır (SQL injection riski).
    // Migration bağlantısı bu config'e multipleStatements:true ekleyerek
    // ayrı bir createConnection() ile oluşturulur; _applyMariaMigrations'a geçirilir.
    const config = {
        host: env('MARIADB_HOST', 'mariadb'),
        port: envInt('MARIADB_PORT', 3306),
        user: env('MARIADB_USER', 'mailtrustai'),
        password: env('MARIADB_PASSWORD', ''),
        database: env('MARIADB_DATABASE', 'mailtrustai_license'),
        charset: 'utf8mb4',
        waitForConnections: true,
        connectionLimit: envInt('MARIADB_POOL_SIZE', 10),
        queueLimit: 0
    };

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            pool = mysql.createPool(config);
            await pool.query('SELECT 1');
            logger.info(`[license-server] MariaDB bağlantısı hazır: ${config.host}:${config.port}/${config.database}`);
            return config;
        } catch (error) {
            if (pool) {
                try { await pool.end(); } catch (_) { /* ignore */ }
            }
            if (attempt === retries) throw error;
            logger.warn(`[license-server] MariaDB bekleniyor (${attempt}/${retries}): ${error.message}`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

// Migration'lar için multipleStatements:true olan AYRI bir bağlantı kullanılır.
// Havuz (pool) bunu desteklemez — her execute() çağrısında tek statement zorunlu.
async function _applyMariaMigrations(baseConfig) {
    const mysql = require('mysql2/promise');
    const migConn = await mysql.createConnection({ ...baseConfig, multipleStatements: true });
    try {
        await migConn.query(`CREATE TABLE IF NOT EXISTS _migrations (
            id VARCHAR(255) PRIMARY KEY,
            applied_at BIGINT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

        const [rows] = await migConn.query('SELECT id FROM _migrations');
        const applied = new Set(rows.map((row) => row.id));
        for (const file of _mariaMigrationFiles()) {
            const id = _migrationId(file);
            if (applied.has(id)) continue;
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            await migConn.beginTransaction();
            try {
                await migConn.query(sql);
                await migConn.execute('INSERT INTO _migrations(id, applied_at) VALUES(?, ?)', [id, Date.now()]);
                await migConn.commit();
                logger.info(`[license-server] mariadb migration uygulandı: ${file}`);
            } catch (error) {
                await migConn.rollback();
                throw error;
            }
        }
    } finally {
        try { await migConn.end(); } catch (_) { /* ignore */ }
    }
}

const ready = (async () => {
    if (DB_CLIENT === 'mariadb') {
        const baseConfig = await _waitMaria();
        await _applyMariaMigrations(baseConfig);
        db = pool;
        return;
    }

    _initSqlite();
})();

async function all(sql, params = []) {
    await ready;
    if (DB_CLIENT === 'mariadb') {
        const [rows] = await pool.execute(sql, params);
        return rows;
    }
    return db.prepare(sql).all(...params);
}

async function get(sql, params = []) {
    const rows = await all(sql, params);
    return rows[0] || null;
}

async function run(sql, params = []) {
    await ready;
    if (DB_CLIENT === 'mariadb') {
        const [result] = await pool.execute(sql, params);
        return result;
    }
    return db.prepare(sql).run(...params);
}

async function audit(actor, action, target, detail) {
    return run(
        'INSERT INTO audit_log(ts,actor,action,target,detail_json) VALUES(?,?,?,?,?)',
        [Date.now(), actor || null, action, target || null, detail ? JSON.stringify(detail) : null]
    );
}

module.exports = {
    DB_CLIENT,
    DB_PATH,
    ready,
    all,
    get,
    run,
    audit,
    isMaria: DB_CLIENT === 'mariadb'
};

// `db`/`pool` IIFE içinde set edildiği için sync export değeri null kalır.
// Getter ile her erişimde güncel referansı döndürüyoruz.
Object.defineProperty(module.exports, 'db',   { enumerable: true, get: () => db });
Object.defineProperty(module.exports, 'pool', { enumerable: true, get: () => pool });

