-- 0008 (MariaDB): owner_users — merkezi panel RBAC kullanıcıları.

CREATE TABLE IF NOT EXISTS owner_users (
    id          VARCHAR(64) PRIMARY KEY,
    email       VARCHAR(190) UNIQUE NOT NULL,
    pwd_hash    VARCHAR(255) NOT NULL,
    role        VARCHAR(32) NOT NULL,
    active      TINYINT(1) DEFAULT 1,
    created_at  BIGINT,
    last_login  BIGINT
);
