-- 0011 (MariaDB): heartbeat_log — her heartbeat isteğinin geçmiş kaydı.

CREATE TABLE IF NOT EXISTS heartbeat_log (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    license_id      VARCHAR(64)  NOT NULL,
    instance_id     VARCHAR(128) NOT NULL,
    ts              BIGINT       NOT NULL,
    app_version     VARCHAR(64),
    environment     VARCHAR(64),
    health_status   VARCHAR(64),
    payload_json    TEXT,
    INDEX idx_hblog_license_ts  (license_id, ts DESC),
    INDEX idx_hblog_instance_ts (license_id, instance_id, ts DESC)
);
