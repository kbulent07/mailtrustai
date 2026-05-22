-- 0016: Plan × Tier fiyat matrisi (SQLite)
-- Yeni lisans modeli: plan (pro/enterprise) özellikleri, tier (T1–T8) kapasiteyi belirler.
-- Her (plan, tier, dönem, para birimi) kombinasyonu bir satır = satılabilir ürün.
-- T9 (Özel/Custom) yalnız admin tarafından üretilir; sabit fiyatı yoktur, matrise dahil edilmez.
-- Tier kredi maliyeti license-core TIER_MATRIX'ten gelir (DB'de tutulmaz).

CREATE TABLE IF NOT EXISTS tier_pricing (
    id              TEXT    PRIMARY KEY,
    plan            TEXT    NOT NULL,                -- 'pro' | 'enterprise'
    tier            TEXT    NOT NULL,                -- 'T1'..'T8'
    billing_period  TEXT    NOT NULL,                -- 'monthly' | 'annual'
    currency        TEXT    NOT NULL DEFAULT 'TRY',
    price           REAL    NOT NULL DEFAULT 0,      -- dönemlik liste fiyatı
    is_active       INTEGER NOT NULL DEFAULT 1,
    notes           TEXT,
    updated_at      INTEGER NOT NULL DEFAULT 0,
    updated_by      TEXT,
    UNIQUE(plan, tier, billing_period, currency)
);

CREATE INDEX IF NOT EXISTS idx_tier_pricing_plan ON tier_pricing(plan, tier);

-- Varsayılan fiyat matrisi (placeholder; admin panelinden düzenlenir).
-- Yıllık ≈ aylık × 10 (2 ay hediye mantığı).
INSERT OR IGNORE INTO tier_pricing
    (id, plan, tier, billing_period, currency, price, is_active, updated_at)
VALUES
    -- Pro — aylık
    ('tp-pro-t1-m-try', 'pro', 'T1', 'monthly', 'TRY',   199, 1, 0),
    ('tp-pro-t2-m-try', 'pro', 'T2', 'monthly', 'TRY',   349, 1, 0),
    ('tp-pro-t3-m-try', 'pro', 'T3', 'monthly', 'TRY',   599, 1, 0),
    ('tp-pro-t4-m-try', 'pro', 'T4', 'monthly', 'TRY',   999, 1, 0),
    ('tp-pro-t5-m-try', 'pro', 'T5', 'monthly', 'TRY',  1499, 1, 0),
    ('tp-pro-t6-m-try', 'pro', 'T6', 'monthly', 'TRY',  2499, 1, 0),
    ('tp-pro-t7-m-try', 'pro', 'T7', 'monthly', 'TRY',  3999, 1, 0),
    ('tp-pro-t8-m-try', 'pro', 'T8', 'monthly', 'TRY',  6999, 1, 0),
    -- Pro — yıllık
    ('tp-pro-t1-a-try', 'pro', 'T1', 'annual',  'TRY',  1990, 1, 0),
    ('tp-pro-t2-a-try', 'pro', 'T2', 'annual',  'TRY',  3490, 1, 0),
    ('tp-pro-t3-a-try', 'pro', 'T3', 'annual',  'TRY',  5990, 1, 0),
    ('tp-pro-t4-a-try', 'pro', 'T4', 'annual',  'TRY',  9990, 1, 0),
    ('tp-pro-t5-a-try', 'pro', 'T5', 'annual',  'TRY', 14990, 1, 0),
    ('tp-pro-t6-a-try', 'pro', 'T6', 'annual',  'TRY', 24990, 1, 0),
    ('tp-pro-t7-a-try', 'pro', 'T7', 'annual',  'TRY', 39990, 1, 0),
    ('tp-pro-t8-a-try', 'pro', 'T8', 'annual',  'TRY', 69990, 1, 0),
    -- Enterprise — aylık
    ('tp-ent-t1-m-try', 'enterprise', 'T1', 'monthly', 'TRY',   299, 1, 0),
    ('tp-ent-t2-m-try', 'enterprise', 'T2', 'monthly', 'TRY',   499, 1, 0),
    ('tp-ent-t3-m-try', 'enterprise', 'T3', 'monthly', 'TRY',   899, 1, 0),
    ('tp-ent-t4-m-try', 'enterprise', 'T4', 'monthly', 'TRY',  1499, 1, 0),
    ('tp-ent-t5-m-try', 'enterprise', 'T5', 'monthly', 'TRY',  2249, 1, 0),
    ('tp-ent-t6-m-try', 'enterprise', 'T6', 'monthly', 'TRY',  3749, 1, 0),
    ('tp-ent-t7-m-try', 'enterprise', 'T7', 'monthly', 'TRY',  5999, 1, 0),
    ('tp-ent-t8-m-try', 'enterprise', 'T8', 'monthly', 'TRY',  9999, 1, 0),
    -- Enterprise — yıllık
    ('tp-ent-t1-a-try', 'enterprise', 'T1', 'annual', 'TRY',  2990, 1, 0),
    ('tp-ent-t2-a-try', 'enterprise', 'T2', 'annual', 'TRY',  4990, 1, 0),
    ('tp-ent-t3-a-try', 'enterprise', 'T3', 'annual', 'TRY',  8990, 1, 0),
    ('tp-ent-t4-a-try', 'enterprise', 'T4', 'annual', 'TRY', 14990, 1, 0),
    ('tp-ent-t5-a-try', 'enterprise', 'T5', 'annual', 'TRY', 22490, 1, 0),
    ('tp-ent-t6-a-try', 'enterprise', 'T6', 'annual', 'TRY', 37490, 1, 0),
    ('tp-ent-t7-a-try', 'enterprise', 'T7', 'annual', 'TRY', 59990, 1, 0),
    ('tp-ent-t8-a-try', 'enterprise', 'T8', 'annual', 'TRY', 99990, 1, 0);
