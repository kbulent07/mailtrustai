// ============================================================
// FALSE POSITIVE SUGGESTION STORE
// Kullanıcı bir bulgunun "yanlış pozitif" olduğunu işaretlediğinde
// burada birikir. Admin (yerel kullanıcı) onaylayarak trusted_domains'e
// taşır veya reddeder.
// ============================================================
const db = require('./db');
const { addTrustedDomain } = require('./trustedDomainStore');

function _normalize(domain) {
    return String(domain || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/[/?#].*$/, '')
        .replace(/^@/, '');
}

function _isValidDomain(d) {
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d);
}

/**
 * Yeni öneri kaydeder. Aynı domain için bekleyen kayıt varsa report_count++
 * ve last_seen_at güncellenir.
 */
function addSuggestion({ domain, scanId = null, category = '', severity = '', message = '', reporter = '' }) {
    const d = _normalize(domain);
    if (!d || !_isValidDomain(d)) {
        throw new Error(`Geçersiz domain: "${domain}"`);
    }

    // Zaten approved/rejected ise tekrar suggestion oluşturma (UNIQUE constraint
    // status başına olduğu için 'pending' kaydı bağımsız tutulabilir).
    const final = db.prepare(
        "SELECT status FROM fp_suggestions WHERE domain = ? AND status IN ('approved','rejected')"
    ).get(d);
    if (final) {
        return { ok: true, status: final.status, alreadyDecided: true, domain: d };
    }

    const existing = db.prepare(
        "SELECT id FROM fp_suggestions WHERE domain = ? AND status = 'pending'"
    ).get(d);

    if (existing) {
        db.prepare(`
            UPDATE fp_suggestions
               SET report_count    = report_count + 1,
                   last_seen_at    = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                   finding_message = COALESCE(NULLIF(?, ''), finding_message),
                   scan_id         = COALESCE(?, scan_id)
             WHERE id = ?
        `).run(message, scanId, existing.id);
        return { ok: true, status: 'pending', incremented: true, domain: d };
    }

    db.prepare(`
        INSERT INTO fp_suggestions
            (domain, finding_category, finding_severity, finding_message, scan_id, reporter, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(d, String(category || ''), String(severity || ''), String(message || ''), scanId, String(reporter || ''));

    return { ok: true, status: 'pending', inserted: true, domain: d };
}

function listPending() {
    return db.prepare(`
        SELECT * FROM fp_suggestions
         WHERE status = 'pending'
         ORDER BY report_count DESC, last_seen_at DESC
    `).all();
}

function listAll(limit = 200) {
    return db.prepare(`
        SELECT * FROM fp_suggestions
         ORDER BY last_seen_at DESC
         LIMIT ?
    `).all(limit);
}

/**
 * Onaylar: trusted_domains'e ekler ve status='approved' olarak işaretler.
 * Aynı domain için pending kayıt yoksa hata.
 */
function approve(domain, { category = 'custom', note = '' } = {}) {
    const d = _normalize(domain);
    const existing = db.prepare(
        "SELECT id, finding_message FROM fp_suggestions WHERE domain = ? AND status = 'pending'"
    ).get(d);
    if (!existing) {
        return { ok: false, error: 'Bekleyen öneri bulunamadı' };
    }

    db.transaction(() => {
        addTrustedDomain({
            domain: d,
            category,
            addedBy: 'auto',
            note: note || `FP onay: ${existing.finding_message || ''}`.slice(0, 240)
        });
        db.prepare("UPDATE fp_suggestions SET status = 'approved', last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(existing.id);
    })();

    return { ok: true, domain: d };
}

function reject(domain) {
    const d = _normalize(domain);
    const r = db.prepare(`
        UPDATE fp_suggestions
           SET status = 'rejected',
               last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE domain = ? AND status = 'pending'
    `).run(d);
    return { ok: r.changes > 0, domain: d };
}

function deleteSuggestion(domain, status = 'pending') {
    const d = _normalize(domain);
    const r = db.prepare("DELETE FROM fp_suggestions WHERE domain = ? AND status = ?").run(d, status);
    return { removed: r.changes > 0 };
}

module.exports = {
    addSuggestion,
    listPending,
    listAll,
    approve,
    reject,
    deleteSuggestion
};
