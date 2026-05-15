// ============================================================
// FINGERPRINT — Sunucu parmak izi (Linux + Windows uyumlu)
//
// Final Skor Modeli:
//   install_id       4 puan, ZORUNLU
//   os_machine_id    4 puan, ZORUNLU
//   system_uuid      3 puan, opsiyonel (bonus)
//   hostname         0 puan, bilgi amaçlı (değişse bile lisans bozulmaz)
//
// Geçerlilik Kuralı:
//   install_id + os_machine_id BOTH must match  →  taban skor 8
//   total >= 8  →  geçerli
//
// Ortak JSON Format (Linux + Windows aynısını üretir):
//   {
//     "fingerprint_version": 1,
//     "type": "docker-host",
//     "platform": "linux" | "windows",
//     "generated_at": "ISO 8601",
//     "signals": {
//       "install_id_hash":    "sha256:...",
//       "os_machine_id_hash": "sha256:...",
//       "system_uuid_hash":   "sha256:..."   (null ise yok),
//       "hostname_hash":      "sha256:..."
//     }
//   }
// ============================================================
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const path   = require('path');

const FINGERPRINT_VERSION = 1;

const DATA_DIR              = path.join(__dirname, '..', '..', 'data');
const INSTALL_ID_FILE       = path.join(DATA_DIR, '.install-id');
const HOST_MACHINE_ID_FILE  = path.join(DATA_DIR, 'host_machine_id');   // volume: /etc/machine-id
const HOST_SYSTEM_UUID_FILE = path.join(DATA_DIR, 'host_system_uuid');  // opsiyonel: setup.sh ile yazılır

const WEIGHTS = {
    install_id:    { points: 4, mandatory: true },
    os_machine_id: { points: 4, mandatory: true },
    system_uuid:   { points: 3, mandatory: false },
    hostname:      { points: 0, mandatory: false }, // bilgi amaçlı
};
const THRESHOLD = 8;

// ── Sinyal Toplayıcılar ──────────────────────────────────────
function sha256(value) {
    if (!value) return null;
    return 'sha256:' + crypto.createHash('sha256').update(String(value)).digest('hex');
}

function getOrCreateInstallId() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (!fs.existsSync(INSTALL_ID_FILE)) {
            fs.writeFileSync(INSTALL_ID_FILE, crypto.randomUUID(), 'utf8');
        }
        return fs.readFileSync(INSTALL_ID_FILE, 'utf8').trim();
    } catch { return ''; }
}

function getOsMachineId() {
    // Linux: /etc/machine-id (Docker'da volume mount ile gelir)
    if (fs.existsSync(HOST_MACHINE_ID_FILE)) {
        return fs.readFileSync(HOST_MACHINE_ID_FILE, 'utf8').trim();
    }
    // Fallback: .env
    return (process.env.HOST_MACHINE_ID || '').trim();
}

function getSystemUuid() {
    // Linux: /sys/class/dmi/id/product_uuid (root gerektirir, setup.sh ile dosyaya yazılır)
    // Windows: wmic csproduct get uuid (setup.ps1 ile yazılır)
    if (fs.existsSync(HOST_SYSTEM_UUID_FILE)) {
        return fs.readFileSync(HOST_SYSTEM_UUID_FILE, 'utf8').trim();
    }
    return (process.env.HOST_SYSTEM_UUID || '').trim();
}

function getHostname() {
    return (process.env.HOST_HOSTNAME || os.hostname() || '').trim();
}

function getPlatform() {
    return process.platform === 'win32' ? 'windows' : 'linux';
}

// ── Ham Sinyaller ────────────────────────────────────────────
function collectRawSignals() {
    return {
        install_id:    getOrCreateInstallId(),
        os_machine_id: getOsMachineId(),
        system_uuid:   getSystemUuid(),
        hostname:      getHostname(),
    };
}

// ── Standart JSON Format (hash'lenmiş) ────────────────────────
function buildFingerprintJson() {
    const raw = collectRawSignals();
    return {
        fingerprint_version: FINGERPRINT_VERSION,
        type:                'docker-host',
        platform:            getPlatform(),
        generated_at:        new Date().toISOString(),
        signals: {
            install_id_hash:    sha256(raw.install_id),
            os_machine_id_hash: sha256(raw.os_machine_id),
            system_uuid_hash:   sha256(raw.system_uuid),
            hostname_hash:      sha256(raw.hostname),
        },
    };
}

// ── Skor Hesaplama ───────────────────────────────────────────
// current/licensed: fingerprint.json formatında nesneler
function scoreMatch(current, licensed) {
    if (!current?.signals || !licensed?.signals) {
        return { valid: false, score: 0, threshold: THRESHOLD, error: 'Eksik sinyal yapısı' };
    }
    const cur = current.signals;
    const lic = licensed.signals;

    const matches = {
        install_id:    !!(cur.install_id_hash    && lic.install_id_hash    && cur.install_id_hash    === lic.install_id_hash),
        os_machine_id: !!(cur.os_machine_id_hash && lic.os_machine_id_hash && cur.os_machine_id_hash === lic.os_machine_id_hash),
        system_uuid:   !!(cur.system_uuid_hash   && lic.system_uuid_hash   && cur.system_uuid_hash   === lic.system_uuid_hash),
        hostname:      !!(cur.hostname_hash      && lic.hostname_hash      && cur.hostname_hash      === lic.hostname_hash),
    };

    // Zorunlu sinyaller — biri bile eşleşmezse lisans geçersiz
    if (!matches.install_id || !matches.os_machine_id) {
        const missing = [];
        if (!matches.install_id)    missing.push('install_id');
        if (!matches.os_machine_id) missing.push('os_machine_id');
        return {
            valid:    false,
            score:    0,
            threshold: THRESHOLD,
            matches,
            missing,
            error:    `Zorunlu sinyal eşleşmedi: ${missing.join(', ')}`,
        };
    }

    let score = WEIGHTS.install_id.points + WEIGHTS.os_machine_id.points; // 8
    if (matches.system_uuid) score += WEIGHTS.system_uuid.points;          // +3 = 11

    return {
        valid:           score >= THRESHOLD,
        score,
        threshold:       THRESHOLD,
        matches,
        hostnameChanged: !matches.hostname,                                // sadece bilgi
    };
}

// ── Üst-seviye Doğrulama ─────────────────────────────────────
function verifyFingerprint(licensedFingerprint) {
    const current = buildFingerprintJson();
    const result  = scoreMatch(current, licensedFingerprint);

    // hostname değişikliği → uyarı, lisans bozulmaz
    if (result.valid && result.hostnameChanged) {
        console.warn('[Fingerprint] hostname değişmiş — lisans hâlâ geçerli (bilgi amaçlı).');
    }
    return { ...result, current };
}

module.exports = {
    FINGERPRINT_VERSION,
    WEIGHTS,
    THRESHOLD,
    buildFingerprintJson,
    collectRawSignals,
    scoreMatch,
    verifyFingerprint,
    getOrCreateInstallId,
    sha256,
};
