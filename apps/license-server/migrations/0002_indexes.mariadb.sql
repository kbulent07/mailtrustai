-- 0002 (MariaDB): index'ler. Migration runner _migrations ile takip eder,
-- bu yüzden tekrar çalıştırılmaz; CREATE INDEX kullanmak güvenlidir.

CREATE INDEX idx_licenses_customer_status ON licenses(customer_id, status);
CREATE INDEX idx_licenses_dealer        ON licenses(dealer_id);
CREATE INDEX idx_activations_license   ON activations(license_id);
CREATE INDEX idx_activations_hb        ON activations(last_heartbeat_at);
CREATE INDEX idx_audit_ts              ON audit_log(ts);
CREATE INDEX idx_customers_dealer      ON customers(dealer_id);
CREATE INDEX idx_policies_updated      ON policies(updated_at);
CREATE INDEX idx_lists_updated         ON lists(updated_at);
CREATE INDEX idx_api_policies_updated  ON api_policies(updated_at);
