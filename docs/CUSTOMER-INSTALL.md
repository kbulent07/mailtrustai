# Customer kurulumu (self-hosted)

## Hızlı başlangıç (Docker)

```bash
cd apps/customer
cp .env.example .env
# .env dosyasını düzenle: MSA_LICENSE_KEY, MSA_LICENSE_REMOTE_URL, MSA_CENTRAL_SYNC_URL
docker compose up -d
```

Erişim: `http://<host>:3000`

## Önemli ortam değişkenleri

| Değişken | Açıklama |
|----------|----------|
| `MSA_LICENSE_REMOTE_URL`  | Merkezi license-server adresi (ör: `https://license.mailtrustai.com`) |
| `MSA_CENTRAL_SYNC_URL`    | Sync host'u (genelde aynı host) |
| `MSA_CENTRAL_SYNC_ENABLED`| `true` → heartbeat ve policy pull açık |
| `MSA_HEARTBEAT_INTERVAL_SECONDS` | Varsayılan 300 |
| `MSA_POLICY_SYNC_INTERVAL_SECONDS` | Varsayılan 900 |
| `MSA_LOCAL_ENCRYPTION_KEY`| API key'ler ve lisans cache'i için AES anahtarı (boşsa otomatik üretilir) |

## Image içeriği

Customer Dockerfile build adımında şunlar **fiziksel olarak silinir**:
`apps/dealer`, `apps/license-server`, `packages/license-core`, tüm bayi/keygen route ve store dosyaları, `public/bayi.html`, `public/keygen.html`.
Build sonunda `scripts/check-customer-package.js` çalıştırılır; bir ihlal bulursa build durur.
