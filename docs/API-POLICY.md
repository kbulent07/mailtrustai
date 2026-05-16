# Merkezi API policy

## Amaç
Hangi AI/TI provider'ın hangi planda kullanılabileceğini, rate-limit ve quota'larını **merkezden** yönetmek.
API **key** değerleri merkeze gönderilmez — yalnızca policy.

## Saklama
`api_policies` tablosu — `(customer_id, version, body_json, updated_at)`.

## Body örneği
```json
{
  "allowedProviders": ["openai", "claude", "virustotal"],
  "rateLimit": { "perMinute": 60 },
  "dailyQuota":  10000,
  "monthlyQuota": 200000,
  "centralApiProxyEnabled": false,
  "centralApiProxyEndpoint": "https://proxy.mailtrustai.com",
  "model": { "openai": "gpt-4o-mini", "claude": "claude-sonnet-4-6" }
}
```

## Endpoint'ler
- `GET  /api/config/:customerId/api-policy`
- `POST /api/config/:customerId/api-policy`
- `GET  /api/config/:customerId/version`

## Customer tarafı
`packages/policy-client.evaluateApiPolicy(provider)` çağrısı:
- provider izinli mi
- centralApiProxy aktif mi
- rate-limit/quota değerleri

döner. Customer kendi API key'lerini **local encrypted storage** içinde tutar
(`packages/security.encryptJSON`); bu değerler hiçbir zaman merkeze gönderilmez,
yalnızca `configured | not_configured` özeti heartbeat'e dahil edilir.

## Central API proxy (opsiyonel feature)
Müşterinin kendi key'i yoksa, `centralApiProxyEnabled=true` ile merkezi proxy
üzerinden çağrı yapılabilir. Bu durumda:
- proxy customer token ile auth eder
- merkez tarafında quota enforcement yapılır
- mail içeriği yine yalnızca işlem süresince proxy'ye gider (loglanmaz)
