-- 0009: Fiyatlandırma planları (SQLite)
-- Her plan + dönem + para birimi kombinasyonu için bir satır.
-- 1 tarama = 1 kredi (price_per_credit ve included_credits bu temelde hesaplanır).
-- Enterprise çarpanı admin_settings.pricing_enterprise_multiplier'dan okunur.

CREATE TABLE IF NOT EXISTS pricing_plans (
    id                  TEXT    PRIMARY KEY,
    plan                TEXT    NOT NULL,                -- 'demo' | 'pro' | 'enterprise'
    billing_period      TEXT    NOT NULL,                -- 'monthly' | 'annual'
    currency            TEXT    NOT NULL DEFAULT 'TRY',
    base_price          REAL    NOT NULL DEFAULT 0,      -- dönemlik lisans ücreti
    included_credits    INTEGER NOT NULL DEFAULT 0,      -- pakete dahil tarama/kredi sayısı
    extra_credit_price  REAL    NOT NULL DEFAULT 0,      -- ek her kredi (=tarama) birim fiyatı
    notes               TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    updated_at          INTEGER NOT NULL DEFAULT 0,
    updated_by          TEXT,
    UNIQUE(plan, billing_period, currency)
);

-- Varsayılan fiyat verileri (ilk kurulumda eklenir; mevcut kayıtlar korunur)
INSERT OR IGNORE INTO pricing_plans
    (id, plan, billing_period, currency, base_price, included_credits, extra_credit_price, notes, is_active, updated_at)
VALUES
    ('pp-demo-m-try', 'demo',       'monthly', 'TRY',     0,    50,    0,    'Ücretsiz deneme paketi',            1, 0),
    ('pp-pro-m-try',  'pro',        'monthly', 'TRY',   999,   500,    2,    'Pro aylık lisans',                  1, 0),
    ('pp-pro-a-try',  'pro',        'annual',  'TRY',  9990,  6000,  1.5,   'Pro yıllık lisans (2 ay hediye)',   1, 0),
    ('pp-ent-m-try',  'enterprise', 'monthly', 'TRY',  1199,  2000,    1,   'Enterprise aylık lisans',           1, 0),
    ('pp-ent-a-try',  'enterprise', 'annual',  'TRY', 11990, 24000, 0.75,   'Enterprise yıllık lisans',          1, 0);

-- Fiyatlandırma genel ayarları
INSERT OR IGNORE INTO admin_settings(setting_key, setting_value, updated_at)
VALUES
    ('pricing_enterprise_multiplier', '1.20',    0),
    ('pricing_credit_unit',           'tarama',  0);
