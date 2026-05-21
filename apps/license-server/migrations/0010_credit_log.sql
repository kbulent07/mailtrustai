-- 0010: Bayi kredi işlem kütüğü (SQLite)
-- Her kredi hareketi (yükleme, lisans kesintisi, hata iadesi) burada saklanır.
-- dealer_credit_log.balance = işlem anındaki bakiye snapshot'ı.

CREATE TABLE IF NOT EXISTS dealer_credit_log (
    id          TEXT    PRIMARY KEY,
    dealer_id   TEXT    NOT NULL,
    delta       INTEGER NOT NULL,   -- pozitif=ekleme, negatif=düşme
    balance     INTEGER NOT NULL,   -- işlem sonrası bakiye
    reason      TEXT,               -- 'load' | 'license.create' | 'manual.deduct' | 'error.refund'
    description TEXT,               -- admin/sistem açıklaması
    actor       TEXT,               -- işlemi yapan (admin email veya 'system')
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_log_dealer ON dealer_credit_log(dealer_id, created_at DESC);
