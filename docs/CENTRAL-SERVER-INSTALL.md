# Merkezi sunucu kurulumu (license-server + dealer)

Kurucu/satıcı kontrolündeki host üzerinde:

```bash
cp apps/license-server/.env.example apps/license-server/.env
cp apps/dealer/.env.example         apps/dealer/.env
# .env dosyalarını doldur (LICENSE_SIGNING_SECRET, DEALER_API_SECRET, DEALER_API_TOKEN, vb.)
docker compose -f docker-compose.server.yml up -d
```

Açık portlar:
- `:3200` — license-server (customer ve dealer bağlanır)
- `:3100` — dealer portalı (yalnızca operatöre açık olmalı; arkasına reverse proxy + IP allowlist)

Sırrılar:
- `LICENSE_SIGNING_SECRET` — lisans key'leri için HMAC seed. **Sızarsa tüm lisanslar yeniden imzalanmalı.**
- `DEALER_API_SECRET` — license-server admin/dealer bearer.
- `DEALER_API_TOKEN` — dealer app'in license-server'a istek atarken kullandığı bearer (aynı secret olabilir).

DB: `apps/license-server` içindeki SQLite dosyası `LICENSE_DB_PATH`'te tutulur; **bunu mutlaka yedekleyin**.

## Migration sistemi

`apps/license-server/migrations/` altındaki `NNNN_*.sql` dosyaları boot anında sırayla uygulanır. Uygulanmışlar `_migrations` tablosunda saklanır. Yeni şema değişikliği için bir sonraki numarayı ekleyin (`0002_*.sql`).

## İlk kurulum — bootstrap CLI

License-server container'ında:

```bash
# 1) Yeni bayi oluştur
node apps/license-server/bin/bootstrap.js create-dealer \
    --id dlr-01 --name "Bayi A" --email a@b.com

# 2) Bayi şifresi ayarla (bcrypt hash'i dealers.api_token_hash'e yazar)
node apps/license-server/bin/bootstrap.js set-dealer-password \
    --id dlr-01 --password "g1zl1-S1fr3"

# 3) Müşteri + lisans oluştur
node apps/license-server/bin/bootstrap.js create-license \
    --customerId cust-01 --dealerId dlr-01 --plan pro --validDays 365 \
    --companyName "ACME A.Ş."
# → Çıktıda licenseKey yazılır. Bu key müşteriye iletilir.

# 4) Listele
node apps/license-server/bin/bootstrap.js list-dealers
node apps/license-server/bin/bootstrap.js list-licenses
```

Dealer artık `http://<dealer-host>:3100/` adresindeki paneline `dealerId` + `password` ile login olabilir.

## Dealer auth akışı

```
Dealer Portal /api/dealer/login (username, password)
  → license-server /api/dealer/auth/verify (dealerId, password)
  → bcrypt.compare(password, dealers.api_token_hash)
  → ok → dealer panel HMAC-imzalı session cookie alır
```

Demo modu: `MSA_DEALER_AUTH_MODE=demo` + `DEALER_DEMO_USER/PASS` ile geçici geliştirme login'i (production'da KAPALI).
