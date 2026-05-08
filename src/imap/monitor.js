// ============================================================
// IMAP REAL-TIME MONITOR (IDLE) — with auto-reconnect
// ============================================================
const { createConnection } = require('./connection');
const { parseEmail } = require('../analysis/parser');

const MAX_RECONNECT_DELAY_MS = 60 * 1000; // 60s üst sınır
const BASE_RECONNECT_DELAY_MS = 5000;

class ImapMonitor {
    constructor(account, onNewEmail) {
        this.account = account;
        this.onNewEmail = onNewEmail;
        this.client = null;
        this.lock = null;
        this.running = false;
        this._stopping = false;
        this._reconnectAttempts = 0;
        this._reconnectTimer = null;
    }

    async start() {
        if (this.running) {
            return { success: true, message: `Monitoring ${this.account.email}` };
        }
        // Dışarıdan yeniden start() çağrıldığında bekleyen zamanlayıcıyı iptal et
        // (ScanMailboxMonitor retry döngüsü ile çift _connect() yarış koşulunu önler)
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this._stopping = false;
        this._reconnectAttempts = 0;
        return this._connect();
    }

    async _connect() {
        try {
            this.client = await createConnection(this.account);
            await this.client.connect();
            this.lock = await this.client.getMailboxLock('INBOX');
            this.running = true;
            this._reconnectAttempts = 0;

            this.client.on('exists', async (data) => {
                try {
                    const curr = typeof data?.count === 'number' ? data.count : (this.client.mailbox?.exists || 0);
                    const prev = typeof data?.prevCount === 'number' ? data.prevCount : Math.max(curr - 1, 0);
                    if (curr <= prev) return;

                    // Aralıktaki TÜM mesajları sırayla işle (toplu mail almasında atlama olmasın)
                    const range = `${prev + 1}:${curr}`;
                    for await (const msg of this.client.fetch(range, { source: true, envelope: true, uid: true })) {
                        if (!msg || !msg.source) continue;
                        try {
                            const parsed = await parseEmail(msg.source);
                            if (parsed.success && this.onNewEmail) {
                                await this.onNewEmail({
                                    uid: msg.uid || msg.seq,
                                    email: parsed.data,
                                    account: this.account.email
                                });
                            }
                        } catch (e) {
                            console.error('[Monitor] mesaj işleme hatası (uid=' + (msg.uid || msg.seq) + '):', e.message);
                        }
                    }
                } catch (e) {
                    console.error('[Monitor] exists event error:', e.message);
                }
            });

            this.client.on('close', () => {
                this.running = false;
                this.lock = null;
                if (!this._stopping) {
                    this._scheduleReconnect();
                }
            });

            this.client.on('error', (err) => {
                console.error(`[Monitor] ${this.account.email} IMAP error:`, err.message);
            });

            console.log(`[Monitor] Bağlandı: ${this.account.email}`);
            return { success: true, message: `Monitoring ${this.account.email}` };
        } catch (e) {
            this.running = false;
            if (!this._stopping) {
                this._scheduleReconnect();
            }
            throw e;
        }
    }

    _scheduleReconnect() {
        if (this._stopping) return;
        const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(1.5, this._reconnectAttempts), MAX_RECONNECT_DELAY_MS);
        this._reconnectAttempts++;
        console.log(`[Monitor] ${this.account.email} bağlantısı kesildi. ${Math.round(delay / 1000)}s sonra yeniden bağlanılıyor... (deneme ${this._reconnectAttempts})`);

        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(async () => {
            if (this._stopping) return;
            // Eski client/lock temizle
            if (this.lock) { try { this.lock.release(); } catch (_) {} this.lock = null; }
            if (this.client) { try { await this.client.logout(); } catch (_) {} this.client = null; }

            try {
                await this._connect();
            } catch (err) {
                console.error(`[Monitor] ${this.account.email} yeniden bağlantı başarısız:`, err.message);
                // _connect içinden _scheduleReconnect zaten çağrıldı
            }
        }, delay);
    }

    async stop() {
        this._stopping = true;
        this._reconnectAttempts = 0;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this.running = false;
        if (this.lock) { try { this.lock.release(); } catch (_) {} this.lock = null; }
        if (this.client) { await this.client.logout().catch(() => {}); this.client = null; }
        return { success: true, message: 'Monitor stopped' };
    }

    isRunning() { return this.running; }
}

module.exports = { ImapMonitor };
