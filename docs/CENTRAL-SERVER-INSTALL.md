# Merkezi sunucu kurulumu (license-server + dealer + MariaDB)

Kurucu/satici kontrolundeki host uzerinde:

```bash
cp apps/license-server/.env.example apps/license-server/.env
cp apps/dealer/.env.example         apps/dealer/.env
# .env dosyalarini doldur (LICENSE_SIGNING_SECRET, DEALER_API_SECRET, DEALER_API_TOKEN, vb.)
docker compose -f docker-compose.server.yml up -d
```

Acik portlar:
- `:3200` - license-server (customer ve dealer baglanir)
- `:3100` - dealer portali (yalnizca operatore acik olmali; reverse proxy + IP allowlist onerilir)
- `:3306` - MariaDB (internetten dogrudan acmayin)

Sirlar:
- `LICENSE_SIGNING_SECRET` - lisans key'leri icin HMAC seed. Sizarsa tum lisanslar yeniden imzalanmalidir.
- `DEALER_API_SECRET` - license-server admin/dealer bearer.
- `DEALER_API_TOKEN` - dealer app'in license-server'a istek atarken kullandigi bearer.

DB:
- Merkezi veritabani **MariaDB**'dir.
- Kalici veri yolu: `./data/mariadb:/var/lib/mysql`
- Duzenli yedek alin (logical dump + volume snapshot).

## Migration sistemi

`apps/license-server/migrations/` altindaki dosyalar boot aninda uygulanir:
- SQLite dosyalari: `NNNN_*.sql`
- MariaDB dosyalari: `NNNN_*.mariadb.sql`

MariaDB modunda sadece `*.mariadb.sql` migration'lari kullanilir ve uygulananlar `_migrations` tablosunda tutulur.

## Ilk kurulum - bootstrap CLI

License-server container'inda:

```bash
# 1) Yeni bayi olustur
node apps/license-server/bin/bootstrap.js create-dealer \
    --id dlr-01 --name "Bayi A" --email a@b.com

# 2) Bayi sifresi ayarla (bcrypt hash'i dealers.api_token_hash'e yazar)
node apps/license-server/bin/bootstrap.js set-dealer-password \
    --id dlr-01 --password "g1zl1-S1fr3"

# 3) Musteri + lisans olustur
node apps/license-server/bin/bootstrap.js create-license \
    --customerId cust-01 --dealerId dlr-01 --plan pro --validDays 365 \
    --companyName "ACME A.S."
# -> Ciktida licenseKey yazilir. Bu key musteride aktivasyon icin kullanilir.

# 4) Listele
node apps/license-server/bin/bootstrap.js list-dealers
node apps/license-server/bin/bootstrap.js list-licenses
```

Bayi artik `http://<dealer-host>:3100/` adresindeki paneline `dealerId` + `password` ile login olabilir.

## Bayi auth akisi

```text
Bayi Portal /api/dealer/login (username, password)
  -> license-server /api/dealer/auth/verify (dealerId, password)
  -> bcrypt.compare(password, dealers.api_token_hash)
  -> ok -> dealer panel HMAC-imzali session cookie alir
```

Demo modu:
- `MSA_DEALER_AUTH_MODE=demo`
- `DEALER_DEMO_USER` / `DEALER_DEMO_PASS`

Production'da demo modunu kapali tutun.
