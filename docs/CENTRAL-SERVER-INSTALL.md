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
