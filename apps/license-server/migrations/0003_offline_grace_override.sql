-- 0003: licenses tablosuna offline_grace_days_override kolonu.
-- NULL = plan default kullan. Sayi > 0 = bu lisansa ozel offline (heartbeat'siz) calisma izni.
-- Admin paneli (keygen.html) tek bir lisans veya toplu olarak set edebilir.

ALTER TABLE licenses ADD COLUMN offline_grace_days_override INTEGER;

CREATE INDEX IF NOT EXISTS idx_licenses_offline_override ON licenses(offline_grace_days_override);
