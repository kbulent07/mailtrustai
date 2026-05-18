-- 0005 (MariaDB): customers tablosuna fatura/iletişim/adres alanları.

ALTER TABLE customers
    ADD COLUMN tax_office     VARCHAR(128) NULL,
    ADD COLUMN tax_number     VARCHAR(64)  NULL,
    ADD COLUMN billing_address TEXT        NULL,
    ADD COLUMN contact_name   VARCHAR(128) NULL,
    ADD COLUMN contact_email  VARCHAR(255) NULL,
    ADD COLUMN contact_phone  VARCHAR(64)  NULL,
    ADD COLUMN address        TEXT         NULL,
    ADD COLUMN phone          VARCHAR(64)  NULL;
