-- 0013: licenses tablosuna extra_scans kolonu ekle (SQLite)
-- Bayi, aktif bir lisansa "ek tarama paketi" satın alarak bu değeri artırır.
-- Müşteri validate/activate yanıtında limits.monthlyScanCount = tier_kota + extra_scans döner.

ALTER TABLE licenses ADD COLUMN extra_scans INTEGER NOT NULL DEFAULT 0;
