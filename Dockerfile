# ============================================================
# MailTrustAI — Dockerfile
# Node.js 20 Alpine tabanlı, better-sqlite3 native derleme
# destekli, non-root kullanıcı ile güvenli imaj.
# ============================================================

# ── Aşama 1: Bağımlılık derleyici ──────────────────────────
FROM node:20-alpine AS builder

# better-sqlite3 ve diğer native modüller için derleme araçları
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /build

# Önce package dosyalarını kopyala (katman önbelleği için)
COPY package*.json ./

# Üretim bağımlılıklarını yükle ve native modülleri derle
RUN npm ci --omit=dev

# ── Aşama 2: Çalışma imajı ─────────────────────────────────
FROM node:20-alpine AS runner

# Güvenlik: küçük runtime bağımlılıkları
RUN apk add --no-cache sqlite-libs tini

# Non-root kullanıcı oluştur
RUN addgroup -g 1001 -S mailtrustai && \
    adduser  -u 1001 -S mailtrustai -G mailtrustai

WORKDIR /app

# Derlenmiş node_modules'ü builder'dan al
COPY --from=builder /build/node_modules ./node_modules

# Uygulama kaynak kodunu kopyala
COPY --chown=mailtrustai:mailtrustai . .

# Veri dizinini oluştur ve sahipliğini ayarla
RUN mkdir -p /app/data /app/logs && \
    chown -R mailtrustai:mailtrustai /app/data /app/logs

# Non-root kullanıcıya geç
USER mailtrustai

# Veri ve log dizinlerini volume olarak tanımla
VOLUME ["/app/data", "/app/logs"]

# Uygulama portu
EXPOSE 3000

# Sağlık kontrolü
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

# tini ile PID 1 sorunlarını önle (zombie process temizleme)
ENTRYPOINT ["/sbin/tini", "--"]
# --use-system-ca: kurumsal/Let's Encrypt CA'larını OS CA store'undan al
CMD ["node", "--use-system-ca", "server.js"]
