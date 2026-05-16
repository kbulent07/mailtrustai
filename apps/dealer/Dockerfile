FROM node:22-bookworm-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . .
# Dealer image: customer ve license-server klasörleri YOK.
RUN rm -rf apps/customer apps/license-server
# license-core dealer'da KALABİLİR (gerekirse plan info), ama license üretimi
# license-server'a delege edildiği için kullanılmayabilir.
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build /app
ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "--use-system-ca", "apps/dealer/server.js"]
