# =========================================================
# MailTrustAI Dealer Portal image.
# Bayi paneli; lisansı kendi üretmez, license-server'a delege eder.
# license-core paketi bu image'da YOKTUR.
# =========================================================
FROM node:22-bookworm-slim AS builder
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Bayi imajında license-core yok — kazara sızmayı engelle.
RUN rm -rf packages/license-core apps/license-server apps/customer

RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts \
    && npm_config_nodedir=/usr/local npm rebuild bcrypt --build-from-source --no-audit --no-fund || true

# ---------- Runtime ----------
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build /app
RUN mkdir -p /app/node_modules/@mailtrustai \
  && for p in central-sync mail policy-client security shared; do \
        if [ -d "/app/packages/$p" ]; then \
            ln -sfn "/app/packages/$p" "/app/node_modules/@mailtrustai/$p"; \
        fi; \
     done

ENV NODE_ENV=production
EXPOSE 3100

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--use-system-ca", "apps/dealer/server.js"]
