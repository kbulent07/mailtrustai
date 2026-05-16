# Migrations

Şu an için tüm tablolar `db.js` içinde `CREATE TABLE IF NOT EXISTS` ile boot anında oluşturulur. Şema değişikliği gerekiyorsa bu klasöre sıralı SQL dosyaları (`0001_*.sql`, `0002_*.sql`) ekleyin ve `db.js`'i bunları çalıştıracak şekilde güncelleyin.

İlk şema:
- dealers, customers, licenses, activations, audit_log, policies, lists, api_policies
