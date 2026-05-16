# =========================================================
# MailTrustAI Customer image — self-hosted müşteri tarafı.
# BU IMAGE'DA BULUNMAYACAK: keygen, bayi paneli, lisans üretici,
# revoke/renew, reseller/dealer kredi, license-core paketi,
# apps/dealer ve apps/license-server klasörleri.
# Bunlar build sırasında fiziksel olarak silinir; ardından
# scripts/check-customer-package.js script'i imaj içeriğini
# tarayıp yasak desenleri bulursa build BAŞARISIZ olur.
# =========================================================
FROM node:22-bookworm-slim AS builder

WORKDIR /build

# Build deps (better-sqlite3 native)
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bütün repoyu kopyala — ardından SADECE müşteriye ait olmayan kısımları sil.
COPY . .

# 1) Dealer ve license-server app klasörlerini tamamen kaldır
RUN rm -rf apps/dealer apps/license-server

# 2) license-core (key generator/imzalama) paketini tamamen kaldır
RUN rm -rf packages/license-core

# 3) src/ içindeki müşteri-dışı dosyaları kaldır
# NOT: src/interfaces/http/routes/license.routes.js customer panel için KALIR
# (activate/validate/deactivate/usage/fingerprint). Admin-only path'ler
# (generate/trial/revoke/unrevoke/revoked) HARD-GATE ile runtime'da 404 döner.
# TODO v2.1: src/license/license.js → license-validate.js + license-generator.js böl.
RUN rm -f \
        src/license/keygenTool.js \
        src/license/license-generator.js \
        src/routes/dealerApi.js \
        src/interfaces/http/routes/resellers.routes.js \
        src/interfaces/http/routes/admin.routes.js \
        src/storage/dealerStore.js \
        src/storage/dealerCustomerStore.js \
        src/storage/dealerSales.js \
        src/storage/resellerStore.js \
        src/storage/issuedLicenseStore.js \
        src/storage/creditTransactionStore.js \
        src/middleware/adminAuth.js \
        src/utils/dealerLock.js

# 4) public/ içinden bayi ve keygen sayfalarını + bayi-app.js'i sil
RUN rm -f public/bayi.html public/keygen.html public/js/bayi-app.js

# 5) Native bağımlılıkları Linux için yeniden derle
# (npm install bug workaround: sadece gerekli native modül rebuild edilir)
RUN npm_config_nodedir=/usr/local npm rebuild better-sqlite3 --build-from-source --no-audit --no-fund

# 6) Yasak içerik kontrolü — image'a girmeden önce taranır.
RUN node scripts/check-customer-package.js

# ---------- Runtime image ----------
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Sadece temizlenmiş ağacı kopyala
COPY --from=builder /build /app
RUN mkdir -p /app/node_modules/@mailtrustai \
  && for p in analyzer central-sync customer dealer license-client mail policy-client security shared storage; do ln -sfn "/app/packages/$p" "/app/node_modules/@mailtrustai/$p"; done

ENV NODE_ENV=production
ENV MSA_CUSTOMER_ONLY=true
ENV DATA_DIR=/app/data
ENV LOG_DIR=/app/logs

EXPOSE 3000
VOLUME ["/app/data", "/app/logs"]

CMD ["node", "--use-system-ca", "apps/customer/server.js"]
