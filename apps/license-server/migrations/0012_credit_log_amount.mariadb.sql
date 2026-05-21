-- 0012: dealer_credit_log tablosuna TRY tutar alanları ekle (MariaDB)

ALTER TABLE dealer_credit_log
    ADD COLUMN price_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN currency     VARCHAR(8)    NOT NULL DEFAULT 'TRY';
