-- 0004: licenses tablosuna label (etiket) kolonu.
-- Bir müşteri (customer) birden fazla lisans satın alabilir
-- (örn. "Üretim", "Test", "Yedek", "Şube-İstanbul" vs.).
-- Label admin panelinden veya dealer create sırasinda atanir.
-- NULL = etiketsiz (sadece license_key_masked görünür).

ALTER TABLE licenses ADD COLUMN label TEXT;
