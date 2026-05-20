-- 0008: Owner (merkezi panel) kullanıcıları — rol bazlı erişim (RBAC).
-- Roller: 'super-admin' (her şey + kullanıcı yönetimi),
--         'admin'       (müşteri/bayi/lisans/transfer; kullanıcı yönetimi yok),
--         'muhasebe'    (müşteri+lisans+fatura SALT-OKUNUR),
--         'support'     (müşteri görüntüleme + transfer onay/red + audit).
-- ADMIN_PANEL_TOKEN (env) her zaman super-admin kurtarma (break-glass) kalır.

CREATE TABLE IF NOT EXISTS owner_users (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    pwd_hash    TEXT NOT NULL,
    role        TEXT NOT NULL,
    active      INTEGER DEFAULT 1,
    created_at  INTEGER,
    last_login  INTEGER
);
