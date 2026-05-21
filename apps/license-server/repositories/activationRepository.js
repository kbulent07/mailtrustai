'use strict';
// =============================================================
// ActivationRepository — activations tablosu (license × instance) için erişim.
// Aynı (license_id, instance_id) çiftinde yeniden aktivasyon idempotent
// olmalıdır: heartbeat/version bilgisi güncellenir, yeni satır eklenmez.
// =============================================================
const { get, run, upsert } = require('../db');

const UPSERT_COLS = [
    'id', 'license_id', 'instance_id', 'hostname_hash',
    'app_version', 'build_version', 'node_version', 'environment',
    'activated_at', 'last_heartbeat_at'
];
const UPSERT_UPDATE = [
    'hostname_hash', 'app_version', 'build_version', 'node_version', 'environment', 'last_heartbeat_at'
];

async function upsertActivation(record) {
    const row = {};
    for (const c of UPSERT_COLS) row[c] = record[c] !== undefined ? record[c] : null;
    if (!row.id || !row.license_id || !row.instance_id) {
        throw new Error('activationRepository.upsertActivation: id, license_id, instance_id zorunlu');
    }
    if (!row.activated_at) row.activated_at = Date.now();
    if (!row.last_heartbeat_at) row.last_heartbeat_at = row.activated_at;
    return upsert('activations', row, {
        keys: ['license_id', 'instance_id'],
        update: UPSERT_UPDATE
    });
}

async function findByLicenseAndInstance(licenseId, instanceId) {
    return get('SELECT id FROM activations WHERE license_id=? AND instance_id=?', [licenseId, instanceId]);
}

async function countByLicense(licenseId) {
    const row = await get('SELECT COUNT(*) AS c FROM activations WHERE license_id=?', [licenseId]);
    return row?.c || 0;
}

/**
 * Aktivasyon limit aşımı durumunda son N saniyede eklenen yeni satırı geri al.
 * Idempotent UPSERT senaryosunda mevcut satırlar (limit içindeyken eklenenler)
 * korunur; yalnızca limit aşımına neden olan yeni satır silinir.
 */
async function deleteRecentByInstance(licenseId, instanceId, withinMs = 5000) {
    return run(
        'DELETE FROM activations WHERE license_id=? AND instance_id=? AND activated_at>=?',
        [licenseId, instanceId, Date.now() - withinMs]
    );
}

async function updateHeartbeat(licenseId, instanceId, payloadJson) {
    return run(
        'UPDATE activations SET last_heartbeat_at=?, last_payload_json=? WHERE license_id=? AND instance_id=?',
        [Date.now(), payloadJson, licenseId, instanceId]
    );
}

module.exports = {
    upsertActivation,
    findByLicenseAndInstance,
    countByLicense,
    deleteRecentByInstance,
    updateHeartbeat
};
