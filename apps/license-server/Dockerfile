FROM node:20-bookworm-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . .

FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build /app
RUN mkdir -p /app/node_modules/@mailtrustai \
  && for p in analyzer central-sync customer dealer license-client license-core license-server mail policy-client security shared storage; do ln -sfn "/app/packages/$p" "/app/node_modules/@mailtrustai/$p"; done
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 3200
VOLUME ["/app/data"]
CMD ["node", "apps/license-server/server.js"]
