-- 0007: Admin panel ayarları (key-value).
-- ADMIN_PANEL_TOKEN env ile sabit kalıyordu; owner'ın panel giriş şifresini
-- UI'dan değiştirebilmesi için hash'lenmiş şifre burada saklanır.
--   setting_key = 'admin_password_hash' → bcrypt hash
-- Env token her zaman geçerli kalır (break-glass / kurtarma).

CREATE TABLE IF NOT EXISTS admin_settings (
    setting_key   TEXT PRIMARY KEY,
    setting_value TEXT,
    updated_at    INTEGER
);
