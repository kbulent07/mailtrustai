-- 0011 (SQLite): heartbeat_log — her heartbeat isteğinin geçmiş kaydı.
-- activations tablosu yalnızca EN SON durumu tutar (UPSERT).
-- Bu tablo her heartbeat'i ayrı satır olarak arşivler (5+ yıllık geçmiş).

CREATE TABLE IF NOT EXISTS heartbeat_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id      TEXT    NOT NULL,
    instance_id     TEXT    NOT NULL,
    ts              INTEGER NOT NULL,           -- Unix ms (Date.now())
    app_version     TEXT,
    environment     TEXT,
    health_status   TEXT,
    payload_json    TEXT                        -- safePayload JSON (whitelist)
);

CREATE INDEX IF NOT EXISTS idx_hblog_license_ts  ON heartbeat_log(license_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_hblog_instance_ts ON heartbeat_log(license_id, instance_id, ts DESC);
