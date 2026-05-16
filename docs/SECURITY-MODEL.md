# Güvenlik modeli

## Müşteri verisi merkeze gönderilmez

**ASLA gönderilmez:**
- mail body / subject / sender / recipient / raw headers
- attachment filename / content
- scan history detayları
- IMAP/SMTP username/password
- OpenAI / Claude / VirusTotal API key değerleri
- müşteri kullanıcı parolaları
- AI prompt / response içeriği

**Yalnızca operasyonel telemetri:** lisans hash'i, customer/dealer/instance ID'leri,
versiyonlar, sayaçlar, servis durumu boolean'ları, error summary (200 karakter).

## Üç savunma katmanı

1. **Kaynak**: `packages/central-sync` payload'u `scrubPII` filtresinden geçer.
2. **Network**: license-server `ensureNoPII` ile yasak alan görürse **422** ve audit.
3. **Image**: `apps/customer/Dockerfile` build adımında dealer/license-core/keygen dosyaları silinir; `scripts/check-customer-package.js` doğrular, ihlal → exit 1.

## Şifreleme

- **Local cache** (lisans, central policy, lists, api-policy): AES-256-GCM (`packages/security.encryptJSON`).
- **Anahtar**: `MSA_LOCAL_ENCRYPTION_KEY` env'inden; yoksa `data/.local-enc.key` (0o600).
- **Lisans imzalama**: HMAC-SHA256 (`LICENSE_SIGNING_SECRET`), `packages/license-core` + `src/license/license-generator.js`.
- **Dealer şifreleri**: bcrypt (cost 10), `dealers.api_token_hash`. Plain-text saklanmaz.

## License generator izolasyonu

`generateLicenseKey` ve `generateBatchKeys`'in **gerçek implementasyonu** `src/license/license-generator.js` ve `packages/license-core` içindedir. Customer Dockerfile build adımında bu iki dosya da silinir. `src/license/license.js` shim'i lazy-require kullanır — fonksiyon **çağrılırsa** `MODULE_NOT_FOUND` atar. Çağrı yolları zaten HARD-GATE ile 404 döner (`/api/license/{generate,trial}` admin-only), bu yüzden runtime'da çağrı oluşmaz.

## Auth

- Customer ↔ license-server: imzalı `licenseKey` (üç customer endpoint'i için public).
- Dealer ↔ license-server: `Bearer DEALER_API_TOKEN`.
- Admin endpoint'leri: aynı bearer (`DEALER_API_SECRET`).

## Risk noktaları

- `LICENSE_SIGNING_SECRET` sızarsa tüm lisanslar yeniden üretilmelidir.
- Dealer host'una IP allowlist + TLS terminator önerilir.
- Customer image'i `latest` etiketi yerine pinned digest ile dağıtılmalıdır.
