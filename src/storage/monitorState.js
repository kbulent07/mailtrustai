const fs = require('fs');
const path = require('path');

const MONITOR_STATE_FILE = path.join(__dirname, '..', '..', 'data', 'monitor-state.json');

function ensureDir() {
    const dir = path.dirname(MONITOR_STATE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadMonitorState() {
    try {
        if (!fs.existsSync(MONITOR_STATE_FILE)) {
            return [];
        }

        const raw = fs.readFileSync(MONITOR_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.monitors)) {
            return [];
        }

        return parsed.monitors.filter((entry) => entry?.email && entry?.licenseKey);
    } catch {
        return [];
    }
}

function saveMonitorState(monitors) {
    ensureDir();
    fs.writeFileSync(
        MONITOR_STATE_FILE,
        JSON.stringify({ monitors }, null, 2),
        'utf8'
    );
    return monitors;
}

function upsertMonitorState(entry) {
    const monitors = loadMonitorState();
    const next = monitors.filter((item) => item.email !== entry.email);
    next.push({
        email: entry.email,
        licenseKey: entry.licenseKey,
        startedAt: entry.startedAt || new Date().toISOString()
    });
    return saveMonitorState(next);
}

function removeMonitorState(email) {
    const next = loadMonitorState().filter((item) => item.email !== email);
    return saveMonitorState(next);
}

module.exports = {
    loadMonitorState,
    saveMonitorState,
    upsertMonitorState,
    removeMonitorState
};
