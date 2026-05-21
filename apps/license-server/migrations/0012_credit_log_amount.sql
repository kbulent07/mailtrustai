-- 0012: dealer_credit_log tablosuna TRY tutar alanları ekle (SQLite)
-- Her harekette kaç TRY değerinde işlem yapıldığını saklar.
-- Eski satırlar için price_amount=0, currency='TRY' varsayılanı geçerlidir.

ALTER TABLE dealer_credit_log ADD COLUMN price_amount REAL    DEFAULT 0;
ALTER TABLE dealer_credit_log ADD COLUMN currency     TEXT    DEFAULT 'TRY';
