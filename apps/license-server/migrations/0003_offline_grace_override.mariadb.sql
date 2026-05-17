-- 0003 (MariaDB): offline_grace_days_override kolonu.

ALTER TABLE licenses ADD COLUMN offline_grace_days_override INT NULL;

CREATE INDEX idx_licenses_offline_override ON licenses(offline_grace_days_override);
