-- 0013: licenses tablosuna extra_scans kolonu ekle (MariaDB)

ALTER TABLE licenses
    ADD COLUMN extra_scans INT NOT NULL DEFAULT 0;
