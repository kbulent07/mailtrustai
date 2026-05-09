// ============================================================
// MONTHLY SCAN COUNTER — HMAC korumalı (dosya değiştirilirse sıfırlanır)
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COUNTER_FILE = path.join(__dirname, '..', '..', 'data', 'monthly-counts.json');
const HMAC_SECRET = process.env.MSA_LICENSE_SECRET || 'MSA_SECRET_2024_K3Y!@#';

function computeHmac(dataObj) {
    // Yalnızca sayım verilerini (underscore ile başlamayan anahtarlar) imzala
    const filtered = Object.fromEntries(
        Object.entries(dataObj).filter(([k]) => !k.startsWith('_'))
    );
    const content = stableStringify(filtered);
    return crypto.createHmac('sha256', HMAC_SECRET).update(content).digest('hex').substring(0, 24);
}

function stableStringify(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function getCurrentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function loadCounts() {
    try {
        if (!fs.existsSync(COUNTER_FILE)) return {};
        const raw = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8') || '{}');

        // HMAC doğrulaması
        const storedHmac = raw._hmac;
        const dataWithoutMeta = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
        if (storedHmac) {
            const expectedHmac = computeHmac(dataWithoutMeta);
            if (storedHmac !== expectedHmac) {
                console.error('[Counter] UYARI: Aylık tarama sayacı dosyası değiştirilmiş. Sayaçlar sıfırlanıyor.');
                return {};
            }
        }

        return dataWithoutMeta;
    } catch { return {}; }
}

function saveCounts(data) {
    const dir = path.dirname(COUNTER_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const withHmac = { ...data, _hmac: computeHmac(data), _savedAt: new Date().toISOString() };
    fs.writeFileSync(COUNTER_FILE, JSON.stringify(withHmac, null, 2), 'utf8');
}

function getMonthlyCount(monthKey, scope = 'global') {
    const key = monthKey || getCurrentMonthKey();
    const value = loadCounts()[key];
    if (typeof value === 'number') return scope === 'global' ? value : 0;
    if (scope === 'global') return Object.values(value || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    return value?.[scope] || 0;
}

function incrementMonthlyCount(scope = 'global') {
    const counts = loadCounts();
    const key = getCurrentMonthKey();
    const current = typeof counts[key] === 'object' && counts[key] !== null ? counts[key] : {};
    current[scope] = (current[scope] || 0) + 1;
    counts[key] = current;

    // 13 aydan eski kayıtları temizle
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 13);
    for (const k of Object.keys(counts)) {
        const [y, m] = k.split('-').map(Number);
        if (new Date(y, m - 1) < cutoff) delete counts[k];
    }

    saveCounts(counts);
    return current[scope];
}

function resetMonthlyCount(monthKey) {
    const counts = loadCounts();
    const key = monthKey || getCurrentMonthKey();
    counts[key] = 0;
    saveCounts(counts);
}

module.exports = { getCurrentMonthKey, getMonthlyCount, incrementMonthlyCount, resetMonthlyCount };
