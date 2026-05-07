// ============================================================
// ALLOWLIST / BLOCKLIST STORAGE
// ============================================================
const fs = require('fs');
const path = require('path');

const LIST_FILE = path.join(__dirname, '..', '..', 'data', 'domain-lists.json');

function ensureDir() {
    const dir = path.dirname(LIST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadLists() {
    try {
        if (!fs.existsSync(LIST_FILE)) return { allowlist: [], blocklist: [] };
        const raw = fs.readFileSync(LIST_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            allowlist: Array.isArray(parsed.allowlist) ? parsed.allowlist : [],
            blocklist: Array.isArray(parsed.blocklist) ? parsed.blocklist : []
        };
    } catch {
        return { allowlist: [], blocklist: [] };
    }
}

function saveLists(lists) {
    ensureDir();
    fs.writeFileSync(LIST_FILE, JSON.stringify(lists, null, 2), 'utf8');
}

function normalizeDomain(d) {
    return String(d || '').trim().toLowerCase().replace(/^www\./, '');
}

// E-posta mı yoksa domain mi?  "user@example.com" → email, "example.com" → domain
function isEmail(value) {
    return String(value || '').includes('@');
}

function normalizeEntry(value) {
    const v = String(value || '').trim().toLowerCase();
    if (isEmail(v)) return v;                   // tam e-posta, olduğu gibi sakla
    return v.replace(/^www\./, '');             // domain: www'siz normalleştir
}

// Allowlist
function addToAllowlist(value) {
    const entry = normalizeEntry(value);
    if (!entry) return false;
    const lists = loadLists();
    if (!lists.allowlist.includes(entry)) {
        lists.allowlist.push(entry);
        saveLists(lists);
    }
    return true;
}

function removeFromAllowlist(value) {
    const entry = normalizeEntry(value);
    const lists = loadLists();
    lists.allowlist = lists.allowlist.filter(x => x !== entry);
    saveLists(lists);
}

function isAllowlisted(emailOrDomain) {
    const { allowlist } = loadLists();
    const raw = String(emailOrDomain || '').trim().toLowerCase();

    if (isEmail(raw)) {
        const domain = raw.split('@')[1] || '';
        // tam e-posta eşleşmesi veya domain eşleşmesi
        return allowlist.some(a => a === raw || a === domain || domain.endsWith('.' + a));
    }
    const d = raw.replace(/^www\./, '');
    return allowlist.some(a => d === a || d.endsWith('.' + a));
}

// Blocklist
function addToBlocklist(value) {
    const entry = normalizeEntry(value);
    if (!entry) return false;
    const lists = loadLists();
    if (!lists.blocklist.includes(entry)) {
        lists.blocklist.push(entry);
        saveLists(lists);
    }
    return true;
}

function removeFromBlocklist(value) {
    const entry = normalizeEntry(value);
    const lists = loadLists();
    lists.blocklist = lists.blocklist.filter(x => x !== entry);
    saveLists(lists);
}

function isBlocklisted(emailOrDomain) {
    const { blocklist } = loadLists();
    const raw = String(emailOrDomain || '').trim().toLowerCase();

    if (isEmail(raw)) {
        const domain = raw.split('@')[1] || '';
        return blocklist.some(b => b === raw || b === domain || domain.endsWith('.' + b));
    }
    const d = raw.replace(/^www\./, '');
    return blocklist.some(b => d === b || d.endsWith('.' + b));
}

module.exports = {
    loadLists,
    addToAllowlist, removeFromAllowlist, isAllowlisted,
    addToBlocklist,  removeFromBlocklist,  isBlocklisted
};
