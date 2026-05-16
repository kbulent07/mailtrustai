CREATE TABLE IF NOT EXISTS dealers (
    id VARCHAR(191) PRIMARY KEY,
    name VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    api_token_hash TEXT NULL,
    credits INT NOT NULL DEFAULT 0,
    created_at BIGINT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(191) PRIMARY KEY,
    dealer_id VARCHAR(191) NULL,
    company_name VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    created_at BIGINT NULL,
    CONSTRAINT fk_customers_dealer
        FOREIGN KEY (dealer_id) REFERENCES dealers(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS licenses (
    id VARCHAR(191) PRIMARY KEY,
    customer_id VARCHAR(191) NOT NULL,
    dealer_id VARCHAR(191) NULL,
    license_key_hash VARCHAR(255) NOT NULL UNIQUE,
    license_key_masked VARCHAR(255) NULL,
    plan VARCHAR(64) NOT NULL,
    tier VARCHAR(64) NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'active',
    issued_at BIGINT NOT NULL,
    expires_at BIGINT NULL,
    grace_days INT NOT NULL DEFAULT 1,
    features_json LONGTEXT NULL,
    limits_json LONGTEXT NULL,
    CONSTRAINT fk_licenses_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_licenses_dealer
        FOREIGN KEY (dealer_id) REFERENCES dealers(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activations (
    id VARCHAR(191) PRIMARY KEY,
    license_id VARCHAR(191) NOT NULL,
    instance_id VARCHAR(191) NOT NULL,
    hostname_hash VARCHAR(255) NULL,
    app_version VARCHAR(128) NULL,
    build_version VARCHAR(128) NULL,
    node_version VARCHAR(64) NULL,
    environment VARCHAR(64) NULL,
    activated_at BIGINT NOT NULL,
    last_heartbeat_at BIGINT NULL,
    last_payload_json LONGTEXT NULL,
    UNIQUE KEY uq_activations_license_instance (license_id, instance_id),
    CONSTRAINT fk_activations_license
        FOREIGN KEY (license_id) REFERENCES licenses(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ts BIGINT NOT NULL,
    actor VARCHAR(255) NULL,
    action VARCHAR(255) NULL,
    target VARCHAR(255) NULL,
    detail_json LONGTEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS policies (
    customer_id VARCHAR(191) PRIMARY KEY,
    version INT NOT NULL DEFAULT 1,
    body_json LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lists (
    customer_id VARCHAR(191) NOT NULL,
    kind VARCHAR(64) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    body_json LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (customer_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_policies (
    customer_id VARCHAR(191) PRIMARY KEY,
    version INT NOT NULL DEFAULT 1,
    body_json LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
