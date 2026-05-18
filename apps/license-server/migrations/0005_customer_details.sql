-- 0005 (SQLite): customers tablosuna fatura/iletişim/adres alanları.

ALTER TABLE customers ADD COLUMN tax_office TEXT NULL;
ALTER TABLE customers ADD COLUMN tax_number TEXT NULL;
ALTER TABLE customers ADD COLUMN billing_address TEXT NULL;
ALTER TABLE customers ADD COLUMN contact_name TEXT NULL;
ALTER TABLE customers ADD COLUMN contact_email TEXT NULL;
ALTER TABLE customers ADD COLUMN contact_phone TEXT NULL;
ALTER TABLE customers ADD COLUMN address TEXT NULL;
ALTER TABLE customers ADD COLUMN phone TEXT NULL;
