# Merkezi sync akisi

## Endpoint listesi

- `POST /api/customer-sync/bootstrap` (customer -> server, ilk acilis)
- `POST /api/customer-sync/heartbeat` (customer -> server, periyodik)
- `GET /api/customer-sync/pull` (customer -> server, policy/list/api-policy guncelleme cekme)
- `POST /api/customer-sync/ack` (customer -> server, uygulanan guncellemeyi onay)

## Heartbeat payload prensibi

Customer tarafindan sadece operasyonel ve lisans odakli minimum veri gonderilir:

- license/customer/dealer/instance kimlikleri
- surum, plan, tier, status
- aggregate sayaclar (monthly/daily scan, mailbox, user)
- local version alanlari
- servis durumu ozeti
- kisa error summary

Mail body/subject, sender/recipient, attachment icerigi, credentials ve API key degerleri gonderilmez.

## Pull yetkilendirme kurali

`GET /api/customer-sync/pull` istegi su query alanlarini zorunlu ister:

- `customerId`
- `licenseKeyHash`
- `instanceId`

Server tarafi kontrol sirasi:

1. `licenseKeyHash` lisans tablosunda var mi
2. Bu lisansin `customerId` degeri query ile eslesiyor mu
3. Bu lisans + `instanceId` icin aktivasyon kaydi var mi

Hata kodlari:

- `400`: gerekli query alanlari eksik
- `403`: customer/lisans eslesmiyor veya aktivasyon yok
- `404`: `licenseKeyHash` bulunamadi

## Pull/ack davranisi

- Pull cevabi sadece versiyon farki olan bolumleri dondurur (`policy`, `lists`, `apiPolicy`).
- Customer guncellemeyi uyguladiktan sonra `POST /api/customer-sync/ack` ile onay gonderir.

## Retry ve dayaniklilik

`packages/central-sync` retry/backoff uygular. Merkez gecici ulasilamaz olsa bile customer uygulamasi local encrypted cache ile calismaya devam eder.
