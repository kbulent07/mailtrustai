// ============================================================
// USE-CASE: Tarama posta kutusu (scan mailbox) ekle / güncelle
//   • Ayar diskine kaydeder, şifreleri encrypt eder
//   • Mevcut monitörü durdurup yenisini başlatır (enabled ise)
// ============================================================
const { loadSettings, saveSettings } = require('../../storage/settingsStore');
const { encrypt } = require('../../imap/connection');
const { scanMailboxMonitors, startScanMailboxMonitor } = require('../../services/scanMailboxService');

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
        imapHost, imapPort, imapEmail, imapPassword, imapTls,
        smtpHost, smtpPort, smtpPassword,
        reportLang, enabled, reportMode, reportTo, reportToForwarder
    } = input;

    if (reportMode === 'all' && license.plan !== 'enterprise') {
        return {
            ok: false, status: 403,
            body: { error: 'Tüm mailler raporlama modu yalnızca Enterprise lisansında kullanılabilir.' }
        };
    }

    const current   = loadSettings();
    const mailboxes = current.scanMailboxes || [];
    const idx       = mailboxes.findIndex(s => s.imapEmail === imapEmail);

    // Sistemde yalnızca 1 merkezi raporlama mail hesabı kurulabilir (tüm lisans tipleri)
    if (idx < 0 && mailboxes.length >= 1) {
        return {
            ok: false, status: 403,
            body: {
                error: 'Yalnızca 1 merkezi raporlama mail hesabı tanımlanabilir. Mevcut hesabı silip yenisini ekleyebilirsiniz.',
                limitReached: true
            }
        };
    }

    const entry = {
        imapEmail,
        imapHost,
        imapPort:          Number(imapPort) || 993,
        imapPassword:      encrypt(imapPassword),
        imapTls:           imapTls !== false && imapTls !== 'false',
        smtpHost:          smtpHost || imapHost,
        smtpPort:          Number(smtpPort) || 587,
        smtpPassword:      smtpPassword ? encrypt(smtpPassword) : encrypt(imapPassword),
        reportLang:        reportLang || 'tr',
        reportMode:        reportMode === 'all' ? 'all' : 'risky',
        reportTo:          reportToForwarder ? '' : (reportTo || ''),
        reportToForwarder: reportToForwarder === true,
        enabled:           enabled !== false && enabled !== 'false'
    };

    if (idx >= 0) mailboxes[idx] = entry; else mailboxes.push(entry);
    saveSettings({ ...current, scanMailboxes: mailboxes });

    const existing = scanMailboxMonitors.get(imapEmail);
    if (existing) {
        await existing.stop();
        scanMailboxMonitors.delete(imapEmail);
    }
    if (entry.enabled) {
        await startScanMailboxMonitor(entry).catch(e =>
            console.error('[ScanMailbox] Start error:', e.message)
        );
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

    const existing = scanMailboxMonitors.get(imapEmail);
    if (existing) {
        await existing.stop();
        scanMailboxMonitors.delete(imapEmail);
    }
    if (mailboxes[idx].enabled) {
        await startScanMailboxMonitor(mailboxes[idx]).catch(e =>
            console.error('[ScanMailbox] Restart error:', e.message)
        );
    }

    return { ok: true, body: { success: true } };
}

module.exports = { upsertScanMailbox, patchScanMailbox };
