# =========================================================
# MailTrustAI License-Server image.
# Kurucu/satıcı sunucusunda çalışır. Bu image asla müşteriye
# dağıtılmaz (license-core içerir → keygen yetenekleri).
# =========================================================
FROM node:22-bookworm-slim AS builder
WORKDIR /build

# Build deps (native modüller: better-sqlite3, bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* pnpm-workspace.yaml ./
COPY apps/license-server/package.json ./apps/license-server/
COPY packages ./packages

# Tüm repoyu kopyala (license-server için tam ağaç gerekli)
COPY . .

# Dependency'leri yükle (workspace root). Customer paketinde olduğu
# gibi native modülleri build-from-source ile derle.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts \
    && npm_config_nodedir=/usr/local npm rebuild better-sqlite3 bcrypt --build-from-source --no-audit --no-fund

# ---------- Runtime image ----------
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build /app

# Workspace paketlerini @mailtrustai/* altına symlink'le.
# NOT: customer/dealer/license-server "apps/" altındadır, paket değildir
# — symlink yaratılmaz, aksi halde broken link oluşur.
RUN mkdir -p /app/node_modules/@mailtrustai \
  && for p in analyzer central-sync license-client license-core mail policy-client security shared storage; do \
        ln -sfn "/app/packages/$p" "/app/node_modules/@mailtrustai/$p"; \
     done

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

EXPOSE 3200
VOLUME ["/app/data"]

# tini ile signal handling (graceful shutdown)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--use-system-ca", "apps/license-server/server.js"]
