-- activations tablosuna "ne zaman, kaç extra_scans iletildi" iz sütunları.
-- Yönetici/bayi, sunucu panelinden "müşteri bakiyeyi ne zaman çekti?" sorusunu
-- bu sütunlarla cevaplayabilir.

ALTER TABLE activations ADD COLUMN extra_scans_sent     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activations ADD COLUMN extra_scans_sent_at  INTEGER;
