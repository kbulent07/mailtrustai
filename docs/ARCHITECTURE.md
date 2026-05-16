# Mimari — `mainpaketler` (v2)

MailTrustAI ticari ürün mimarisi 3 ayrı pakete bölünmüştür:

```
mailtrustai/
├── apps/
│   ├── customer/          # @mailtrustai/customer       — self-hosted müşteri
│   ├── dealer/            # @mailtrustai/dealer         — bayi portalı
│   └── license-server/    # @mailtrustai/license-server — merkezi sunucu
└── packages/
    ├── analyzer/          # mail/link/attachment analiz motoru
    ├── mail/              # IMAP, SMTP, quarantine
    ├── license-client/    # customer-side lisans istemcisi (encrypted local cache + grace)
    ├── license-core/      # !!! customer image'a girmez — key gen/imza/plan
    ├── central-sync/      # customer ↔ merkezi sync (bootstrap, heartbeat, pull, ack)
    ├── policy-client/     # feature gate, list/api-policy merge
    ├── storage/           # better-sqlite3 + JSON store wrapper'ları
    ├── security/          # AES-256-GCM, sha256/hmac, bearer auth
    └── shared/            # logger, env, constants, PII scrubber
```

## Veri akışı

```
[Customer self-hosted]
   │  POST /api/license/activate   (ilk)
   │  POST /api/license/validate   (periyodik)
   │  POST /api/customer-sync/heartbeat
   │  GET  /api/customer-sync/pull
   │  POST /api/customer-sync/ack
   ▼
[License Server — merkez]   ←──[Dealer Portal]── POST /api/license/create
                                                  GET  /api/central/dealers/:id/customers/status
```

Mail içeriği, attachment, credential ve kişisel veri **müşteriden çıkmaz**.
Merkeze yalnızca operasyonel/lisans/policy telemetri gider — bkz. [SECURITY-MODEL.md](SECURITY-MODEL.md).

## Paket bağımlılık grafikleri

| App              | Bağımlı paketler |
|------------------|------------------|
| customer         | analyzer, mail, license-client, central-sync, policy-client, storage, security, shared |
| dealer           | security, shared (ek: HTTP üzerinden license-server) |
| license-server   | license-core, security, shared |

`license-core` **asla** customer'a girmez — Dockerfile build adımında silinir, `scripts/check-customer-package.js` doğrular.
