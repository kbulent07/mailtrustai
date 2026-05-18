# QA Test Raporu — MailTrustAI 3 Panel UI Audit

**Tarih:** 2026-05-18
**Kapsam:** Customer SPA (public/) + Dealer Panel (apps/dealer/) + Admin Keygen (apps/license-server/public/admin/)
**Test türü:** Static code analysis + API contract verification + UX/UI/Security audit

---

## Yönetici Özeti

| Severity | Customer SPA | Dealer Panel | Admin Keygen | TOPLAM |
|---|---|---|---|---|
| 🔴 Critical | **1** | 0 | 0 | 1 |
| 🟠 High     | **4** | 1 | 1 | 6 |
| 🟡 Medium   | **5** | 4 | 4 | 13 |
| 🟢 Low      | **3** | 3 | 2 | 8 |
| **Toplam**  | **13** | 8 | 7 | **28** |

**Karar:** Sistem işlevsel — backend ile UI uyumlu (29/30 endpoint var). Kritik 1 bug + erişilebilirlik + UX tutarsızlık çoğunlukta. Production ship öncesi en az 5 yüksek-öncelik konunun ele alınması önerilir.

---

## Boyut Tablosu

| Ekran | HTML | CSS | JS |
|---|---|---|---|
| Customer SPA | 1813 LOC | 1481 LOC | **7931 LOC** |
| Dealer Panel | 1027 LOC (embedded) | — | — |
| Admin Keygen | 354 LOC | 247 LOC | 901 LOC |
| **Toplam** | **3194** | **1728** | **8832** |

---

# 🔴 CRITICAL — Production Bug

## C1. `/api/admin/status` 404 — Customer panelinde "Servis durumu alınamadı"

**Yer:** [`public/js/app.js:5732`](public/js/app.js:5732)
```js
const res = await fetch('/api/admin/status');
```

**Sorun:** Endpoint **silindi** (eski monolith `admin.routes.js`). Customer'da artık yok. UI hâlâ çağırıyor → her sayfa yüklemede 404 + "Servis durumu alınamadı" mesajı.

**Etki:** Müşterinin "Servis Yönetimi" kartı boş gözüküyor. Production ortamında her seansda 404 logu üretir.

**Öneri:**
- A) Customer'a hafif bir `/api/system/status` endpoint'i ekle (uptime, RAM, Node version)
- B) UI'dan `loadServiceStatus()` fonksiyonunu sil + ilgili kartı kaldır

---

# 🟠 HIGH — Yüksek Öncelik

## H1. Customer SPA: 44 native `alert()` + 6 `confirm()` — UX tutarsızlığı

**Yer:** `public/js/app.js` — 44 satır (1827, 1948, 2021, 2031, 2043, 2073, 2278…)

**Sorun:** Kod tabanında **`showToast`** ve **`showConfirm`** (brand-uyumlu modal) zaten var, ama 44 yerde hâlâ native `alert()` kullanılıyor.

**Etki:**
- Native dialog OS'a göre değişiyor, brand identity'yi kırıyor
- Mobile'de UX kötü (blocking modal)
- Native confirm kullanıcıyı durduruyor (toast vs blocking)

**Öneri:** Tek seferlik refactor — `alert(...)` → `showToast(..., 'error'|'warning')`, `confirm(...)` → `await showConfirm({...})`.

## H2. Customer SPA: Form `<label for="">` ilişkisi YOK (70 input)

**Yer:** `public/index.html` — 73 label, 70 input, **0 `for=` attribute**

**Sorun:** Ekran okuyucular `<label>` ile `<input>` arasındaki bağı kuramaz. Tab navigation engel.

**Etki:** WCAG 2.1 AA başarısız. Screen reader kullanıcısı form'a giremez.

**Öneri:**
```html
<label for="emailInput">E-posta</label>
<input id="emailInput" type="email">
```

## H3. Customer SPA: 535 inline `style=` attribute

**Yer:** `public/index.html` (348) + `public/js/app.js` (535)

**Sorun:** CSS class yerine inline style. Tema desteği, dark mode ve maintainability düşük.

**Etki:** style.css 1481 LOC olmasına rağmen, üretilen DOM'da binlerce inline style kuralı. CSP `style-src` daha sıkı yapılamaz.

**Öneri:** Atomic CSS class'lara taşı (`utility-first` yaklaşımı: `.flex`, `.gap-2`, `.color-red`). Bu kademeli yapılabilir.

## H4. Customer SPA: A11y minimal — 1 aria, 0 role

**Yer:** `public/index.html`

**Sorun:**
- `aria-*` attribute: 1 (sadece `aria-expanded`)
- `role=` attribute: 0
- `<button>` 116 adet ama hiçbiri `aria-label`'sız ikon-butona sahip

**Etki:** WCAG 2.1 AA başarısız. Modal dialog'ları (`role="dialog"`, `aria-modal`) doğru anonse edilmiyor.

**Öneri:** İkon-only butonlara `aria-label`; modal'lara `role="dialog" aria-modal="true"`; nav'a `role="navigation"`; alert'lere `role="alert"`.

## H5. Dealer Panel: `escapeHtml` single quote escape etmiyor

**Yer:** [`apps/dealer/public/index.html:482`](apps/dealer/public/index.html:482)
```js
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  // ⚠️ Single quote (') escape edilmiyor
}
```

**Sorun:** `id='${escapeHtml(x)}'` gibi single-quote attribute'a yerleştirilirse XSS açığı.

**Etki:** Şu an mevcut innerHTML'ler hep double quote kullanıyor → pratik risk düşük. Ama best practice değil + future-proof değil.

**Öneri:** `.replace(/'/g,'&#39;')` ekle. Aynı düzeltme `apps/license-server/public/admin/keygen.js:39`'da da yapılmalı.

---

# 🟡 MEDIUM — Orta Öncelik

## M1. Customer SPA: 122 inline `onclick=` handler

**Yer:** `public/index.html` (122) + `public/js/app.js` (51)

**Sorun:** Modern best practice `addEventListener` veya event delegation. CSP `script-src-attr` izin vermek zorunda.

**Etki:** CSP `'unsafe-inline'` gerektiriyor (XSS koruması zayıf).

**Öneri:** Kademeli olarak `data-action="..."` pattern'ine geç + tek delegation listener.

## M2. Customer SPA: i18n karışık

**Yer:** `public/js/app.js` — 76 `currentLang` kontrolü + `data-i18n` attribute 32 yer + 15 hardcoded TR cümle

**Sorun:** İki paradigma birlikte: (a) `data-i18n` + i18n.js, (b) `currentLang === 'tr' ? '...' : '...'` ternary

**Etki:** Yeni dil eklenirse 76 yerde manuel ternary güncelleme gerekir.

**Öneri:** Tüm string'leri i18n.js'e taşı, ternary kullanmı kaldır.

## M3. Customer SPA: Form validation eksik

**Yer:** `public/index.html` — 70 input, **0 `required`**, sadece 9 `autocomplete`

**Sorun:** HTML5 native validation kullanılmıyor. Sadece JS'de manuel check + alert.

**Etki:** Empty submit native browser hint vermiyor; password manager autofill çalışmıyor.

**Öneri:**
```html
<input type="email" required autocomplete="email">
<input type="password" required minlength="6" autocomplete="current-password">
```

## M4. Customer SPA: 92 fetch vs 9 .catch

**Yer:** `public/js/app.js`

**Sorun:** Çoğu try/catch içinde (99 try block) ama bazıları unhandled olabilir.

**Etki:** Network error'da bazı UI'ler "loading" stuck kalır.

**Öneri:** `_safeFetch(url, opts)` helper'ı her yerde kullan, default error handling.

## M5. Customer SPA: 17 `console.log/error`

**Sorun:** Production'da console'a leak. Bazıları debug, bazıları gerçek hata.

**Öneri:** `logger.error` wrapper + production'da seviyeye göre suppress.

## M6. Dealer Panel: A11y zayıf

**Yer:** `apps/dealer/public/index.html`

**Sorun:** `aria-*` 0, `role=` 0, `<label for="">` 0.

**Öneri:** Customer SPA için yapılacaklar burada da geçerli.

## M7. Dealer Panel: Sadece 1 @media query

**Yer:** `apps/dealer/public/index.html`

**Sorun:** Sidebar layout sabit. Mobile/tablet'te bozuk görünebilir.

**Öneri:** Mobil için sidebar collapse + topbar hamburger.

## M8. Admin Keygen: `escapeHtml` single quote escape etmiyor

**Yer:** [`apps/license-server/public/admin/keygen.js:39`](apps/license-server/public/admin/keygen.js:39) — H5 ile aynı

## M9. Admin Keygen: 5 alert + 4 confirm (native)

**Yer:** `apps/license-server/public/admin/keygen.js` — 147, 151, 478, 483, 626, 630, 634, 708…

**Sorun:** Native dialog'lar. Admin paneli için custom modal yok.

**Öneri:** En azından destructive action'ları (`bayisini silmek`, `lisansı iptal etmek`) custom modal yap.

## M10. Admin Keygen: A11y zayıf

**Yer:** `apps/license-server/public/admin/keygen.html`

**Sorun:** `aria-*` 0, `role=` 0, `<label for="">` 0.

## M11. Admin Keygen: Sadece 2 @media query

**Yer:** `apps/license-server/public/admin/keygen.css`

**Sorun:** Admin paneli mobile'da kullanılabilir mi belirsiz.

## M12. Dealer Panel: Meta description yok (SEO)

**Yer:** `apps/dealer/public/index.html`

**Sorun:** SEO meta `description` yok. (Admin panel için kritik değil ama dealer panel public-facing.)

## M13. Admin Keygen: Meta description yok (SEO)

Aynı M12 — admin için low priority.

---

# 🟢 LOW — Düşük Öncelik

## L1. Customer SPA: 1 TODO comment kaldı

**Yer:** `public/index.html` — 1 TODO

**Sorun:** Pending iş izi. Net görmek için temizlenmeli veya GitHub issue'a taşınmalı.

## L2. Customer SPA: i18n.js bağımsız çalışıyor

Yeni dil eklemek için 76 ternary refactor gerekiyor (M2 ile aynı kök).

## L3. Customer SPA: `confirm()` 6 kullanım

Bazı yerlerde native `confirm()`. `showConfirm` (Promise<boolean>) varken kullanılmamış.

## L4-L8. Dealer Panel + Admin Keygen ufak detaylar

- Dealer Panel'da 1 alert (line 497)
- Dealer Panel: autocomplete sadece 1 yer
- Admin Keygen: autocomplete sadece 1 yer  
- Tüm panellerde footer/version label eksik (deployment debugging için yararlı)
- Tüm panellerde `<noscript>` fallback yok

---

# ✅ İYİ Olanlar (Positive Findings)

| Konu | Durum |
|---|---|
| **API uyumu** | 29/30 endpoint UI ile backend arasında eşleşiyor |
| **XSS koruması** | Tüm innerHTML kullanımları escape ile sarmalı (esc/escapeHtml) |
| **CSS theme** | Customer 26 CSS variable + 205 var() kullanım — dark mode hazır |
| **Try/catch coverage** | Customer SPA 99 try block — error handling iyi kapsanmış |
| **Responsive (Customer)** | 14 @media query — breakpoint'ler tanımlı |
| **HTML lang attribute** | 3 ekran da `<html lang="tr">` |
| **Meta viewport** | 3 ekran da mevcut |
| **CDN bağımlılığı** | Sadece 1 (jsPDF) — minimal external dependency |
| **eval / new Function** | 0 kullanım — code injection riski yok |
| **document.write** | 0 kullanım |
| **Customer ↔ Dealer izolasyon** | Customer panel `/api/dealer/*` çağırmıyor → mimari temiz |
| **Dealer Auth Flow** | Login/logout/me endpointleri tam → session yönetimi sağlıklı |

---

# Test Methodology

Bu rapor şu tekniklerle hazırlandı:

1. **Static code analysis** — 15 farklı bug pattern'i için grep
2. **API contract verification** — UI'nin çağırdığı 30 endpoint backend'de var mı
3. **Manual code review** — yüksek-yoğunluklu dosyalardan örneklenmiş satırlar
4. **A11y checklist** — WCAG 2.1 AA temel kontroller
5. **Security pattern audit** — XSS, CSRF, eval, document.write
6. **Responsive design count** — @media query sayısı
7. **i18n consistency** — data-i18n vs hardcoded text dağılımı

**Yapılmadı (manual browser test gerekli):**
- Visual regression test (screenshot diff)
- Cross-browser compat (Chrome/Firefox/Safari/Edge)
- Lighthouse performance audit
- Real user monitoring (RUM)
- Penetration test (XSS payload denemesi)
- Mobile cihaz emülasyonu

---

# Önerilen Aksiyon Planı

## Sprint 1 — Production Blocker
- [ ] **C1** — `/api/admin/status` ya backend'e ekle ya UI'dan kaldır
- [ ] **H5** — `escapeHtml` single quote desteği (3 panel)

## Sprint 2 — UX Consistency
- [ ] **H1** — 44 native alert → `showToast` (Customer SPA)
- [ ] **M9** — 5 native alert + 4 confirm → custom modal (Admin Keygen)
- [ ] **L3** — 6 native confirm → `showConfirm` (Customer SPA)

## Sprint 3 — Accessibility
- [ ] **H2** — Customer form'da 70 input'a `<label for="">` ekle
- [ ] **H4** — Customer'da `aria-*` + `role="dialog"` + nav role
- [ ] **M6** — Dealer Panel a11y
- [ ] **M10** — Admin Keygen a11y

## Sprint 4 — Technical Debt
- [ ] **H3** — 535 inline style → utility CSS class
- [ ] **M1** — 122 inline onclick → event delegation
- [ ] **M2** — i18n: 76 ternary → data-i18n + i18n.js
- [ ] **M3** — Form validation: `required`, `autocomplete`, `minlength`
- [ ] **M5** — `console.log` → logger wrapper
- [ ] **M7** + **M11** — Mobile responsive iyileştirmesi
- [ ] **L1** — TODO temizliği

---

**Hazırlayan:** QA Engineer Mode
**Yöntem:** Static analysis + API contract verification
**Çalışılan dosya:** 10 (3 HTML, 2 CSS, 3 JS + 2 stylesheet/script)
