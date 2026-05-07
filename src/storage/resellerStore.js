const fs = require('fs');
const path = require('path');

const RESELLERS_FILE = path.join(__dirname, '..', '..', 'data', 'resellers.json');

function ensureDir() {
    const dir = path.dirname(RESELLERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadResellers() {
    try {
        if (!fs.existsSync(RESELLERS_FILE)) return [];
        return JSON.parse(fs.readFileSync(RESELLERS_FILE, 'utf8') || '[]');
    } catch { return []; }
}

function saveResellers(resellers) {
    ensureDir();
    fs.writeFileSync(RESELLERS_FILE, JSON.stringify(resellers, null, 2), 'utf8');
}

function addReseller(resellerData) {
    const resellers = loadResellers();
    const entry = {
        ...resellerData,
        id: Date.now().toString(36),
        createdAt: new Date().toISOString(),
        keysGenerated: 0
    };
    resellers.push(entry);
    saveResellers(resellers);
    return entry;
}

function removeReseller(id) {
    const resellers = loadResellers().filter(r => r.id !== id);
    saveResellers(resellers);
}

module.exports = { loadResellers, addReseller, removeReseller };
