-- 0007 (MariaDB): admin_settings key-value tablosu.
-- Owner'ın panel giriş şifresini (bcrypt hash) saklar; env token break-glass kalır.

CREATE TABLE IF NOT EXISTS admin_settings (
    setting_key   VARCHAR(64) PRIMARY KEY,
    setting_value TEXT,
    updated_at    BIGINT
);
