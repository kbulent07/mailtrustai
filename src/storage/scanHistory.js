// ============================================================
// SCAN HISTORY STORAGE — SQLite backend
// API geriye uyumlu: loadScanHistory(), recordScan(), saveScanHistory()
// Ayrıca: getDetailedStats({ days }) — kim/kaynak/seviye/saat dağılımı
// ============================================================
const fs = require('fs');
const path = require('path');
const db = require('./db');

const RETENTION_DAYS = 35;
const MAX_ITEMS = 1000;

// ─── Prepared statements ──────────────────────────────────
const _insert = db.prepare(`
    INSERT INTO scan_history
        (scan_id, timestamp, level, score, scan_source, from_email, subject, user_key, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const _selectRecent = db.prepare(`
    SELECT payload FROM scan_history
    WHERE timestamp >= ?
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

// ─── user_key türetme ────────────────────────────────────
// "Kim taradı?" sorusuna cevap için kararlı bir gruplayıcı.
//  · scan-mailbox  → mailbox:<email>
//  · imap-manual   → imap:<account>
//  · upload + license → license:MSA-...-XXXX
//  · upload (lisanssız) → web-anonymous
function _deriveUserKey(entry) {
    const src = String(entry.scanSource || '').toLowerCase();
    if (src === 'scan-mailbox' && entry.account) return `mailbox:${entry.account}`;
    if (src === 'imap-manual' && entry.account)  return `imap:${entry.account}`;
    if (entry.licenseKey) {
        const k = String(entry.licenseKey);
        const last4 = k.slice(-4);
        return `license:MSA…${last4}`;
    }
    if (src === 'upload' || src === 'upload-attachment') return 'web-anonymous';
    return entry.account ? `account:${entry.account}` : 'unknown';
}

function _userKeyLabel(uk) {
    if (!uk) return 'Bilinmiyor';
    if (uk === 'web-anonymous') return '🌐 Web Yükleme (lisanssız)';
    if (uk === 'unknown')       return '❓ Bilinmiyor';
    if (uk.startsWith('mailbox:')) return '📬 ' + uk.slice(8);
    if (uk.startsWith('imap:'))    return '📡 ' + uk.slice(5);
    if (uk.startsWith('license:')) return '🔑 ' + uk.slice(8);
    if (uk.startsWith('account:')) return '👤 ' + uk.slice(8);
    return uk;
}

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
    const userKey   = _deriveUserKey(e);

    _insert.run(
        e.id || null,
        e.timestamp,
        e.level || null,
        Number.isFinite(e.score) ? e.score : null,
        e.scanSource || null,
        fromEmail,
        subject,
        userKey,
        JSON.stringify(e)
    );

    // Periyodik temizlik (her 50 yazıdan sonra ~)
    if (Math.random() < 0.02) _prune();

    return loadScanHistory();
}

function saveScanHistory(history) {
    db.exec('DELETE FROM scan_history');
    const tx = db.transaction((items) => {
        for (const item of items) recordScan(item);
    });
    tx(Array.isArray(history) ? history : []);
}

// ─── AYRINTILI İSTATİSTİK ────────────────────────────────
/**
 * Belirtilen gün sayısı için ayrıntılı istatistikler.
 * @param {number} days - varsayılan 30
 * @returns {object} { totalScans, byUser, bySource, byLevel, hourly,
 *                     topSenders, topRiskySenders, slowestScores, avgScore }
 */
function getDetailedStats(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // ─── Kullanıcı bazlı tarama sayısı ve tehdit sayısı ───
    const byUserRows = db.prepare(`
        SELECT
            COALESCE(user_key, 'unknown') AS user_key,
            COUNT(*)  AS scan_count,
            SUM(CASE WHEN level = 'high'   THEN 1 ELSE 0 END) AS high_count,
            SUM(CASE WHEN level = 'medium' THEN 1 ELSE 0 END) AS medium_count,
            SUM(CASE WHEN level = 'low'    THEN 1 ELSE 0 END) AS low_count,
            SUM(CASE WHEN level = 'safe'   THEN 1 ELSE 0 END) AS safe_count,
            ROUND(AVG(score), 1) AS avg_score,
            MAX(timestamp) AS last_scan_at
        FROM scan_history
        WHERE timestamp >= ?
        GROUP BY user_key
        ORDER BY scan_count DESC
    `).all(since);

    const byUser = byUserRows.map(r => ({
        userKey:    r.user_key,
        label:      _userKeyLabel(r.user_key),
        scanCount:  r.scan_count,
        highCount:  r.high_count   || 0,
        mediumCount:r.medium_count || 0,
        lowCount:   r.low_count    || 0,
        safeCount:  r.safe_count   || 0,
        avgScore:   r.avg_score    || 0,
        lastScanAt: r.last_scan_at
    }));

    // ─── Kaynak bazlı dağılım ─────────────────────────────
    const bySourceRows = db.prepare(`
        SELECT scan_source, COUNT(*) AS n, ROUND(AVG(score),1) AS avg_score
        FROM scan_history WHERE timestamp >= ?
        GROUP BY scan_source ORDER BY n DESC
    `).all(since);

    // ─── Seviye dağılımı ─────────────────────────────────
    const byLevelRows = db.prepare(`
        SELECT level, COUNT(*) AS n FROM scan_history
        WHERE timestamp >= ? GROUP BY level
    `).all(since);
    const byLevel = { high: 0, medium: 0, low: 0, safe: 0 };
    for (const r of byLevelRows) {
        if (byLevel[r.level] !== undefined) byLevel[r.level] = r.n;
    }

    // ─── Saatlik dağılım (0-23) ──────────────────────────
    const hourlyRows = db.prepare(`
        SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS n
        FROM scan_history WHERE timestamp >= ?
        GROUP BY hour ORDER BY hour
    `).all(since);
    const hourly = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        count: hourlyRows.find(r => r.hour === h)?.n || 0
    }));

    // ─── Hafta günü dağılımı (0=Pazar, 6=Cumartesi) ───────
    const weekdayRows = db.prepare(`
        SELECT CAST(strftime('%w', timestamp) AS INTEGER) AS wd, COUNT(*) AS n
        FROM scan_history WHERE timestamp >= ?
        GROUP BY wd ORDER BY wd
    `).all(since);
    const weekdayLabels = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
    const weekday = weekdayLabels.map((label, i) => ({
        weekday: label,
        count:   weekdayRows.find(r => r.wd === i)?.n || 0
    }));

    // ─── En çok taranan göndericiler ─────────────────────
    const topSenders = db.prepare(`
        SELECT from_email, COUNT(*) AS n FROM scan_history
        WHERE timestamp >= ? AND from_email != ''
        GROUP BY from_email ORDER BY n DESC LIMIT 10
    `).all(since).map(r => ({ email: r.from_email, count: r.n }));

    // ─── En riskli göndericiler (yüksek seviyeli) ─────────
    const topRiskySenders = db.prepare(`
        SELECT from_email,
               SUM(CASE WHEN level='high'   THEN 1 ELSE 0 END) AS high_n,
               SUM(CASE WHEN level='medium' THEN 1 ELSE 0 END) AS medium_n,
               COUNT(*) AS total_n,
               ROUND(AVG(score),1) AS avg_score
        FROM scan_history
        WHERE timestamp >= ? AND from_email != ''
            AND (level='high' OR level='medium')
        GROUP BY from_email
        ORDER BY high_n DESC, medium_n DESC
        LIMIT 10
    `).all(since).map(r => ({
        email:     r.from_email,
        high:      r.high_n   || 0,
        medium:    r.medium_n || 0,
        total:     r.total_n  || 0,
        avgScore:  r.avg_score || 0
    }));

    // ─── Genel özet ──────────────────────────────────────
    const summary = db.prepare(`
        SELECT COUNT(*) AS total, ROUND(AVG(score),1) AS avg_score,
               SUM(CASE WHEN level IN ('high','medium') THEN 1 ELSE 0 END) AS risky_total
        FROM scan_history WHERE timestamp >= ?
    `).get(since);

    return {
        days,
        since,
        totalScans:      summary?.total || 0,
        avgScore:        summary?.avg_score || 0,
        riskyTotal:      summary?.risky_total || 0,
        byLevel,
        byUser,
        bySource:        bySourceRows.map(r => ({ source: r.scan_source || 'unknown', count: r.n, avgScore: r.avg_score || 0 })),
        hourly,
        weekday,
        topSenders,
        topRiskySenders
    };
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
        if (existingCount > 0) return;

        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return;

        const tx = db.transaction((items) => {
            for (const item of items) {
                const e = _normalizeEntry(item);
                const fromEmail = (Array.isArray(e.emailMeta?.from) && e.emailMeta.from[0]?.address) || '';
                const subject   = e.emailMeta?.subject || '';
                const userKey   = _deriveUserKey(e);
                _insert.run(
                    e.id || null,
                    e.timestamp,
                    e.level || null,
                    Number.isFinite(e.score) ? e.score : null,
                    e.scanSource || null,
                    fromEmail, subject, userKey,
                    JSON.stringify(e)
                );
            }
        });
        tx(parsed);
        console.log(`[DB] Geçiş: ${parsed.length} tarama kaydı JSON'dan SQLite'a aktarıldı.`);
        try { fs.renameSync(HISTORY_FILE, HISTORY_FILE + '.bak'); } catch {}
    } catch (e) {
        console.error('[ScanHistory] migration error:', e.message);
    }
})();

// ─── Mevcut user_key NULL kayıtlarını payload'tan doldur ───
(function backfillUserKey() {
    try {
        const nullRows = db.prepare(`SELECT id, payload FROM scan_history WHERE user_key IS NULL`).all();
        if (!nullRows.length) return;
        const upd = db.prepare(`UPDATE scan_history SET user_key = ? WHERE id = ?`);
        const tx = db.transaction((rows) => {
            for (const row of rows) {
                try {
                    const e = JSON.parse(row.payload);
                    upd.run(_deriveUserKey(e), row.id);
                } catch { /* sessiz */ }
            }
        });
        tx(nullRows);
        console.log(`[DB] ${nullRows.length} eski tarama kaydında user_key dolduruldu.`);
    } catch (e) {
        console.error('[ScanHistory] backfill error:', e.message);
    }
})();

module.exports = {
    loadScanHistory,
    recordScan,
    saveScanHistory,
    getDetailedStats
};
