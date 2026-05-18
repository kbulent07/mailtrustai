-- 0006 (MariaDB): Cihaz transferi talepleri.
-- Bir lisans başka cihaza taşınmak istendiğinde bayi/admin onayı burada bekler.

CREATE TABLE IF NOT EXISTS transfer_requests (
    id           VARCHAR(191) NOT NULL,
    license_id   VARCHAR(191) NOT NULL,
    old_hostname_hash VARCHAR(255) NULL,
    new_hostname_hash VARCHAR(255) NULL,
    new_instance_id   VARCHAR(191) NULL,
    status       VARCHAR(32)  NOT NULL DEFAULT 'pending',
    requested_at BIGINT       NOT NULL,
    resolved_at  BIGINT       NULL,
    resolved_by  VARCHAR(191) NULL,
    reject_reason VARCHAR(255) NULL,
    PRIMARY KEY (id),
    INDEX idx_trq_license (license_id),
    INDEX idx_trq_status  (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
