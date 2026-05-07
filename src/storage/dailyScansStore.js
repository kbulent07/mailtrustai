const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', '..', 'data', 'daily-scans.json');

function load() {
    try {
        if (!fs.existsSync(STORE_FILE)) return {};
        return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8') || '{}');
    } catch { return {}; }
}

function save(data) {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function getDailyCount(dateKey) {
    return load()[dateKey || todayKey()] || 0;
}

function incrementDailyCount() {
    const data = load();
    const key = todayKey();
    data[key] = (data[key] || 0) + 1;

    // 31 günden eski kayıtları temizle
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 31);
    for (const k of Object.keys(data)) {
        if (new Date(k) < cutoff) delete data[k];
    }

    save(data);
    return data[key];
}

module.exports = { getDailyCount, incrementDailyCount, todayKey };
