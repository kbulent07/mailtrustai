const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ISSUED_FILE = path.join(__dirname, '..', '..', 'data', 'issued-licenses.json');

function ensureDir() {
    const dir = path.dirname(ISSUED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadIssued() {
    try {
        if (!fs.existsSync(ISSUED_FILE)) return [];
        return JSON.parse(fs.readFileSync(ISSUED_FILE, 'utf8') || '[]');
    } catch { return []; }
}

function saveIssued(list) {
    ensureDir();
    fs.writeFileSync(ISSUED_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function recordIssuedLicense({ keys, plan, tier, duration, reseller, company, email, notes }) {
    const list = loadIssued();
    const record = {
        id:        uuidv4(),
        issuedAt:  new Date().toISOString(),
        company:   company  || '',
        email:     email    || '',
        notes:     notes    || '',
        plan:      plan     || '',
        tier:      tier     || '',
        duration:  duration || '',
        reseller:  reseller || 'DIRECT',
        keys:      Array.isArray(keys) ? keys : [keys].filter(Boolean)
    };
    list.unshift(record);
    saveIssued(list);
    return record;
}

function deleteIssuedRecord(id) {
    const list = loadIssued().filter(r => r.id !== id);
    saveIssued(list);
}

module.exports = { loadIssued, recordIssuedLicense, deleteIssuedRecord };
