// ============================================================
// SCAN HISTORY STORAGE
// Persists scan history and keeps enough data for daily, weekly, and monthly reports.
// ============================================================
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', '..', 'data', 'scan-history.json');
const RETENTION_DAYS = 35;
const MAX_ITEMS = 1000;

function loadScanHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return [];
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const pruned = pruneHistory(parsed);
        if (pruned.length !== parsed.length) {
            saveScanHistory(pruned);
        }
        return pruned;
    } catch {
        return [];
    }
}

function recordScan(entry) {
    const history = loadScanHistory();
    history.unshift(normalizeEntry(entry));
    const pruned = pruneHistory(history);
    saveScanHistory(pruned);
    return pruned;
}

function saveScanHistory(history) {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(pruneHistory(history), null, 2), 'utf8');
}

function pruneHistory(history) {
    const threshold = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);

    return history
        .map(normalizeEntry)
        .filter((item) => {
            const time = new Date(item.timestamp || item.queriedAt || 0).getTime();
            return Number.isFinite(time) && time >= threshold;
        })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, MAX_ITEMS);
}

function normalizeEntry(entry = {}) {
    return {
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString()
    };
}

module.exports = {
    loadScanHistory,
    recordScan,
    saveScanHistory
};
