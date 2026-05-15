// ============================================================
// SCAN HISTORY STORAGE — SQLite backend
// API geriye uyumlu: loadScanHistory(), recordScan(), saveScanHistory()
// Ayrıca: getDetailedStats({ days }) — kim/kaynak/seviye/saat dağılımı
// ============================================================
const fs = require('fs');
const path = require('path');
const db = require('./db');

// Kullanıcı isteği üzerine retention sınırı yumuşatıldı:
// - RETENTION_DAYS: 35 → 730 (2 yıl). Eski scan kayıtları korunur.
// - MAX_ITEMS: 1000 → 50000. Sadece çok eski + sınır aşımında prune yapılır.
// Müşteri admin, kullanıcı arayüzünden tarih aralığına göre manuel silebilir.
const RETENTION_DAYS = 730;
const MAX_ITEMS = 50000;

// ─── Prepared statements ──────────────────────────────────
const _insert = db.prepare(`
    INSERT INTO scan_history
        (scan_id, timestamp, level, score, scan_source, from_email, subject, user_key, payload,
         imap_email, imap_uid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// IMAP cache lookup — aynı (account + uid) için son kayıt
const _selectImapCache = db.prepare(`
    SELECT payload, timestamp FROM scan_history
    WHERE imap_email = ? AND imap_uid = ?
    ORDER BY timestamp DESC
    LIMIT 1
`);

const _deleteImapCache = db.prepare(`
    DELETE FROM scan_history
    WHERE imap_email = ? AND imap_uid = ?
`);

// Tarih aralığına göre silme — admin'in 'eski kayıtları temizle' formu
const _deleteByDateRange = db.prepare(`
    DELETE FROM scan_history
    WHERE timestamp >= ? AND timestamp <= ?
`);

const _countAll = db.prepare(`SELECT COUNT(*) AS n FROM scan_history`);
const _countByDateRange = db.prepare(`SELECT COUNT(*) AS n FROM scan_history WHERE timestamp >= ? AND timestamp <= ?`);

const _selectRecent = db.prepare(`
    SELECT payload FROM scan_history
    WHERE timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT ?
`);

const _selectById = db.prepare(`
    SELECT payload FROM scan_history WHERE scan_id = ? LIMIT 1
`);

const _updatePayloadById = db.prepare(`
    UPDATE scan_history SET payload = ? WHERE scan_id = ?
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
    // IMAP cache anahtarları: account/imapEmail ve imap-uid (manual veya monitor)
    const imapEmail = String(e.account || e.imapEmail || '').toLowerCase() || null;
    const imapUid   = e.imapUid != null ? String(e.imapUid)
                    : (e.scanMailboxUid != null ? String(e.scanMailboxUid) : null);

    _insert.run(
        e.id || null,
        e.timestamp,
        e.level || null,
        Number.isFinite(e.score) ? e.score : null,
        e.scanSource || null,
        fromEmail,
        subject,
        userKey,
        JSON.stringify(e),
        imapEmail,
        imapUid
    );

    // Periyodik temizlik (her 50 yazıdan sonra ~)
    if (Math.random() < 0.02) _prune();

    return loadScanHistory();
}

// ─── IMAP cache API ──────────────────────────────────────────────────────
/**
 * Aynı (imapEmail, uid) için kayıtlı tarama sonucunu döner. Yoksa null.
 * Frontend manuel tıklama sırasında tekrar tekrar tarama yapılmasın diye
 * AnalyzeImapMailService bu fonksiyonu kullanır.
 */
function findCachedImapScan(imapEmail, uid) {
    if (!imapEmail || uid == null) return null;
    const row = _selectImapCache.get(String(imapEmail).toLowerCase(), String(uid));
    if (!row) return null;
    try {
        const parsed = JSON.parse(row.payload);
        parsed._cachedAt = row.timestamp;
        return parsed;
    } catch { return null; }
}

/**
 * (imapEmail, uid) için tüm kayıtlı sonuçları siler — 'Yeniden Tara' akışında
 * eski cache'i temizlemek için kullanılır.
 */
function clearCachedImapScan(imapEmail, uid) {
    if (!imapEmail || uid == null) return 0;
    const r = _deleteImapCache.run(String(imapEmail).toLowerCase(), String(uid));
    return r.changes || 0;
}

// ─── Tarih aralığı silme API'si ──────────────────────────────────────────
/**
 * fromISO ile toISO (dahil) tarih aralığındaki scan_history kayıtlarını siler.
 * Admin temizlik akışında kullanılır.
 *
 * @returns {{deleted: number, before: number, after: number}}
 */
function deleteScanHistoryRange(fromISO, toISO) {
    const before = _countAll.get().n;
    const inRange = _countByDateRange.get(fromISO, toISO).n;
    const r = _deleteByDateRange.run(fromISO, toISO);
    const after = _countAll.get().n;
    return { deleted: r.changes || 0, before, after, inRange };
}

function countScanHistory() {
    return _countAll.get().n;
}

function saveScanHistory(history) {
    // DELETE + INSERT'i tek bir transaction'a sar — yarıda kalırsa rollback.
    // Ayrıca recordScan içindeki rastgele _prune() çağrısını burada atla
    // (transaction içinde yine bir transaction açmaktan kaçınıyoruz).
    const items = Array.isArray(history) ? history : [];
    const tx = db.transaction((rows) => {
        db.exec('DELETE FROM scan_history');
        for (const item of rows) {
            const e = _normalizeEntry(item);
            const fromEmail = (Array.isArray(e.emailMeta?.from) && e.emailMeta.from[0]?.address) || '';
            const subject   = e.emailMeta?.subject || '';
            const userKey   = _deriveUserKey(e);
            const imapEmail = String(e.account || e.imapEmail || '').toLowerCase() || null;
            const imapUid   = e.imapUid != null ? String(e.imapUid)
                            : (e.scanMailboxUid != null ? String(e.scanMailboxUid) : null);
            _insert.run(
                e.id || null,
                e.timestamp,
                e.level || null,
                Number.isFinite(e.score) ? e.score : null,
                e.scanSource || null,
                fromEmail,
                subject,
                userKey,
                JSON.stringify(e),
                imapEmail,
                imapUid
            );
        }
    });
    tx(items);
}

// ─── AYRINTILI İSTATİSTİK ────────────────────────────────
/**
 * Belirtilen aralık için ayrıntılı istatistikler.
 *
 * @param {number|object} arg
 *   number     → son N gün (geriye uyumluluk: getDetailedStats(30))
 *   object     → { days?, start?, end? } — start/end ISO string
 *                start verilirse since=start, end verilirse cutoff=end
 *
 * @returns {object} { days, start, end, totalScans, byUser, bySource,
 *                     byLevel, hourly, topSenders, topRiskySenders, avgScore }
 */
function getDetailedStats(arg = 30) {
    let days, since, until;
    if (typeof arg === 'number') {
        days  = Math.max(1, Math.min(arg, 365));
        since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        until = new Date().toISOString();
    } else {
        const startMs = arg.start ? new Date(arg.start).getTime() : null;
        const endMs   = arg.end   ? new Date(arg.end).getTime()   : null;
        if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
            since = new Date(startMs).toISOString();
            // end günü dahil et — verilmiş tarihin günün sonu (23:59:59)
            const endIncl = new Date(endMs);
            endIncl.setHours(23, 59, 59, 999);
            until = endIncl.toISOString();
            days  = Math.max(1, Math.round((endIncl.getTime() - startMs) / 86400000));
        } else {
            days  = Math.max(1, Math.min(arg.days || 30, 365));
            since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            until = new Date().toISOString();
        }
    }

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
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY user_key
        ORDER BY scan_count DESC
    `).all(since, until);

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
        FROM scan_history WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY scan_source ORDER BY n DESC
    `).all(since, until);

    // ─── Seviye dağılımı ─────────────────────────────────
    const byLevelRows = db.prepare(`
        SELECT level, COUNT(*) AS n FROM scan_history
        WHERE timestamp >= ? AND timestamp <= ? GROUP BY level
    `).all(since, until);
    const byLevel = { high: 0, medium: 0, low: 0, safe: 0 };
    for (const r of byLevelRows) {
        if (byLevel[r.level] !== undefined) byLevel[r.level] = r.n;
    }

    // ─── Saatlik dağılım (0-23) ──────────────────────────
    const hourlyRows = db.prepare(`
        SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS n
        FROM scan_history WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY hour ORDER BY hour
    `).all(since, until);
    const hourly = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        count: hourlyRows.find(r => r.hour === h)?.n || 0
    }));

    // ─── Hafta günü dağılımı (0=Pazar, 6=Cumartesi) ───────
    const weekdayRows = db.prepare(`
        SELECT CAST(strftime('%w', timestamp) AS INTEGER) AS wd, COUNT(*) AS n
        FROM scan_history WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY wd ORDER BY wd
    `).all(since, until);
    const weekdayLabels = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
    const weekday = weekdayLabels.map((label, i) => ({
        weekday: label,
        count:   weekdayRows.find(r => r.wd === i)?.n || 0
    }));

    // ─── En çok taranan göndericiler ─────────────────────
    const topSenders = db.prepare(`
        SELECT from_email, COUNT(*) AS n FROM scan_history
        WHERE timestamp >= ? AND timestamp <= ? AND from_email != ''
        GROUP BY from_email ORDER BY n DESC LIMIT 10
    `).all(since, until).map(r => ({ email: r.from_email, count: r.n }));

    // ─── En riskli göndericiler (yüksek seviyeli) ─────────
    const topRiskySenders = db.prepare(`
        SELECT from_email,
               SUM(CASE WHEN level='high'   THEN 1 ELSE 0 END) AS high_n,
               SUM(CASE WHEN level='medium' THEN 1 ELSE 0 END) AS medium_n,
               COUNT(*) AS total_n,
               ROUND(AVG(score),1) AS avg_score
        FROM scan_history
        WHERE timestamp >= ? AND timestamp <= ? AND from_email != ''
            AND (level='high' OR level='medium')
        GROUP BY from_email
        ORDER BY high_n DESC, medium_n DESC
        LIMIT 10
    `).all(since, until).map(r => ({
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
        FROM scan_history WHERE timestamp >= ? AND timestamp <= ?
    `).get(since, until);

    return {
        days,
        since,
        until,
        start:           since,
        end:             until,
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

function findScanById(scanId) {
    if (!scanId) return null;
    try {
        const row = _selectById.get(String(scanId));
        if (!row) return null;
        return _decode({ payload: row.payload });
    } catch { return null; }
}

function updateScanById(scanId, patch) {
    if (!scanId || !patch || typeof patch !== 'object') return null;
    const existing = findScanById(scanId);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    try {
        _updatePayloadById.run(JSON.stringify(merged), String(scanId));
        return merged;
    } catch (e) {
        console.error('[ScanHistory] updateScanById hata:', e.message);
        return null;
    }
}

// ─── Filtrelenmiş tarama listesi ─────────────────────────────────────────────
/**
 * Mail adresi, konu, tarih aralığı ve risk seviyesine göre sayfalanmış arama.
 *
 * @param {object} opts
 *   fromEmail      – gönderen adresi (LIKE, kısmi eşleşme)
 *   subject        – konu (LIKE, kısmi eşleşme)
 *   start          – ISO tarih başlangıcı (dahil)
 *   end            – ISO tarih bitişi (gün sonu eklenir)
 *   level          – 'high'|'medium'|'low'|'safe'|'' (boş = tümü)
 *   page           – sayfa numarası (1-based)
 *   limit          – sayfa başı satır (max 100)
 *   imapEmailFilter – null = tümü, string = sadece bu imap_email (user rolü)
 */
function searchScanHistory({ fromEmail = '', subject = '', start = '', end = '',
                              level = '', page = 1, limit = 50, imapEmailFilter = null } = {}) {
    const conditions = [];
    const params     = [];

    if (start) {
        conditions.push('timestamp >= ?');
        params.push(start.length === 10 ? start + 'T00:00:00.000Z' : start);
    }
    if (end) {
        conditions.push('timestamp <= ?');
        params.push(end.length === 10 ? end + 'T23:59:59.999Z' : end);
    }
    if (fromEmail.trim()) {
        conditions.push('from_email LIKE ?');
        params.push('%' + fromEmail.trim().toLowerCase() + '%');
    }
    if (subject.trim()) {
        conditions.push('subject LIKE ?');
        params.push('%' + subject.trim() + '%');
    }
    if (level && ['high','medium','low','safe'].includes(level)) {
        conditions.push('level = ?');
        params.push(level);
    }
    if (imapEmailFilter) {
        conditions.push('(imap_email = ? OR user_key LIKE ?)');
        params.push(imapEmailFilter.toLowerCase(), '%' + imapEmailFilter.toLowerCase() + '%');
    }

    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const safeLimit  = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const safePage   = Math.max(parseInt(page,  10) || 1, 1);
    const offset     = (safePage - 1) * safeLimit;

    const rows = db.prepare(
        `SELECT scan_id, timestamp, level, score, scan_source,
                from_email, subject, user_key, imap_email
         FROM scan_history
         ${where}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`
    ).all(...params, safeLimit, offset);

    const { n: total } = db.prepare(
        `SELECT COUNT(*) AS n FROM scan_history ${where}`
    ).get(...params);

    return { rows, total, page: safePage, limit: safeLimit,
             totalPages: Math.ceil(total / safeLimit) };
}

module.exports = {
    loadScanHistory,
    recordScan,
    saveScanHistory,
    getDetailedStats,
    searchScanHistory,
    findScanById,
    updateScanById,
    // IMAP cache + admin temizlik API'leri
    findCachedImapScan,
    clearCachedImapScan,
    deleteScanHistoryRange,
    countScanHistory
};
