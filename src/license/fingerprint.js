// ============================================================
// FINGERPRINT — Sunucu parmak izi toplama ve doğrulama
//
// Faktörler (Docker + VPS kurulumu için optimize):
//   machine-id  : Host /etc/machine-id → volume mount ile gelir (%50)
//   install-id  : İlk kurulumda üretilir, volume'da kalır        (%30)
//   hostname    : HOST_HOSTNAME env veya os.hostname()            (%20)
//
// Tolerans eşiği: 70 puan → en az 2 faktörün eşleşmesi yeterli.
// machine-id tek başına yetmez (50 < 70), başka bir faktör şart.
// ============================================================
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const path   = require('path');

const DATA_DIR            = path.join(__dirname, '..', '..', 'data');
const INSTALL_ID_FILE     = path.join(DATA_DIR, '.install-id');
const HOST_MACHINE_ID_FILE = path.join(DATA_DIR, 'host_machine_id'); // volume: /etc/machine-id → /app/data/host_machine_id

const WEIGHTS   = { machineId: 50, installId: 30, hostname: 20 };
const THRESHOLD = 70;

// İlk başlatmada üretilir, Docker volume'unda kalıcı olarak saklanır.
function getOrCreateInstallId() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (!fs.existsSync(INSTALL_ID_FILE)) {
            fs.writeFileSync(INSTALL_ID_FILE, crypto.randomUUID(), 'utf8');
        }
        return fs.readFileSync(INSTALL_ID_FILE, 'utf8').trim();
    } catch {
        return '';
    }
}

function getMachineId() {
    if (fs.existsSync(HOST_MACHINE_ID_FILE)) {
        return fs.readFileSync(HOST_MACHINE_ID_FILE, 'utf8').trim();
    }
    // setup.sh tarafından .env'e yazılmış olabilir
    return (process.env.HOST_MACHINE_ID || '').trim();
}

function getHostname() {
    return (process.env.HOST_HOSTNAME || os.hostname() || '').trim();
}

// Mevcut sunucunun faktörlerini toplar.
function collectFactors() {
    return {
        machineId: getMachineId(),
        installId: getOrCreateInstallId(),
        hostname:  getHostname(),
    };
}

// Faktörleri tek bir 32-karakter hex parmak izine indirger.
function computeFingerprint(factors) {
    const raw = [factors.machineId, factors.installId, factors.hostname].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

// Mevcut faktörleri lisanstaki kayıtlı faktörlerle karşılaştırır.
function scoreMatch(current, licensed) {
    let score = 0;
    if (current.machineId && licensed.machineId && current.machineId === licensed.machineId) score += WEIGHTS.machineId;
    if (current.installId && licensed.installId && current.installId === licensed.installId) score += WEIGHTS.installId;
    if (current.hostname  && licensed.hostname  && current.hostname  === licensed.hostname)  score += WEIGHTS.hostname;
    return score;
}

// Ana doğrulama — lisanstaki fingerprint faktörleriyle mevcut sunucuyu karşılaştırır.
function verifyFingerprint(licensedFactors) {
    if (!licensedFactors || typeof licensedFactors !== 'object') {
        return { valid: false, score: 0, threshold: THRESHOLD, reason: 'Lisansta fingerprint yok' };
    }
    const current = collectFactors();
    const score   = scoreMatch(current, licensedFactors);
    const missing = [];
    if (!current.machineId) missing.push('machine-id okunamadı (volume mount eksik?)');
    if (!current.installId) missing.push('install-id oluşturulamadı');

    return {
        valid:     score >= THRESHOLD,
        score,
        threshold: THRESHOLD,
        current,
        licensed:  licensedFactors,
        missing,
    };
}

module.exports = { collectFactors, computeFingerprint, scoreMatch, verifyFingerprint, getOrCreateInstallId, WEIGHTS, THRESHOLD };
