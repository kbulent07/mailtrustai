# Fiyatlandırma, Kredi ve Bayi Sistemi

> MailTrustAI ticari modelinin merkezi: **license-server** (`apps/license-server`).
> Bu doküman fiyatlandırma planlarını, bayi kredi sistemini ve bayi yönetimini
> uçtan uca anlatır. İlgili kod: `apps/license-server/{routes,migrations,lib}`,
> `packages/license-core`.

---

## 1. Genel model

```
ÜRETİCİ (sen)                BAYİ (dealer)                  MÜŞTERİ (customer)
─────────────                ─────────────                  ──────────────────
admin paneli         kredi    bayi paneli       lisans       self-hosted app
/admin               yükler   /dealer veya      üretir       (3000)
  ├─ fiyat belirler  ───────► port 3100 SPA    ───────►      lisans aktive eder
  ├─ bayi açar                  ├─ müşteri ekler             merkeze heartbeat
  └─ kredi yükler               └─ lisans üretir (1 kredi)
```

**Temel ilke:** `1 lisans üretimi = 1 kredi kesintisi`. Kredi birimi kavramsal
olarak "tarama" (`pricing_credit_unit`), ama kesinti lisans başınadır.

Üç temel kavram:
- **Plan + Tier** (`packages/license-core`) — lisansın *özellik seti* ve *tarama kotası*.
- **Fiyatlandırma** (`pricing_plans` tablosu) — planların *parasal* karşılığı (bilgi/satış amaçlı).
- **Kredi** (`dealers.credits` + `dealer_credit_log`) — bayinin lisans üretme hakkı.

---

## 2. Plan ve Tier matrisi

Kaynak: `packages/license-core/index.js`. **Bu paket customer image'a girmez.**

### 2.1 Planlar (özellik seti)
| Plan | Varsayılan Tier | Grace (gün) | Öne çıkan özellikler |
|------|-----------------|-------------|----------------------|
| `demo` | — | — | Sınırlı deneme (en fazla 7 gün) |
| `pro` | T5 (1.000/ay) | 3 | imapMonitor, quarantine, multiMailbox, VirusTotal, deepAi, pdfReport. **Kapalı:** apiAccess, autoMonitor, realtimeAlert, siemWebhook, jsonReport, localAi |
| `enterprise` | T9 (sınırsız) | 7 | Pro + apiAccess, autoMonitor, realtimeAlert, siemWebhook, jsonReport, localAi, inboxScan, batchScan, centralApiProxy |

Özellik bayrakları lisansın `features_json` alanına yazılır; müşteri tarafında
`appState.js` bunları okuyup `dailyLimit`/`linkLimit` gibi Infinity-türevlerini hesaplar.

### 2.2 Tier'lar (aylık tarama kotası)
| Tier | Aylık tarama | Tier | Aylık tarama |
|------|--------------|------|--------------|
| T1 | 50 | T6 | 2.000 |
| T2 | 100 | T7 | 5.000 |
| T3 | 250 | T8 | 10.000 |
| T4 | 500 | T9 | Sınırsız (9.999.999) |
| T5 | 1.000 | | |

**Plan ↔ Tier ilişkisi:** Plan özellikleri belirler, tier aylık tarama kotasını
belirler. Lisans üretirken `tier` verilirse plan varsayılanı override edilir
(`getPlan(plan, tier)`). Örn. `pro` + `T7` → Pro özellikleri + 5.000/ay kota.

---

## 3. Fiyatlandırma sistemi

Tablo: `pricing_plans` (migration `0009_pricing.sql` / `.mariadb.sql`).
Fiyatlar **bilgilendirme/satış** amaçlıdır; lisans üretiminde kredi kesintisini
tetikler ama parayı tahsil etmez (ödeme entegrasyonu yok — manuel).

### 3.1 Şema
| Kolon | Tip | Açıklama |
|-------|-----|----------|
| `id` | TEXT (PK) | `pp-<plan>-<m\|a>-<currency>` |
| `plan` | TEXT | `demo` \| `pro` \| `enterprise` |
| `billing_period` | TEXT | `monthly` \| `annual` |
| `currency` | TEXT | varsayılan `TRY` |
| `base_price` | REAL | dönemlik lisans ücreti |
| `included_credits` | INTEGER | pakete dahil tarama/kredi |
| `extra_credit_price` | REAL | ek her kredi (=tarama) birim fiyatı |
| `is_active` | INTEGER | 1=aktif |
| `notes`, `updated_at`, `updated_by` | | meta |

`UNIQUE(plan, billing_period, currency)` — aynı kombinasyon tek satır.

### 3.2 Varsayılan fiyatlar (seed)
| Plan | Dönem | Base (TRY) | Dahil kredi | Ek kredi (TRY) | Not |
|------|-------|-----------|-------------|----------------|-----|
| demo | monthly | 0 | 50 | 0 | Ücretsiz deneme |
| pro | monthly | 999 | 500 | 2,00 | Pro aylık |
| pro | annual | 9.990 | 6.000 | 1,50 | Yıllık (2 ay hediye) |
| enterprise | monthly | 1.199 | 2.000 | 1,00 | Enterprise aylık |
| enterprise | annual | 11.990 | 24.000 | 0,75 | Enterprise yıllık |

### 3.3 Genel ayarlar (`admin_settings`)
- `pricing_enterprise_multiplier` (varsayılan `1.20`) — enterprise çarpanı (1–10).
- `pricing_credit_unit` (varsayılan `tarama`) — kredi biriminin UI etiketi.

### 3.4 Endpoint'ler
| Method & Path | Yetki | İş |
|---------------|-------|----|
| `GET /api/admin/pricing` | `pricing:read` | Tüm planlar + ayarlar |
| `PUT /api/admin/pricing/settings` | `pricing:write` | Çarpan + kredi birimi |
| `PUT /api/admin/pricing/:id` | `pricing:write` | Plan güncelle |
| `POST /api/admin/pricing` | `pricing:write` | Yeni plan |
| `GET /api/dealer/pricing` | **public** | Aktif planlar (bayi/müşteri görür) |

> ⚠️ **Route sırası:** `/pricing/settings`, `/pricing/:id`'den ÖNCE tanımlı olmalı —
> yoksa Express "settings"i `:id` olarak yakalar.

---

## 4. Kredi sistemi

### 4.1 Şema
- `dealers.credits` (INTEGER) — bayinin güncel bakiyesi (migration `0001`).
- `dealer_credit_log` (migration `0010` + `0012` ek `price_amount`/`currency`):

| Kolon | Açıklama |
|-------|----------|
| `delta` | +ekleme / −düşme |
| `balance` | işlem **sonrası** bakiye snapshot'ı |
| `reason` | `load` \| `license.create` \| `manual.deduct` \| `error.refund` |
| `description`, `actor`, `created_at` | meta |
| `price_amount`, `currency` | işlemin parasal karşılığı (varsa) |

### 4.2 Kredi akışı
```
1) Üretici admin panelinden bayiye kredi yükler   → delta:+N, reason:load
2) Bayi lisans üretir                              → delta:-1, reason:license.create
3) Bakiye 0 ise lisans üretimi reddedilir          → HTTP 402 INSUFFICIENT_CREDITS
4) Hata düzeltme (manuel)                           → delta:±N, reason:manual.deduct
```

### 4.3 Atomiklik (kritik kural)
Tüm kredi güncellemeleri **atomik** ve **negatife düşmez**:

```sql
-- Yükleme/düşme (admin):
UPDATE dealers
   SET credits = CASE WHEN credits + ? >= 0 THEN credits + ? ELSE credits END
 WHERE id = ?;

-- Lisans kesintisi:
UPDATE dealers SET credits = credits - 1 WHERE id = ? AND credits > 0;
```
`changed === 0` ise işlem yapılmamıştır (yetersiz bakiye). **UPDATE sonrası
bakiye DB'den yeniden okunur** — pre-read (stale) değeri log'a/yanıta yazılmaz
(race condition koruması). Bu kural `CLAUDE.md`'de de vurgulanır.

### 4.4 Endpoint'ler
| Method & Path | Yetki | İş |
|---------------|-------|----|
| `GET /api/admin/dealers` | `dealers:read` | Bayiler + bakiyeler |
| `POST /api/admin/dealers/:id/credits` | `dealers:write` | Kredi yükle/düş `{delta, description, priceAmount?, currency?}` |
| `GET /api/admin/dealers/:id/credit-log` | `dealers:read` | İşlem geçmişi |
| `GET /api/dealer/credit-log` | bayi oturumu | Kendi kredi geçmişi |
| `GET /api/dealer/me` | bayi oturumu | Bilgi + güncel bakiye |

---

## 5. Bayi (dealer) sistemi

### 5.1 Şema
`dealers` tablosu: `id` (PK), `name`, `email`, `api_token_hash` (bcrypt), `credits`, `created_at`.
Müşteriler `customers.dealer_id` ile bayiye bağlıdır; lisanslar `licenses.dealer_id` taşır.

### 5.2 İki erişim yolu
1. **Bayi paneli oturumu** (önerilen) — `POST /api/dealer/login {dealerId, password}`
   → `bcrypt.compare(password, api_token_hash)` → bellekte session token
   (TTL `DEALER_SESSION_TTL_MINUTES`, default 480 dk). Sonraki istekler
   `Authorization: Bearer <sessionToken>` ile `dealerSessionAuth`'tan geçer.
2. **Eski dealer SPA** (port 3100, `apps/dealer`) — `DEALER_API_SECRET` bearer
   ile license-server'ın `/api/license/*` uçlarını çağırır
   (`apps/dealer/licenseServerClient.js`).

### 5.3 Bayi paneli endpoint'leri (`dealerSessionAuth`)
| Method & Path | İş |
|---------------|----|
| `GET /api/dealer/me` | Bilgi + kredi bakiyesi |
| `GET /api/dealer/customers` | **Kendi** müşterileri + lisansları |
| `POST /api/dealer/customers` | Müşteri ekle |
| `POST /api/dealer/licenses` | Lisans üret (1 kredi keser, müşteri bayiye ait olmalı) |
| `GET /api/dealer/transfers` | Cihaz transfer talepleri |
| `POST /api/dealer/transfers/:id/approve` \| `/reject` | Transfer onay/red |
| `GET /api/dealer/credit-log` | Kredi geçmişi |
| `GET /api/dealer/pricing` | Aktif fiyatlar (oturumsuz) |

> 🔒 **Kapsam izolasyonu:** Bayi yalnız `dealer_id`'si kendine eşit müşteri/lisansları
> görür ve yönetir. Başka bayinin müşterisine lisans üretmek `403` döner.

### 5.4 Bayi oluşturma
- **Admin panelinden:** `POST /api/admin/dealers {id, name, email, password}` (`dealers:write`).
  Parola bcrypt ile `api_token_hash`'e yazılır (8+ karakter).
- **Bootstrap CLI:** `docker exec mailtrustai-license-server node apps/license-server/bin/bootstrap.js list-dealers` vb.

---

## 6. Lisans üretim akışı (kredi kesintisiyle)

`POST /api/license/create` (admin/SPA) ve `POST /api/dealer/licenses` (panel) aynı mantığı paylaşır:

```
1) Girdi doğrula: customerId, plan ∈ {demo,pro,enterprise}, validDays (1..36500)
   - demo/trial → max 7 gün
   - tier verilirse TIER_MATRIX'te olmalı
2) dealerId varsa → KREDİ KES (atomik, credits>0). 0 ise 402.
   (Admin panelinden dealerId'siz üretimde kredi kesilmez.)
3) UPDATE sonrası bakiyeyi oku → dealer_credit_log'a delta:-1 yaz
4) customer upsert (şirket/dealer/email senkronu)
5) getPlan(plan, tier) → features_json + limits_json
6) generateLicenseKey → MTAI-<PLAN>-XXXX-XXXX (HMAC imzalı, license-core)
7) licenses tablosuna insert (status:active, expires_at, grace_days)
8) audit log
```

**Lisans key formatı:** `MTAI-PRO-0F7F8CBE8720-213628EE24A1F215`
(`MTAI-<plan4>-<random6hex>-<hmac16>`). DB'de yalnız `license_key_hash` (sha256)
ve maskelenmiş hali saklanır — ham key tekrar gösterilmez.

---

## 7. Cihaz transfer sistemi

Tablo: `transfer_requests` (migration `0006`).

Bir lisans yeni cihazda aktive edilmeye çalışıldığında (farklı `hostname_hash`),
mevcut aktivasyon varsa **transfer talebi** (`pending`) oluşur. Bayi veya admin onaylar:
- **Approve:** eski aktivasyon silinir, yeni cihaza izin verilir.
- **Reject:** talep reddedilir (`reject_reason`).

Aynı `instance_id`'nin yeniden aktivasyonu (donanım değişikliği) transfer
gerektirmez — doğrudan izin verilir.

---

## 8. RBAC — Owner panel rolleri

Kaynak: `apps/license-server/lib/permissions.js`. Route'lar `requirePerm('x:y')` ile korunur.

| Yetki | super-admin | admin | muhasebe | support |
|-------|:---:|:---:|:---:|:---:|
| `pricing:read` | ✅ | ✅ | ✅ | ✅ |
| `pricing:write` | ✅ | ✅ | — | — |
| `dealers:read` | ✅ | ✅ | — | ✅ |
| `dealers:write` (kredi yükle dahil) | ✅ | ✅ | — | — |
| `licenses:read` / `licenses:write` | ✅ | ✅ | read | read |
| `billing:read` | ✅ | ✅ | ✅ | — |
| `transfers:write` | ✅ | ✅ | — | ✅ |
| `users:manage` | ✅ | — | — | — |

> Muhasebe: finansal/salt-okunur (fiyat + kredi geçmişi görür, değiştiremez).
> Support: müşteri/lisans okur, transfer onaylar; fiyat/kredi yazamaz.

---

## 9. Tipik operasyon senaryosu

```bash
# 1) Üretici: yeni bayi aç (admin paneli /admin → Bayiler → Ekle)
POST /api/admin/dealers {id:"bayi-01", name:"ACME", email:"...", password:"..."}

# 2) Üretici: bayiye 100 kredi yükle
POST /api/admin/dealers/bayi-01/credits {delta:100, description:"İlk yükleme", priceAmount:200, currency:"TRY"}

# 3) Bayi: panele giriş (bayi.mailtrustai.com veya port 3100)
POST /api/dealer/login {dealerId:"bayi-01", password:"..."}

# 4) Bayi: müşteri ekle
POST /api/dealer/customers {customerId:"musteri-x", companyName:"X Ltd", email:"..."}

# 5) Bayi: lisans üret (1 kredi düşer → bakiye 99)
POST /api/dealer/licenses {customerId:"musteri-x", plan:"pro", tier:"T5", validDays:365}
→ { licenseKey:"MTAI-PRO-...", remainingCredits:99 }

# 6) Müşteri: license key'i .env.docker'a koyup customer container'ı başlatır
MSA_LICENSE_KEY=MTAI-PRO-...   →  license.mailtrustai.com'a aktive olur
```

---

## İlgili dosyalar
- Plan/Tier/keygen: `packages/license-core/index.js`
- Fiyat endpoint'leri: `apps/license-server/routes/admin.routes.js`, `dealer.routes.js`
- Lisans üretim + kredi kesinti: `apps/license-server/routes/license.routes.js`, `dealer.routes.js`
- RBAC: `apps/license-server/lib/permissions.js`
- Şema: `apps/license-server/migrations/000{1,6,9}_*.sql`, `0010_credit_log.sql`, `0012_credit_log_amount.sql`
- Genel mimari: `docs/ARCHITECTURE.md`, kök `CLAUDE.md`
