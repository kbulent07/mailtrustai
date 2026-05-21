-- 0009: Fiyatlandırma planları (MariaDB)
-- Her plan + dönem + para birimi kombinasyonu için bir satır.
-- 1 tarama = 1 kredi.

CREATE TABLE IF NOT EXISTS pricing_plans (
    id                  VARCHAR(64)  PRIMARY KEY,
    plan                VARCHAR(32)  NOT NULL,
    billing_period      VARCHAR(16)  NOT NULL,
    currency            VARCHAR(8)   NOT NULL DEFAULT 'TRY',
    base_price          DOUBLE       NOT NULL DEFAULT 0,
    included_credits    INT          NOT NULL DEFAULT 0,
    extra_credit_price  DOUBLE       NOT NULL DEFAULT 0,
    notes               TEXT,
    is_active           TINYINT(1)   NOT NULL DEFAULT 1,
    updated_at          BIGINT       NOT NULL DEFAULT 0,
    updated_by          VARCHAR(128),
    UNIQUE KEY uq_plan_period_cur (plan, billing_period, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO pricing_plans
    (id, plan, billing_period, currency, base_price, included_credits, extra_credit_price, notes, is_active, updated_at)
VALUES
    ('pp-demo-m-try', 'demo',       'monthly', 'TRY',     0,    50,    0,    'Ücretsiz deneme paketi',            1, 0),
    ('pp-pro-m-try',  'pro',        'monthly', 'TRY',   999,   500,    2,    'Pro aylık lisans',                  1, 0),
    ('pp-pro-a-try',  'pro',        'annual',  'TRY',  9990,  6000,  1.5,   'Pro yıllık lisans (2 ay hediye)',   1, 0),
    ('pp-ent-m-try',  'enterprise', 'monthly', 'TRY',  1199,  2000,    1,   'Enterprise aylık lisans',           1, 0),
    ('pp-ent-a-try',  'enterprise', 'annual',  'TRY', 11990, 24000, 0.75,   'Enterprise yıllık lisans',          1, 0);

INSERT IGNORE INTO admin_settings(setting_key, setting_value, updated_at)
VALUES
    ('pricing_enterprise_multiplier', '1.20',   0),
    ('pricing_credit_unit',           'tarama', 0);
