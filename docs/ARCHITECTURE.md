# Mimari - mainpaketler (v2)

MailTrustAI ticari urun mimarisi 3 ayri uygulamaya ayrilmistir:

- `apps/customer` (`@mailtrustai/customer`) - self-hosted musteri uygulamasi
- `apps/dealer` (`@mailtrustai/dealer`) - bayi portali
- `apps/license-server` (`@mailtrustai/license-server`) - merkezi lisans ve policy sunucusu

Monorepo paylasilan paketleri:

- `packages/analyzer`
- `packages/mail`
- `packages/license-client`
- `packages/license-core` (customer image icine girmez)
- `packages/central-sync`
- `packages/policy-client`
- `packages/storage`
- `packages/security`
- `packages/shared`

## Veri akisi

Customer -> License Server:

- `POST /api/license/activate`
- `POST /api/license/validate`
- `POST /api/customer-sync/bootstrap`
- `POST /api/customer-sync/heartbeat`
- `GET /api/customer-sync/pull`
- `POST /api/customer-sync/ack`

Bayi -> License Server:

- `POST /api/license/create`
- `POST /api/license/renew`
- `POST /api/license/revoke`
- `GET /api/central/dealers/:dealerId/customers/status`

Musteri mail icerigi, attachment icerigi, credentials ve API key degerleri merkeze gonderilmez.

## Paket bagimlilik prensibi

- Customer app: `analyzer`, `mail`, `license-client`, `central-sync`, `policy-client`, `storage`, `security`, `shared`
- Bayi (dealer) app: `shared`, `security` (+ license-server HTTP API)
- License-server app: `license-core`, `shared`, `security`, `storage`

`license-core` customer image icine fiziksel olarak alinmaz. Dockerfile seviyesinde silinir ve
`scripts/check-customer-package.js --scope=image` ile build asamasinda denetlenir.

## Central Sync Auth Contract

`GET /api/customer-sync/pull` cagrisi su query alanlarini zorunlu ister:

- `customerId`
- `licenseKeyHash`
- `instanceId`

License-server dogrulama adimlari:

1. `licenseKeyHash` mevcut bir lisansa ait mi
2. Lisansin `customer_id` degeri query'deki `customerId` ile eslesiyor mu
3. Bu lisans + `instanceId` icin aktivasyon kaydi var mi

Hata kodlari:

- `400`: query alanlari eksik
- `403`: customer-lisans uyumsuz veya aktivasyon yok
- `404`: `licenseKeyHash` bulunamadi

Bu contract, baska bir customer kimligiyle merkezi policy/list cekimini engeller ve
yalnizca aktif instance baglaminda pull islemi yapilmasini zorunlu kilar.
