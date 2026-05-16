# Surum yayinlama

## Versiyonlama

- Monorepo versiyonu: `2.x.y-mainpaketler.z`
- Release oncesi `package.json` ve gerekli app/package versiyonlari guncellenir.

## Go / No-Go checklist

Release almadan once asagidaki kontroller PASS olmali:

1. Testler
- `node --test "tests/unit/*.test.js" "tests/integration/*.test.js" "tests/security/*.test.js"`

2. Customer package guvenlik kontrolu
- `node scripts/check-customer-package.js --scope=image` (image agacinda PASS olmali)
- Customer Docker build adiminda da bu kontrol otomatik calisir.

3. Merkezi akis smoke testi
- `npm.cmd run smoke:central-flow`
- Beklenen: `SUCCESS` logu

4. Docker buildler
- `docker build -f apps/customer/Dockerfile -t mailtrustai-customer:latest .`
- `docker build -f apps/license-server/Dockerfile -t mailtrustai-license-server:latest .`
- `docker build -f apps/dealer/Dockerfile -t mailtrustai-dealer:latest .`

5. Runtime health kontrolu
- Customer: `GET /api/health` -> `ok`
- Dealer: `GET /api/health` -> `ok`
- License-server: `GET /api/health` -> `ok`

## Security kontrol noktasi

- `LICENSE_SIGNING_SECRET`, `DEALER_API_SECRET`, `TOKEN_SECRET` production degerleri dogru mu
- Customer image icinde dealer/license-core/keygen kodlari fiziksel olarak yok mu
- `customer-sync` payload PII ve payload-size kurallari aktif mi (`422` / `413`)
- `customer-sync/pull` auth contract aktif mi (`customerId + licenseKeyHash + instanceId`)

## Git akis

1. Degisiklikleri branch'e commit et
2. `mainpackets` branch'ine push et
3. Gerekliyse mirror push:
- `git push origin mainpackets:mainpaketler`

## Release notu

Release notunda su basliklar mutlaka olmali:

- Ozellikler
- Guvenlik degisiklikleri
- Migration/konfig degisiklikleri
- Test ve smoke ozeti
- Bilinen riskler / manuel takip maddeleri
