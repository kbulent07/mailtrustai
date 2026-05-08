// ============================================================
// SCAN HISTORY STORAGE — SQLite backend
// API geriye uyumlu: loadScanHistory(), recordScan(), saveScanHistory()
// ============================================================
const fs = require('fs');
const path = require('path');
const db = require('./db');

const RETENTION_DAYS = 35;
const MAX_ITEMS = 1000;

// ─── Prepared statements ──────────────────────────────────
const _insert = db.prepare(`
    INSERT INTO scan_history
        (scan_id, timestamp, level, score, scan_source, from_email, subject, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const _selectRecent = db.prepare(`
    SELECT payload FROM scan_history
    WHERE timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT ?
`);

const _selectAll = db.prepare(`
    SELECT payload FROM scan_history
    ORDER BY timestamp DESC
    LIMIT ?
`);

const _deleteOld = db.prepare(`
    DELETE FROM scan_history WHERE timestamp < ?
`);

const _deleteOverLimit = db.prepare(`
    DELETE FROM scan_history
    WHERE id NOT IN (
        SELECT id FROM scan_history
        ORDER BY timestamp DESC
        LIMIT ?
    )
`);

// ─── Yardımcılar ──────────────────────────────────────────
function _normalizeEntry(entry = {}) {
    return {
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString()
    };
}

function _decode(row) {
    try { return JSON.parse(row.payload); }
    catch { return null; }
}

// ─── Genel API ────────────────────────────────────────────
function loadScanHistory() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = _selectRecent.all(cutoff, MAX_ITEMS);
    return rows.map(_decode).filter(Boolean);
}

function recordScan(entry) {
    const e = _normalizeEntry(entry);
    const fromEmail = (Array.isArray(e.emailMeta?.from) && e.emailMeta.from[0]?.address) || '';
    const subject   = e.emailMeta?.subject || '';

    _insert.run(
        e.id || null,
        e.timestamp,
        e.level || null,
        Number.isFinite(e.score) ? e.score : null,
        e.scanSource || null,
        fromEmail,
        subject,
        JSON.stringify(e)
    );

    // Periyodik temizlik (her 50 yazıdan sonra ~)
    if (Math.random() < 0.02) _prune();

    return loadScanHistory();
}

function saveScanHistory(history) {
    // Tam yeniden yazımı destekle (test/migration için)
    db.exec('DELETE FROM scan_history');
    const tx = db.transaction((items) => {
        for (const item of items) recordScan(item);
    });
    tx(Array.isArray(history) ? history : []);
}

function _prune() {
    try {
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        _deleteOld.run(cutoff);
        _deleteOverLimit.run(MAX_ITEMS);
    } catch (e) {
        console.error('[ScanHistory] prune error:', e.message);
    }
}

// ─── JSON → SQLite tek seferlik geçiş ─────────────────────
(function migrateFromJson() {
    try {
        const HISTORY_FILE = path.join(__dirname, '..', '..', 'data', 'scan-history.json');
        if (!fs.existsSync(HISTORY_FILE)) return;
        const existingCount = db.prepare('SELECT COUNT(*) AS n FROM scan_history').get().n;
        if (existingCount > 0) return; // Zaten geçmiş kayıtlar var; geçişi atla

        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return;

        const tx = db.transaction((items) => {
            for (const item of items) {
                const e = _normalizeEntry(item);
                const fromEmail = (Array.isArray(e.emailMeta?.from) && e.emailMeta.from[0]?.address) || '';
                const subject   = e.emailMeta?.subject || '';
                _insert.run(
                    e.id || null,
                    e.timestamp,
                    e.level || null,
                    Number.isFinite(e.score) ? e.score : null,
                    e.scanSource || null,
                    fromEmail, subject,
                    JSON.stringify(e)
                );
            }
        });
        tx(parsed);
        console.log(`[DB] Geçiş: ${parsed.length} tarama kaydı JSON'dan SQLite'a aktarıldı.`);

        // JSON dosyasını .bak olarak yeniden adlandır (silinmesi opsiyonel)
        try { fs.renameSync(HISTORY_FILE, HISTORY_FILE + '.bak'); } catch {}
    } catch (e) {
        console.error('[ScanHistory] migration error:', e.message);
    }
})();

module.exports = {
    loadScanHistory,
    recordScan,
    saveScanHistory
};
