-- 0006 (SQLite): Cihaz transferi talepleri.
-- Bir lisans başka cihaza taşınmak istendiğinde bayi/admin onayı burada bekler.

CREATE TABLE IF NOT EXISTS transfer_requests (
    id TEXT PRIMARY KEY,
    license_id TEXT NOT NULL,
    old_hostname_hash TEXT,
    new_hostname_hash TEXT,
    new_instance_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT,
    reject_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_trq_license ON transfer_requests(license_id);
CREATE INDEX IF NOT EXISTS idx_trq_status  ON transfer_requests(status);
