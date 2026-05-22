-- activations tablosuna "ne zaman, kaç extra_scans iletildi" iz sütunları.

ALTER TABLE activations
    ADD COLUMN extra_scans_sent    INT          NOT NULL DEFAULT 0,
    ADD COLUMN extra_scans_sent_at BIGINT       DEFAULT NULL;
