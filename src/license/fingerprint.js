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

// Onceligi yuksekten dusuge: explicit volume → docker-compose mount → container icindeki dosya → env → null
function _firstReadable(paths) {
    for (const p of paths) {
        try { if (p && fs.existsSync(p)) { const v = fs.readFileSync(p, 'utf8').trim(); if (v) return v; } }
        catch (_) { /* yetki/erisim hatasi - sonrakine gec */ }
    }
    return '';
}

function getOsMachineId() {
    // Linux:
    //   1) data/host_machine_id   — kurulum scripti yazar (kalici)
    //   2) /host/machine-id       — docker-compose volume mount (ro)
    //   3) /etc/machine-id        — container kendi machine-id'si (recreate'te degisir)
    //   4) /var/lib/dbus/machine-id — eski sistemler
    //   5) HOST_MACHINE_ID env    — manuel override
    const v = _firstReadable([
        HOST_MACHINE_ID_FILE,
        '/host/machine-id',
        '/etc/machine-id',
        '/var/lib/dbus/machine-id'
    ]);
    return v || (process.env.HOST_MACHINE_ID || '').trim();
}

function getSystemUuid() {
    // Linux:
    //   1) data/host_system_uuid           — kurulum scripti yazar (kalici)
    //   2) /host/system-uuid               — docker-compose volume mount (root host'ta okur)
    //   3) /sys/class/dmi/id/product_uuid  — container icinden (her zaman erisilemez)
    //   4) HOST_SYSTEM_UUID env            — manuel override
    const v = _firstReadable([
        HOST_SYSTEM_UUID_FILE,
        '/host/system-uuid',
        '/sys/class/dmi/id/product_uuid'
    ]);
    return v || (process.env.HOST_SYSTEM_UUID || '').trim();
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

    // system_uuid lisansta kayıtlıydı ama şimdi eşleşmiyor → donanım değişimi olabilir
    const systemUuidChanged = !!(lic.system_uuid_hash && !matches.system_uuid);

    return {
        valid:             score >= THRESHOLD,
        score,
        threshold:         THRESHOLD,
        matches,
        hostnameChanged:   !matches.hostname,    // sadece bilgi
        systemUuidChanged,                        // sadece bilgi — lisansı bozmaz
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

    // system_uuid değişikliği → uyarı, lisans bozulmaz (opsiyonel sinyal)
    if (result.valid && result.systemUuidChanged) {
        const cur  = current.signals?.system_uuid_hash  || '(yok)';
        const lic  = licensedFingerprint?.signals?.system_uuid_hash || '(yok)';
        console.warn(
            '[Fingerprint] system_uuid değişti — donanım değişimi veya UUID okunamıyor.',
            `\n  Lisanstaki : ${lic}`,
            `\n  Şimdiki    : ${cur}`,
            '\n  Lisans hâlâ geçerli (opsiyonel sinyal).'
        );
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
