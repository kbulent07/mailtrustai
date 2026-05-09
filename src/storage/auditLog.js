const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const AUDIT_FILE = path.join(__dirname, '..', '..', 'data', 'audit-log.json');
const MAX_ITEMS = 2000;

function ensureDir() {
    const dir = path.dirname(AUDIT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadAuditLog(limit = 200) {
    try {
        if (!fs.existsSync(AUDIT_FILE)) return [];
        const parsed = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8') || '[]');
        const rows = Array.isArray(parsed) ? parsed : [];
        return rows.slice(0, Math.min(Number(limit) || 200, MAX_ITEMS));
    } catch {
        return [];
    }
}

function saveAuditLog(rows) {
    ensureDir();
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(rows.slice(0, MAX_ITEMS), null, 2), 'utf8');
}

function recordAudit(event = {}) {
    const rows = loadAuditLog(MAX_ITEMS);
    const req = event.req;
    const entry = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        actorType: event.actorType || 'system',
        actorId: event.actorId || '',
        action: event.action || 'unknown',
        target: sanitizeTarget(event.target || ''),
        status: event.status || 'success',
        ip: event.ip || req?.ip || req?.connection?.remoteAddress || '',
        userAgent: event.userAgent || req?.headers?.['user-agent'] || '',
        details: sanitizeDetails(event.details || {})
    };
    rows.unshift(entry);
    saveAuditLog(rows);
    return entry;
}

function sanitizeTarget(target) {
    const value = String(target || '');
    return value.replace(/MSA-[A-Z0-9-]{12,}/g, (match) => {
        if (match.length <= 18) return '[license-redacted]';
        return `${match.slice(0, 12)}...${match.slice(-6)}`;
    });
}

function sanitizeDetails(value) {
    if (value === null || value === undefined) return {};
    const seen = new WeakSet();
    const redact = (input) => {
        if (input === null || input === undefined) return input;
        if (typeof input !== 'object') return input;
        if (seen.has(input)) return '[Circular]';
        seen.add(input);
        if (Array.isArray(input)) return input.slice(0, 50).map(redact);
        return Object.fromEntries(Object.entries(input).map(([key, val]) => {
            if (/password|secret|token|key|pin/i.test(key)) return [key, '[redacted]'];
            return [key, redact(val)];
        }));
    };
    return redact(value);
}

module.exports = { loadAuditLog, recordAudit };
