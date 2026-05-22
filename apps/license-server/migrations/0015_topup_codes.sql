-- Tek kullanımlık ek tarama paketi kodları.
-- Bayi bir kod üretir (1 kredi kesilir), müşteriye verir.
-- Müşteri kodu kendi panelinden girer → extra_scans eklenir.

CREATE TABLE IF NOT EXISTS topup_codes (
    id                  TEXT    PRIMARY KEY,
    code                TEXT    NOT NULL UNIQUE,          -- XXXX-XXXX formatı
    dealer_id           TEXT    NOT NULL,
    customer_id         TEXT,                             -- NULL = bayinin herhangi müşterisi
    tier                TEXT    NOT NULL,
    scan_amount         INTEGER NOT NULL,
    expires_at          INTEGER,                          -- NULL = süresiz
    used                INTEGER NOT NULL DEFAULT 0,       -- 0/1
    used_by_license_id  TEXT,
    used_at             INTEGER,
    created_at          INTEGER NOT NULL,
    FOREIGN KEY (dealer_id) REFERENCES dealers(id)
);

CREATE INDEX IF NOT EXISTS idx_topup_codes_dealer   ON topup_codes(dealer_id);
CREATE INDEX IF NOT EXISTS idx_topup_codes_customer ON topup_codes(customer_id);
