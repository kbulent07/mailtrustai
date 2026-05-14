// ============================================================
// USE-CASE: IMAP üzerinden tek mesajın manuel taranması (/imap/scan)
// ============================================================
const { fetchAndParseEmail } = require('../../imap/scanner');
const { analyzeParsedEmailData } = require('./AnalyzeMessageService');
const { sendEnterpriseRiskAlert } = require('../../services/reportService');
const { findCachedImapScan, clearCachedImapScan } = require('../../storage/scanHistory');

/**
 * Bir IMAP hesabından belirtilen UID'li mesajı çeker, analiz eder ve
 * (Enterprise lisanslarda) hesap sahibine risk uyarısı gönderir.
 *
 * Kullanıcı isteği üzerine kalıcı (DB) önbellek eklendi:
 *   - forceRefresh=false (varsayılan) → DB'de kayıt varsa onu döner,
 *     fresh tarama yapmaz (IMAP'a bağlanmaz, AI'a istek atmaz).
 *   - forceRefresh=true → eski kayıt silinir, yeni tarama yapılır,
 *     sonuç recordScan üzerinden DB'ye kaydedilir (analyzeParsedEmailData
 *     bunu zaten yapar).
 *
 * @returns {Promise<{ ok: true, result: object, cached?: boolean } | { ok: false, status: number, body: object }>}
 */
async function runManualImapScan({ account, uid, folder, license, forceRefresh = false }) {
    const accountEmail = account?.email || '';

    if (forceRefresh) {
        // 🔄 Yeniden Tara: bu (account, uid) için kayıtlı tüm sonuçları sil
        try { clearCachedImapScan(accountEmail, uid); } catch (e) {
            console.warn('[ImapScan] clearCachedImapScan hata:', e.message);
        }
    } else {
        // Cache lookup — varsa anında döner, IMAP/AI'a hiç bağlanılmaz
        try {
            const cached = findCachedImapScan(accountEmail, uid);
            if (cached) {
                return { ok: true, result: { ...cached, _fromCache: true }, cached: true };
            }
        } catch (e) {
            console.warn('[ImapScan] findCachedImapScan hata:', e.message);
        }
    }

    const parsed = await fetchAndParseEmail(account, uid, folder);
    if (!parsed.success) {
        return { ok: false, status: 400, body: parsed };
    }

    const result = await analyzeParsedEmailData({
        parsedData: parsed.data,
        license,
        scanSource: 'imap-manual',
        account: accountEmail,
        // imap_email + imap_uid scan_history'ye kaydedilsin (cache anahtarı)
        extraFields: { imapEmail: accountEmail, imapUid: uid }
    });

    const riskAlert = await sendEnterpriseRiskAlert({
        result, license, to: accountEmail, reason: 'manual-imap-scan'
    });
    if (riskAlert) result.riskAlert = riskAlert;
    return { ok: true, result, cached: false };
}

module.exports = { runManualImapScan };
