# Sürüm yayınlama

## Sürüm numarası
Tüm paketler `version: 2.0.0-mainpaketler.0` ile yayınlanır. Patch bump yapın (örn. `2.0.1`).

## Build adımları

```bash
# Müşteri (her release için sıfırdan)
npm run check:customer-package   # önce kaynak kontrolü için bilgi (FAIL beklenir kök repoda)
npm run build:customer           # Docker build içinde check otomatik çalışır

# Server tarafı
npm run build:license
npm run build:dealer
```

## Testler

```bash
npm test    # unit + integration + security
```

Tüm testler **PASS** olmalı.
`tests/security/customer-image-no-keygen.test.js` özellikle önemli — bu fail olursa **release durur**.

## Manuel kontrol noktaları
- License signing secret rotated?
- Dealer bearer token rotated?
- DB yedek alındı mı?
- CHANGELOG güncel mi?
