-- 0010: Bayi kredi işlem kütüğü (MariaDB)

CREATE TABLE IF NOT EXISTS dealer_credit_log (
    id          VARCHAR(64)  PRIMARY KEY,
    dealer_id   VARCHAR(64)  NOT NULL,
    delta       INT          NOT NULL,
    balance     INT          NOT NULL,
    reason      VARCHAR(64),
    description VARCHAR(512),
    actor       VARCHAR(128),
    created_at  BIGINT       NOT NULL,
    INDEX idx_credit_log_dealer (dealer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
