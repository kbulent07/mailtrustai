-- 0017: Lisans bitiş bildirimi takip tablosu.
-- Her lisans × kaç gün önce kombinasyonu için sadece bir kez bildirim gönderilir.

CREATE TABLE IF NOT EXISTS license_notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id   TEXT    NOT NULL,
    days_before  INTEGER NOT NULL,
    sent_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licnotif_uniq
    ON license_notifications(license_id, days_before);
