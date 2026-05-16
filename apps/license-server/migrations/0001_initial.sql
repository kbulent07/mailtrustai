-- Initial schema (frozen). Yeni migration için 0002_*.sql ekleyin.

CREATE TABLE IF NOT EXISTS dealers (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    api_token_hash TEXT,
    credits INTEGER DEFAULT 0,
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    dealer_id TEXT,
    company_name TEXT,
    email TEXT,
    created_at INTEGER,
    FOREIGN KEY (dealer_id) REFERENCES dealers(id)
);

CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    dealer_id TEXT,
    license_key_hash TEXT NOT NULL UNIQUE,
    license_key_masked TEXT,
    plan TEXT NOT NULL,
    tier TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    issued_at INTEGER NOT NULL,
    expires_at INTEGER,
    grace_days INTEGER DEFAULT 1,
    features_json TEXT,
    limits_json TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS activations (
    id TEXT PRIMARY KEY,
    license_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    hostname_hash TEXT,
    app_version TEXT,
    build_version TEXT,
    node_version TEXT,
    environment TEXT,
    activated_at INTEGER NOT NULL,
    last_heartbeat_at INTEGER,
    last_payload_json TEXT,
    UNIQUE (license_id, instance_id),
    FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor TEXT,
    action TEXT,
    target TEXT,
    detail_json TEXT
);

CREATE TABLE IF NOT EXISTS policies (
    customer_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    body_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lists (
    customer_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    body_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (customer_id, kind)
);

CREATE TABLE IF NOT EXISTS api_policies (
    customer_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    body_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
