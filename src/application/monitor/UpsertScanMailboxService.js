// ============================================================
// USE-CASE: Tarama posta kutusu (scan mailbox) ekle / güncelle
//   • Ayar diskine kaydeder, şifreleri encrypt eder
//   • Mevcut monitörü durdurup yenisini başlatır (enabled ise)
// ============================================================
const { loadSettings, saveSettings } = require('../../storage/settingsStore');
const { encrypt } = require('../../imap/connection');
const {
    scanMailboxMonitors,
    startScanMailboxMonitorSupervised,
    stopScanMailboxMonitor
} = require('../../services/scanMailboxService');

/**
 * Tarama posta kutusu kaydını ekler veya günceller.
 *
 * @param {object} input - validated request body alanları
 * @param {object} license - appState.checkLicense sonucu (zaten doğrulandı)
 * @returns {Promise<{ ok:true, body:{ success:true, count:number } } |
 *                   { ok:false, status:number, body:object }>}
 */
async function upsertScanMailbox(input, license) {
    const {
        imapHost, imapPort, imapEmail, imapPassword, imapTls, imapRejectUnauthorized,
        smtpHost, smtpPort, smtpPassword,
        reportLang, enabled, reportMode, reportTo, reportToForwarder,
        allowedDomains,
        realtimeAlert,
        _existingEncryptedImapPassword
    } = input;

    // İzin verilen gönderen domain'leri — boş array = tüm domain'lere açık
    const normalizedAllowedDomains = Array.isArray(allowedDomains)
        ? [...new Set(
            allowedDomains
                .map(d => String(d || '').trim().toLowerCase().replace(/^@/, ''))
                .filter(d => d && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))
          )]
        : [];

    if (reportMode === 'all' && license.plan !== 'enterprise') {
        return {
            ok: false, status: 403,
            body: { error: 'Tüm mailler raporlama modu yalnızca Enterprise lisansında kullanılabilir.' }
        };
    }

    const current   = loadSettings();
    const mailboxes = current.scanMailboxes || [];
    const idx       = mailboxes.findIndex(s => s.imapEmail === imapEmail);

    // İki farklı kullanım var:
    //   • forwarder: kullanıcılar şüpheli maili buraya forward eder → sistem gönderene cevap yazar (tek olabilir)
    //   • realtime : kişinin kendi inbox'unu otomatik tarar, kendisine rapor mail'ler (Enterprise; çok sayıda)
    const purpose = realtimeAlert ? 'realtime' : 'forwarder';

    // "Yalnızca 1 hesap" limiti SADECE forwarder için geçerli
    if (purpose === 'forwarder' && idx < 0) {
        const otherForwarderCount = mailboxes.filter(s => (s.purpose || 'forwarder') === 'forwarder').length;
        if (otherForwarderCount >= 1) {
            return {
                ok: false, status: 403,
                body: {
                    error: 'Yalnızca 1 merkezi raporlama (forwarder) mail hesabı tanımlanabilir. Mevcut hesabı silip yenisini ekleyebilirsiniz.',
                    limitReached: true
                }
            };
        }
    }

    // Şifre payload'da boşsa rota katmanı mevcut encrypted şifreyi geçirir — onu kullan.
    const encryptedImapPassword = imapPassword
        ? encrypt(imapPassword)
        : _existingEncryptedImapPassword;
    const entry = {
        imapEmail,
        imapHost,
        imapPort:          Number(imapPort) || 993,
        imapPassword:      encryptedImapPassword,
        imapTls:           imapTls !== false && imapTls !== 'false',
        imapRejectUnauthorized: imapRejectUnauthorized !== false && imapRejectUnauthorized !== 'false',
        smtpHost:          smtpHost || imapHost,
        smtpPort:          Number(smtpPort) || 587,
        smtpPassword:      smtpPassword ? encrypt(smtpPassword) : encryptedImapPassword,
        reportLang:        reportLang || 'tr',
        reportMode:        reportMode === 'all' ? 'all' : 'risky',
        // İki BAĞIMSIZ alıcı bayrağı:
        //   reportToForwarder=true  → iletilen mailin göndericisine de gönder
        //   reportTo (dolu)         → bu sabit adrese de gönder
        // İkisi birlikte set ise rapor HER İKİ alıcıya da aynı anda yollanır.
        reportTo:          (reportTo || '').trim(),
        reportToForwarder: reportToForwarder === true,
        allowedDomains:    normalizedAllowedDomains,
        purpose,
        enabled:           enabled !== false && enabled !== 'false'
    };

    if (idx >= 0) mailboxes[idx] = entry; else mailboxes.push(entry);
    saveSettings({ ...current, scanMailboxes: mailboxes });

    // Varsa önceki monitörü + supervisor'ını durdur
    stopScanMailboxMonitor(imapEmail);

    if (entry.enabled) {
        // Supervisor korumasıyla başlat: ilk bağlantı başarısız olsa bile retry
        await startScanMailboxMonitorSupervised(entry);
    }

    return { ok: true, body: { success: true, count: mailboxes.length } };
}

/**
 * PATCH ile var olan kaydı kısmi günceller; enabled değişimini de yönetir.
 */
async function patchScanMailbox(imapEmail, patch, license) {
    if (patch.reportMode === 'all' && license.plan !== 'enterprise') {
        return {
            ok: false, status: 403,
            body: { error: 'Tüm mailler raporlama modu yalnızca Enterprise lisansında kullanılabilir.' }
        };
    }

    const current   = loadSettings();
    const mailboxes = current.scanMailboxes || [];
    const idx       = mailboxes.findIndex(s => s.imapEmail === imapEmail);
    if (idx < 0) return { ok: false, status: 404, body: { error: 'Scan mailbox not found' } };

    mailboxes[idx] = { ...mailboxes[idx], ...patch, imapEmail };
    saveSettings({ ...current, scanMailboxes: mailboxes });

    // Varsa önceki monitörü + supervisor'ını durdur
    stopScanMailboxMonitor(imapEmail);

    if (mailboxes[idx].enabled) {
        await startScanMailboxMonitorSupervised(mailboxes[idx]);
    }

    return { ok: true, body: { success: true } };
}

module.exports = { upsertScanMailbox, patchScanMailbox };
