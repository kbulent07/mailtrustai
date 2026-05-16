# Lisans akışı

## Endpoint'ler

| Endpoint | Auth | Kullanıcı |
|----------|------|-----------|
| `POST /api/license/create`   | Admin/Dealer Bearer | dealer veya admin |
| `POST /api/license/activate` | public | customer |
| `POST /api/license/validate` | public | customer (periyodik) |
| `POST /api/license/heartbeat`| public | customer |
| `POST /api/license/revoke`   | Admin Bearer | admin |
| `POST /api/license/renew`    | Admin Bearer | admin |
| `GET  /api/license/customer/:id` | Admin Bearer | admin |
| `GET  /api/license/audit`        | Admin Bearer | admin |

## Akış

1. **Üretim (dealer)** → `POST /api/license/create { customerId, dealerId, plan, validDays }` → license-server `license-core.generateLicenseKey()` ile HMAC-imzalı key üretir, `licenses` tablosuna yazar.
2. **Aktivasyon (customer)** → ilk açılışta `POST /api/license/activate { licenseKey, instanceId, appVersion, ... }` → license-server `activations` kaydı oluşturur, plan/features/limits döner. Customer bunu AES-256-GCM ile şifreli local cache'e yazar.
3. **Doğrulama (customer, periyodik)** → `POST /api/license/validate { licenseKeyHash, instanceId }` → durum güncellenir.
4. **Heartbeat** → `POST /api/license/heartbeat` veya `POST /api/customer-sync/heartbeat` (zenginleştirilmiş telemetri).
5. **Revoke/Renew** — admin/dealer panelinden.

## Grace period

Customer license-server'a erişemediğinde son başarılı `validate` zamanına göre çalışmaya devam eder:

| Plan | Grace gün |
|------|-----------|
| demo | 1 |
| pro  | 3 |
| enterprise | 7 |

Grace dolduğunda analiz durur, panel uyarı moduna geçer.
