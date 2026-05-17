-- 0002: Sık kullanılan sorgular için index'ler. Idempotent (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_licenses_customer_status ON licenses(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_licenses_dealer        ON licenses(dealer_id);
CREATE INDEX IF NOT EXISTS idx_activations_license   ON activations(license_id);
CREATE INDEX IF NOT EXISTS idx_activations_hb        ON activations(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_audit_ts              ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_customers_dealer      ON customers(dealer_id);
CREATE INDEX IF NOT EXISTS idx_policies_updated      ON policies(updated_at);
CREATE INDEX IF NOT EXISTS idx_lists_updated         ON lists(updated_at);
CREATE INDEX IF NOT EXISTS idx_api_policies_updated  ON api_policies(updated_at);
