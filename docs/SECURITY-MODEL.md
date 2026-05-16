# Guvenlik modeli

## Musteri verisi merkeze gonderilmez

Asla gonderilmez:
- mail body / subject / sender / recipient / raw headers
- attachment filename / content
- scan history detaylari
- IMAP/SMTP username/password
- OpenAI / Claude / VirusTotal API key degerleri
- musteri kullanici parolalari
- AI prompt / response icerigi

Sadece operasyonel telemetri:
- license hash
- customer/dealer/instance ID
- versiyonlar
- sayaclar
- servis durum ozetleri
- sinirli error summary

## Savunma katmanlari

1. Source: `packages/central-sync` tarafinda payload once PII scrub ve sonra allowlist filtresinden gecer.
2. Network: `license-server` `ensureNoPII` kontrolunde yasak alan gorurse `422` doner ve audit yazar.
3. Payload size: `CUSTOMER_SYNC_MAX_PAYLOAD_BYTES` (default `16384`) asilirsa customer-sync heartbeat/bootstrap `413` doner.
4. Image: `apps/customer/Dockerfile` build adiminda dealer/license-core/keygen dosyalari silinir, `scripts/check-customer-package.js --scope=image` ihlal varsa build'i durdurur.

## Sifreleme

- Local cache (lisans, central policy, lists, api-policy): AES-256-GCM (`packages/security.encryptJSON`)
- Anahtar: `MSA_LOCAL_ENCRYPTION_KEY` env veya `data/.local-enc.key` (0600)
- Lisans imzalama: HMAC-SHA256 (`LICENSE_SIGNING_SECRET`)
- Dealer sifreleri: bcrypt hash olarak saklanir

## Kimlik dogrulama

- Customer -> license-server: lisans aktivasyon/dogrulama/heartbeat endpointleri
- Dealer -> license-server: `Bearer DEALER_API_TOKEN`
- Admin endpointleri: `DEALER_API_SECRET` / `TOKEN_SECRET`
