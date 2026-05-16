'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { env, logger } = require('@mailtrustai/shared');

const DB_PATH = env('LICENSE_DB_PATH', path.join(env('DATA_DIR', './data'), 'license-server.sqlite'));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function _ensureDir() { try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch (_) {} }
_ensureDir();

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migration runner — numbered SQL files (0001_*.sql, 0002_*.sql).
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);`);

function _applyMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return;
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
    const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map(r => r.id));
    for (const f of files) {
        if (applied.has(f)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
        const tx = db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO _migrations(id, applied_at) VALUES(?,?)').run(f, Date.now());
        });
        tx();
        logger.info(`[license-server] migration uygulandı: ${f}`);
    }
}
_applyMigrations();

function audit(actor, action, target, detail) {
    db.prepare('INSERT INTO audit_log(ts,actor,action,target,detail_json) VALUES(?,?,?,?,?)')
      .run(Date.now(), actor || null, action, target || null, detail ? JSON.stringify(detail) : null);
}

logger.info(`[license-server] DB hazır: ${DB_PATH}`);

module.exports = { db, audit, DB_PATH };
