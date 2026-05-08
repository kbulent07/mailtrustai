// ============================================================
// IMAP BAĞLANTI HAVUZU (Connection Pool)
//
// Sorun: Her listEmails / fetchAndParseEmail çağrısında yeni
// IMAP bağlantısı açılıp kapanıyor → yüksek gecikme, kota tüketimi.
//
// Çözüm: Her hesap (e-posta) için kimlik doğrulanmış bağlantıyı
// belirli bir süre açık tut; yeni istek geldiğinde yeniden
// kullan. Bağlantı bozuksa veya süresi dolmuşsa otomatik
// yenile.
//
// Havuz özellikleri:
//   • Hesap başına maks 1 aktif bağlantı
//   • 5 dakika kullanılmazsa otomatik kapat
//   • IMAP ping (NOOP) ile sağlık kontrolü
//   • Thread-safe değil ama Node.js tek thread → sorun yok
//   • Monitör bağlantıları (imapflow'un kendi yönetimi) bu
//     havuzun dışında tutulur
// ============================================================
const { createConnection } = require('./connection');

const IDLE_TIMEOUT_MS    = 5 * 60 * 1000;  // 5 dk boşta → kapat
const HEALTH_CHECK_MS    = 30 * 1000;       // 30s'de bir NOOP

class ImapConnectionPool {
    constructor() {
        // Map<email, PoolEntry>
        // PoolEntry: { client, account, lastUsedAt, busy, healthTimer }
        this._pool = new Map();

        // Temizlik döngüsü — boşta kalan bağlantıları kapat
        this._cleanupTimer = setInterval(() => this._cleanup(), 60 * 1000);
        this._cleanupTimer.unref(); // Node.js'in kapanmasını engelleme
    }

    // ─── Bağlantı al ──────────────────────────────────────
    /**
     * Verilen hesap için kullanılabilir bir IMAP bağlantısı döner.
     * Mevcut bağlantı sağlıklıysa yeniden kullanır; değilse yeni oluşturur.
     * Çağıran, işi bitince release() çağırmalıdır.
     */
    async acquire(account) {
        const key   = account.email;
        const entry = this._pool.get(key);

        if (entry && !entry.busy) {
            // Bağlantı var, boşta — sağlık kontrolü yap
            const healthy = await this._isHealthy(entry.client);
            if (healthy) {
                entry.busy       = true;
                entry.lastUsedAt = Date.now();
                return entry.client;
            }
            // Bağlantı bozuk — temizle
            await this._destroyEntry(key);
        }

        // Yeni bağlantı oluştur
        const client = await createConnection(account);
        await client.connect();

        this._pool.set(key, {
            client,
            account,
            lastUsedAt: Date.now(),
            busy:       true
        });

        return client;
    }

    // ─── Bağlantıyı serbest bırak ─────────────────────────
    release(account) {
        const entry = this._pool.get(account.email);
        if (entry) {
            entry.busy       = false;
            entry.lastUsedAt = Date.now();
        }
    }

    // ─── Bağlantıyı geçersiz kıl (hata sonrası) ──────────
    async invalidate(account) {
        await this._destroyEntry(account.email);
    }

    // ─── İstatistik ───────────────────────────────────────
    getStats() {
        const entries = [...this._pool.values()];
        return {
            total:  entries.length,
            busy:   entries.filter(e => e.busy).length,
            idle:   entries.filter(e => !e.busy).length,
            emails: [...this._pool.keys()]
        };
    }

    // ─── Tüm havuzu kapat ─────────────────────────────────
    async closeAll() {
        clearInterval(this._cleanupTimer);
        for (const key of [...this._pool.keys()]) {
            await this._destroyEntry(key);
        }
    }

    // ─── Özel yardımcılar ─────────────────────────────────
    async _isHealthy(client) {
        try {
            if (!client || typeof client.noop !== 'function') return false;
            await client.noop();
            return true;
        } catch {
            return false;
        }
    }

    async _destroyEntry(key) {
        const entry = this._pool.get(key);
        if (!entry) return;
        this._pool.delete(key);
        try { await entry.client.logout(); } catch {}
    }

    async _cleanup() {
        const now = Date.now();
        for (const [key, entry] of this._pool.entries()) {
            if (!entry.busy && now - entry.lastUsedAt > IDLE_TIMEOUT_MS) {
                console.log(`[ImapPool] Boşta bağlantı kapatıldı: ${key}`);
                await this._destroyEntry(key);
            }
        }
    }
}

// Tek örnek — uygulama genelinde paylaşılır
const pool = new ImapConnectionPool();

// Uygulama kapanırken tüm bağlantıları kapat
process.on('exit',    () => pool.closeAll().catch(() => {}));
process.on('SIGTERM', () => pool.closeAll().then(() => process.exit(0)).catch(() => process.exit(0)));

module.exports = pool;
