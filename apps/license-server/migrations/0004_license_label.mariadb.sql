-- 0004 (MariaDB): licenses.label kolonu.

ALTER TABLE licenses ADD COLUMN label VARCHAR(128) NULL;
