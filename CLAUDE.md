# MailTrustAI — Agent Rehberi

> Bu dosya her oturumda otomatik yüklenir. Yapıyı buradan öğren; ayrıntı için `docs/ARCHITECTURE.md`.
> Kod, yorumlar, commit mesajları ve UI **Türkçe**. Aktif branch: **`mainpaketler`**.

## Ne bu proje
AI destekli e-posta güvenlik analizi (phishing/attachment/IMAP). **Ticari, 3-parçalı self-hosted** mimari, npm workspaces monorepo (`apps/*` + `packages/*`).

## Üç uygulama
| App | Paket | Port | Rol |
|-----|-------|------|-----|
| `apps/customer` | `@mailtrustai/customer` | 3000 | Müşteri (self-hosted). Mail tarar, merkeze yalnız lisans/heartbeat/policy sync yapar. |
| `apps/dealer` | `@mailtrustai/dealer` | 3100 | Bayi portalı (SPA). license-server HTTP API'sini çağırır. |
| `apps/license-server` | `@mailtrustai/license-server` | 3200 | Merkezi lisans + policy + keygen + admin/bayi paneli. |

## Paketler (`packages/`)
`analyzer, mail, license-client, license-core, central-sync, policy-client, storage, security, shared, customer-core`

- **`license-core`** = keygen/imzalama. **Customer image'a GİRMEZ** — Dockerfile build'de fiziksel silinir, `scripts/check-customer-package.js --scope=image` build'de denetler. Customer'a yasak pattern (generateLicenseKey, dealer, keygen…) sızarsa build patlar.
- **`customer-core`** = bridge barrel. `apps/customer/server.js` artık `path.join(REPO_ROOT,...)` yapmaz; repo-kök `src/` modüllerini `core.routes.x()`, `core.storage.x()`, `core.services.x()` lazy getter'larıyla tüketir. Yeni bir `src/` modülünü customer'a açacaksan **önce `packages/customer-core/index.js`'e ekle**.

## Müşteri kodu nerede yaşıyor
Müşteriye ait route/storage/service/analysis kodu hâlâ **repo-kök `src/`** altında (`src/interfaces/http/routes`, `src/storage`, `src/services`, `src/imap`, `src/analysis`, `src/license`...). `apps/customer` bunları `customer-core` üzerinden import eder. (Gelecekte fiziksel olarak `packages/customer-core/src/`'e taşınacak.)

## ⚠️ Sık tekrarlayan hata sınıfı: license-server DB import
`apps/license-server/routes/*.js` içinde DB helper'ları `../db`'den **isimle import edilir** ve TÜMÜ açıkça yazılmalı:
```js
const { get, run, all, audit, upsert, isMaria } = require('../db');
```
Bir handler `all()`/`get()` kullanıp import'a eklemezsen **runtime'da `X is not defined` → 500** olur (testlerde yakalanmaz, sadece o endpoint çağrılınca patlar). Yeni endpoint eklerken kullandığın her db fonksiyonunun import'ta olduğunu doğrula. `router.get(...)` Express'tir, db `get` ile karıştırma.

`src/` tarafında DB farklı: `src/storage/db.js` better-sqlite3, sabit `data/msa.db`. License-server DB'si ayrı: `apps/license-server/db.js`, **SQLite (dev) / MariaDB (prod)** — `LICENSE_DB_CLIENT=mariadb`.

## License-server detayları
- **Migrations:** `apps/license-server/migrations/NNNN_*.sql` (SQLite) + `NNNN_*.mariadb.sql` (MariaDB) — **ikisini birlikte** ekle, dialect farkına dikkat (`INSERT OR IGNORE` vs `INSERT IGNORE`, inline index vs ayrı `CREATE INDEX`).
- **RBAC:** `apps/license-server/lib/permissions.js` (roller: super-admin, admin, muhasebe, support). Route'lar `requirePerm('x:y')` ile korunur. Yeni yetki eklersen `PERMISSIONS` + ilgili rollere ekle.
- **Repository pattern:** `apps/license-server/repositories/*.js` SQL'i route'lardan izole eder.
- **Express route sırası:** spesifik path'i parametreliden ÖNCE tanımla (`/pricing/settings`, `/pricing/:id`'den önce) yoksa `:id` "settings"'i yakalar.
- **Kredi güncellemesi atomik olmalı:** `UPDATE ... SET credits = credits + ? ...` + sonra DB'den re-read. Pre-read değerini log'a yazma (stale balance / race).

## Build & çalıştırma (Docker)
```bash
# Server tarafı (üretici sunucusu): mariadb + license-server + dealer
npm run up:server      # docker compose --env-file .env.docker -f docker-compose.server.yml up -d --build
# Müşteri tarafı (her müşteri host'unda): sadece customer
npm run up:customer
```
- Secret'lar `.env.docker`'da (gerçek değerler container'a **env olarak** geçer, imaja dosya kopyalanmaz). Şablon: `.env.docker.example`.
- Compose `name:` ile proje adı sabit. **Mevcut prod stack `-p mailtrustai` proje adıyla ve `mailtrustai_mariadb-data` volume'üyle çalışıyor** — yeniden `up` ederken veri kaybını önlemek için aynı proje adını kullan.

## Domain (üretim)
| Subdomain | → | Kim |
|-----------|---|-----|
| `license.mailtrustai.com` | localhost:3200 | Müşteri container'ları (lisans/heartbeat) |
| `bayi.mailtrustai.com` | localhost:3100 | Bayiler (panel) |

Reverse proxy/TLS: `deploy/Caddyfile.example` (otomatik LE) veya `deploy/nginx-server.conf.example`. Müşteri install scriptleri (`install/client/*`) default `license.mailtrustai.com:3200` kullanır — **kanonik yazım `license` (İngilizce)**, `licence` değil.

## Test
```bash
npm test    # unit + integration + security (tests/unit, tests/integration, tests/security)
```
Tüm unit testler geçmeli (şu an 111). Native modüller: better-sqlite3, bcrypt (Docker build'de Linux için rebuild edilir).

## Kurallar
- Commit'ler Türkçe, conventional (`fix(...)`, `feat(...)`). Co-author satırını koru.
- Müşteri tarafına `LICENSE_SIGNING_SECRET`, `DEALER_API_SECRET`, `MARIADB_*` gibi sunucu secret'ları KOYMA.
- Prod'da secret yoksa `requireSecret()` (packages/shared) fail-fast eder — bu kasıtlı.

## İş Akışı (her görevde)
Görev geldiğinde **bu dosyanın alt kısmındaki "Aktif Plan & İlerleme" bölümüne**:
1. **Görev** başlığını yaz (1 satır)
2. **Plan** (madde listesi — hangi dosyalar, hangi adımlar)
3. Yaptıkça ✓ ile işaretle, ekleme/değişiklik çıkarsa not düş
4. Bitince **"Yapıldı"** alt-bölümüne özet at (commit hash + ne değişti)
5. Eski tamamlanmış işleri 5 başlıktan fazla olmasın — en üstte sadece **son tamamlananlar** kalsın

Push kuralı: her tamamlanan iş sonrası `git push origin mainpaketler` otomatik (onay sorma).

---

## 🎯 Aktif Plan & İlerleme

*(görev geldikçe bu bölüm güncellenir)*

### Yapıldı (son tamamlananlar)
*(boş — henüz bu oturumda kaydedilen bir görev yok)*
