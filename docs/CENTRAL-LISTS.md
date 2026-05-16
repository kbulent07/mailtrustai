# Merkezi whitelist / blacklist

## Saklama
Server tarafında `lists` tablosu — `(customer_id, kind, version, body_json, updated_at)`.
`kind` = `whitelist` | `blacklist`. Versiyon her güncellemede `+1` artar.

## Liste tipleri (body içinde)
- Whitelist: `{ domains: [], senders: [] }`
- Blacklist: `{ domains: [], senders: [], urls: [], attachmentHashes: [] }`

## Endpoint'ler
- `GET  /api/lists/:customerId/whitelist`
- `POST /api/lists/:customerId/whitelist`
- `GET  /api/lists/:customerId/blacklist`
- `POST /api/lists/:customerId/blacklist`
- `GET  /api/lists/:customerId/versions`

## Customer dağıtımı
`POST /api/customer-sync/bootstrap` ve `GET /api/customer-sync/pull` cevaplarında merge edilerek döner.
Customer bunları `data/central-lists.enc` içine **AES-256-GCM şifreli** olarak yazar.

## Merge kuralları (policy-client.evaluateAddress)
Öncelik sırası (en yüksek → en düşük):
1. **Local whitelist** — müşterinin kendi listesi
2. **Local blacklist** — müşterinin kendi listesi
3. **Central blacklist** — merkezden gelen
4. **Central whitelist** — merkezden gelen
5. nötr → analizci karar verir

Bu sıra ile müşteri istisnaları merkez politikasını ezebilir, ancak güvenlik için merkez blacklist her zaman merkez whitelist'inden öncedir.

## Hassas veri
Merkezde tutulan listeler müşteri PII'si içermemelidir (sadece domain/sender pattern, URL, hash).
