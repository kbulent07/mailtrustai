// ============================================================
// AUTO MONITOR STATE — Persists active WebSocket monitors so
// they auto-resume on server restart.
// ============================================================
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'auto-monitor-state.json');

function load() {
    try {
        if (!fs.existsSync(STATE_FILE)) return [];
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function save(entries) {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

function addAutoMonitor(email, licenseKey) {
    if (!email) return;
    const entries = load().filter(e => e.email !== email);
    entries.push({ email, licenseKey: licenseKey || '', updatedAt: new Date().toISOString() });
    save(entries);
}

function removeAutoMonitor(email) {
    if (!email) return;
    save(load().filter(e => e.email !== email));
}

function listAutoMonitors() {
    return load();
}

module.exports = { addAutoMonitor, removeAutoMonitor, listAutoMonitors };
