# Merkezi sync akışı

## Endpoint'ler (license-server'da)

| Endpoint | Yön |
|----------|-----|
| `POST /api/customer-sync/bootstrap` | customer → server (ilk açılış) |
| `POST /api/customer-sync/heartbeat` | customer → server (periyodik) |
| `GET  /api/customer-sync/pull`      | customer → server (policy/list/api-policy güncelleme) |
| `POST /api/customer-sync/ack`       | customer → server (uygulananları onay) |

## Heartbeat payload (customer → server)

```json
{
  "licenseKeyHash": "...", "customerId": "...", "dealerId": "...",
  "activationId": "...", "instanceId": "inst_xxx",
  "appVersion": "2.0.0", "buildVersion": "dev", "nodeVersion": "22.x",
  "environment": "production", "hostnameHash": "sha256(host)",
  "healthStatus": "ok",
  "enabledFeatures": { "imapMonitor": true, "deepAi": false },
  "plan": "pro", "tier": "pro", "licenseStatus": "active",
  "monthlyScanCount": 1234, "dailyScanCount": 45,
  "mailboxCount": 2, "userCount": 3,
  "localPolicyVersion": 7, "localWhitelistVersion": 12,
  "localBlacklistVersion": 15, "localApiConfigVersion": 4,
  "services": {
    "imapMonitor": "running", "smtpReporter": "configured",
    "quarantine": "enabled", "aiProvider": "configured"
  },
  "errorSummary": null,
  "lastHeartbeatAt": "2026-05-16T12:00:00.000Z"
}
```

Bu payload `packages/shared.scrubPII` ile yasak alan filtresinden geçer.
Server tarafında `apps/license-server/routes/customerSync.routes.js#ensureNoPII`
yasak alan görürse **422** döner.

## Pull cevabı

Versiyon farkı varsa hangi alan değiştiyse o döner:

```json
{ "policy": { "version": 8, ... }, "lists": { "version": 13, "whitelist": {...}, "blacklist": {...} } }
```

Customer her başarılı pull'dan sonra `/api/customer-sync/ack` çağırır.

## Retry/Backoff

`packages/central-sync/index.js` exponential backoff (1s → 30s, max 3 retry varsayılan). Tamamı başarısız olsa bile customer çalışmaya devam eder; mevcut local cache (encrypted) ile analiz sürer.
