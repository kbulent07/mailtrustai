-- Tek kullanımlık ek tarama paketi kodları.

CREATE TABLE IF NOT EXISTS topup_codes (
    id                  VARCHAR(36)  NOT NULL PRIMARY KEY,
    code                VARCHAR(12)  NOT NULL UNIQUE,
    dealer_id           VARCHAR(128) NOT NULL,
    customer_id         VARCHAR(128) DEFAULT NULL,
    tier                VARCHAR(8)   NOT NULL,
    scan_amount         INT          NOT NULL,
    expires_at          BIGINT       DEFAULT NULL,
    used                TINYINT      NOT NULL DEFAULT 0,
    used_by_license_id  VARCHAR(36)  DEFAULT NULL,
    used_at             BIGINT       DEFAULT NULL,
    created_at          BIGINT       NOT NULL,
    FOREIGN KEY (dealer_id) REFERENCES dealers(id)
);

CREATE INDEX idx_topup_codes_dealer   ON topup_codes(dealer_id);
CREATE INDEX idx_topup_codes_customer ON topup_codes(customer_id);
