-- 0017: Lisans bitiş bildirimi takip tablosu (MariaDB).

CREATE TABLE IF NOT EXISTS license_notifications (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    license_id   VARCHAR(128) NOT NULL,
    days_before  INT          NOT NULL,
    sent_at      BIGINT       NOT NULL,
    UNIQUE KEY idx_licnotif_uniq (license_id, days_before)
);
