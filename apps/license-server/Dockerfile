FROM node:22-bookworm-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . .
# Customer app license-server image'ında YOK
RUN rm -rf apps/customer apps/dealer
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 3200
VOLUME ["/app/data"]
CMD ["node", "--use-system-ca", "apps/license-server/server.js"]
