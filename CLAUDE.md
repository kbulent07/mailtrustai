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

*(şu an aktif görev yok)*

### Yapıldı — Lokal Docker customer container rebuild
- `C:\mailtrustai-source` 864901c → 25928a1 (15 commit + v2.0.1 tag pull edildi)
- `docker compose -f docker-compose.customer.yml build customer` → image yenilendi (sha 559492d…)
- `docker compose up -d` → container recreated + started
- Doğrulama: **Up 10s (healthy)**, healthz HTTP 200 (11ms), license validate `enterprise T5 active`, IMAP monitor bağlandı, auto-monitor devam ediyor
- ⚠ Log'da `[Counter] UYARI: Aylık tarama sayacı dosyası değiştirilmiş. Sayaçlar sıfırlanıyor` mesajı tekrarlanıyor — büyük olasılıkla volume race condition (data dosyası external değişiklik tespit ediyor). Gerçek sorun olmadığı, sadece gürültü olduğu görülüyor; sayaçlar zaten yeniden hesaplanıyor. Ayrı görev olabilir.

### Yapıldı — Dealer kredi-mali risk + politika temizliği (D1..D7)
- **D1/D2/D3 (KRİTİK)** `_withCreditRollback` helper: kredi atomik düş → fn çalıştır → fail olursa otomatik iade + `dealer_credit_log` `.rollback` kaydı + audit. 3 endpoint (licenses, topup, topup-codes) sarıldı. Rollback başarısız olursa kritik log ile manuel müdahale çağrısı.
- **D4 (önemli)** `POST /api/dealer/licenses/:id/topup` ve `POST /api/dealer/topup-codes` artık **410 Gone** döner. `TOPUP_DEPRECATED` code + politika referansı + yönlendirme mesajı. GET listele endpoint'i tutuldu (eski kod history için). Ölü handler kodları tamamen silindi (git history'de mevcut).
- **D5 (küçük)** `'demo' && validDays>7` dead code temizlendi (`PLAN_MATRIX[plan]` kontrolü zaten yakalıyor).
- **D6 (küçük)** T9 `customScanCount` için üst sınır: `MSA_T9_MAX_SCAN_COUNT` env (default 10M). Aşımda warn + kırpma.
- **D7 (küçük)** Bilinmeyen `plan` → `pro` fallback artık `console.warn` ile görünür (önce sessizdi).
- **Test:** `dealer-topup.test.js` baştan yazıldı. **147/147 ✓** (eski 13 topup-üretim testi silindi; yerine 4 yeni: 2 deprecation, 1 legacy validate, 1 rollback happy-path).

### Yapıldı — Lisans modeli yeniden yapılandırması (Plan × Tier)
- **Tier kapasiteleri** (license-core `TIER_MATRIX`): T1=50, T2=100, T3=250, T4=500, T5=1.000, T6=2.500, T7=5.000, T8=10.000, **T9=Özel/Custom** (`adminOnly`). Plan (pro/ent) = özellik seti, tier = kapasite. Pro N ve Enterprise N **aynı kapasite**.
- **T9 admin-only:** bayi (license.routes + dealer.routes) T9 lisans/topup/kod üretemez (403 `TIER_ADMIN_ONLY`). Admin T9'da `customScanCount` verir → `getPlan(plan, tier, {customScanCount})`.
- **Tier'a göre kredi maliyeti:** `TIER_MATRIX[].creditCost` (T1=1 … T8=12). Bayi üretiminde `credits = credits - ? WHERE credits >= ?`; `dealer_credit_log.delta = -creditCost`.
- **Plan × Tier fiyat matrisi:** yeni `tier_pricing` tablosu (migration `0016`, SQLite+MariaDB) — pro/ent × T1-T8 × aylık/yıllık = 32 satır seed (placeholder fiyat, admin düzenler). Admin `/admin/pricing` GET/PUT/POST + bayi `/dealer/pricing` bu tabloyu kullanır (eski `pricing_plans` modeli bırakıldı).
- **UI:** `keygen.html/js` tier dropdown + T9 custom kapasite input + fiyat/tier matrisi; `dealer index.html/js` lisans modalına tier seçici + topup/kod kapasiteleri (T9 yok) + fiyat matrisi + kredi maliyeti tablosu.
- **Müşteri tarafı:** yeni anahtar girişi zaten anında sunucu kontrolü + aktivasyon yapıyor (`apps/customer/server.js` `/api/customer/license/activate` → `licenseClient.activate`).
- Commit `63d975a`. Testler 150/150 ✓ (dealer-topup happy-path yeni kredi maliyetine göre güncellendi); canlı doğrulama (T9 kuralları + kapasiteler) ✓.

### Yapıldı — Bayi paneli sadeleştirme + kararlar
- **İKİ bayi paneli var, ayrışıyor:** `apps/dealer` (SPA, port **3100**, kullanıcının kullandığı, kanonik) + `apps/license-server/public/dealer` (license-server `/dealer`, port 3200, task-7'deki zengin kopya). Bayi UI değişikliğinde **ikisini de** kontrol et.
- **Topup YOK politikası:** Müşteriye ek tarama (topup) satılmaz; kapasite ihtiyacı = **yeni/üst tier lisans**. Müşteri panelinden "Ek Tarama Paketi Kodu" UI + `redeem-topup` ucu kaldırıldı (commit `68580ac`, `5420f18`). Kanonik panele topup eklenmedi. Backend kalıntıları (`dealer.routes` topup/topup-codes, `topup_codes` tablosu, `licenses.extra_scans`) deprecated.
- **apps/dealer hizalama:** deneme lisansı 14→7 gün (`6ad7fd1`); tier dropdown T6=2.500 + T9 bayiden kaldırıldı (`ba25d51`); **Fiyatlandırma (Plan×Tier) sekmesi** eklendi (`a9c5627`, `/api/dealer/pricing` proxy); Lisans Üret formunda **Müşteri ID artık arama kutulu seçim listesi** (lisansı olmayan müşteriler de listede — central baseQuery LEFT JOIN).

### Bilinen Davranışlar (Bug Değil)
- **DKIM imzası bozulması**: `markRiskySubject` etkinken bir mailin konusu APPEND ile değiştirilir → DKIM-Signature artık geçersizdir. Bu beklenen ve dokümante edilmiş davranıştır. Mail içeriği DEĞİŞMEMİŞTİR, sadece subject + 3 tracking header eklenmiştir. (UI checkbox'ında uyarı var.)

### Açık Bug'lar (gelecek görev)
- **B4** 🟠 Çift monitör analizi — `scanMailboxMonitor` + `websocket.js` aynı INBOX'u izliyor → AI/VT quota 2x. Ortak analiz cache veya tek-monitör refactoru gerekir.
- **B8** 🟡 `_wsMonitorLastUid` baseline race (idempotent, küçük)
- **B9** 🟡 `messageLocator` 30 folder × 30ms (Gmail X-GM-RAW ile hızlandırılabilir)
- **B10** 🟡 `removeDecoration` locator desteği yok (INBOX dışında çalışmaz)
- **B11** 🟡 `enrichWithAI` partial state (yarıda kalan VT call)

### Yapıldı (son tamamlananlar)
- **Lisans uzatma anlık yansıyor (heartbeat-piggyback + manuel buton)**
  - `customerSync.routes.js` `/customer-sync/heartbeat` → cevap `license: {expiresAt, status, features, limits, extraScans}` snapshot içeriyor
  - `packages/license-client` yeni `applyServerSnapshot(snap)` — cache fark merge (testler 3/3 ✓)
  - `packages/central-sync.sendHeartbeat` heartbeat cevabını otomatik işler
  - UI: "🔄 Lisansı Şimdi Yenile" kartı + butonu (`revalidateLicenseNow`)
  - Sonuç: ~5 dakika (heartbeat) içinde otomatik yansır, butona tıklayınca **anlık**
- **Lisans uzatma akışı araştırıldı (sadece dokümantasyon — kod değişmedi)**
  - Endpoint: `POST /api/license/renew` (bayi-akışı) + `POST /api/admin/licenses/:id/renew` (admin override)
  - DB: `UPDATE licenses SET expires_at = MAX(expires_at, NOW) + days*86400000, status='active'`
  - Tetikleyici: keygen.html `renewModal` (admin) veya bayi panelinden `/api/dealer/license/renew`
  - Customer'a iletim: `licenseClient.validate()` (6 saatte bir) → yeni `expiresAt` cache'lenir
- **Derin hata analizi → 6 bug fix** (B1, B2, B3, B5, B6, B7)
  - **B2** Decorator/Quarantine `stored` kullanır (taze credential) → şifre değişince auth fail çözüldü
  - **B1** `monitor.js` exists handler closure ile `currClient` yakalar — async loop sırasında bağlantı değişirse break ile çıkar
  - **B3** `_lastSeenExists` fallback — `prevCount` yoksa son görülen exists değeri kullanılır, toplu mail kaçırma giderildi
  - **B5** Tüm `lock.release()` çağrıları `await` + try/catch ile defensive
  - **B6** Self-loop koruması güçlendirildi — `X-MailTrustAI-Report-Id` HMAC-imzalı header (saldırgan üretemez) + subject prefix yedek check (HMAC test 6/6 ✓)
  - **B7** DKIM bozulması UI'da uyarı + CLAUDE.md "Bilinen Davranışlar" notu
- **Local Docker'da müşteri uygulamasını başlat** *(no-op — zaten healthy)*
