// ============================================================
// HTTP routes: IMAP hesabı yönetimi ve manuel inbox tarama
// ============================================================
const express = require('express');

const { testConnection, addAccount, removeAccount, updateAccount, loadCredentials } =
    require('../../../imap/connection');
const { listEmails }              = require('../../../imap/scanner');
const { testSmtpConnection }      = require('../../../smtp/sender');
const { runManualImapScan }       =
    require('../../../application/analyze/AnalyzeImapMailService');
const { checkLicense, checkDailyLimit, checkMonthlyLimit } =
    require('../../../services/appState');

const router = express.Router();

// ─── Role bazlı erişim kontrolü ──────────────────────────────────────────────
// "user" rolü yalnız kendi imapEmail'ini görür / tarayabilir; ekleme/silme yapamaz.
function _isCustomerUser(req) {
    return req.customerUser && req.customerUser.role === 'user';
}
function _customerUserImapEmail(req) {
    return req.customerUser?.imapEmail || null;
}
function _emailMatchesUser(req, email) {
    const target = _customerUserImapEmail(req);
    if (!target) return false;
    return String(email || '').toLowerCase() === String(target).toLowerCase();
}

router.post('/imap/test', async (req, res) => {
    // user rolü: sadece kendi e-postası için test yapabilir
    if (_isCustomerUser(req) && !_emailMatchesUser(req, req.body?.email)) {
        return res.status(403).json({ error: 'Yalnız kendi IMAP hesabınızı test edebilirsiniz.' });
    }
    res.json(await testConnection(req.body));
});

router.post('/imap/accounts', async (req, res) => {
    // user rolü: IMAP hesabı ekleyemez/değiştiremez (yalnız admin)
    if (_isCustomerUser(req)) {
        return res.status(403).json({ error: 'IMAP hesabı ekleme/güncelleme yalnız admin yetkisinde.' });
    }
    if (!req.body?.email || !req.body?.host)
        return res.status(400).json({ error: 'Email and host are required' });

    const existing = loadCredentials().find(a => a.email === req.body.email);
    const requestedPassword = req.body?.password;
    const keepExistingPassword = requestedPassword === '__KEEP_EXISTING_PASSWORD__';
    const password = (!requestedPassword || keepExistingPassword) ? existing?.password : requestedPassword;
    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }

    const accounts = addAccount({
        ...req.body,
        password,
        autoSummaryReport: req.body.autoSummaryReport === true || req.body.autoSummaryReport === 'true'
    });
    res.json({ success: true, count: accounts.length });
});

router.delete('/imap/accounts/:email', (req, res) => {
    if (_isCustomerUser(req)) {
        return res.status(403).json({ error: 'IMAP hesabı silme yalnız admin yetkisinde.' });
    }
    res.json({ success: true, count: removeAccount(req.params.email).length });
});

router.get('/imap/accounts', (req, res) => {
    let list = loadCredentials();
    // user rolü: yalnız kendi IMAP hesabını gör
    if (_isCustomerUser(req)) {
        const own = _customerUserImapEmail(req);
        list = list.filter(a => String(a.email || '').toLowerCase() === String(own || '').toLowerCase());
    }
    res.json(list.map(a => ({
        email: a.email, host: a.host, port: a.port,
        autoSummaryReport: a.autoSummaryReport === true,
        rejectUnauthorized: a.rejectUnauthorized !== false,
        moveHighRiskToQuarantine: a.moveHighRiskToQuarantine === true
    })));
});

router.patch('/imap/accounts/:email/report', (req, res) => {
    const email = decodeURIComponent(req.params.email);
    if (_isCustomerUser(req) && !_emailMatchesUser(req, email)) {
        return res.status(403).json({ error: 'Yalnız kendi hesabınızın ayarını değiştirebilirsiniz.' });
    }
    const updated = updateAccount(email, { autoSummaryReport: req.body.enabled === true || req.body.enabled === 'true' });
    if (!updated) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, email, autoSummaryReport: updated.autoSummaryReport === true });
});

router.post('/imap/list', async (req, res) => {
    const license = checkLicense(req);
    if (!license.features?.imapConnection)
        return res.status(403).json({ error: 'IMAP tarama Enterprise lisansı gerektirir' });

    const { email, folder, limit } = req.body;
    // user rolü: yalnız kendi e-postası
    if (_isCustomerUser(req) && !_emailMatchesUser(req, email)) {
        return res.status(403).json({ error: 'Yalnız kendi IMAP hesabınızı listeleyebilirsiniz.' });
    }
    const account = loadCredentials().find(a => a.email === email);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const result = await listEmails(account, folder, limit);
    res.status(result.success ? 200 : 400).json(result);
});

router.post('/imap/scan', async (req, res) => {
    const license = checkLicense(req);
    if (!license.features?.inboxScan)   return res.status(403).json({ error: 'Inbox tarama Enterprise lisansı gerektirir' });

    const { email, uid, folder, forceRefresh } = req.body;
    // user rolü: yalnız kendi e-postası
    if (_isCustomerUser(req) && !_emailMatchesUser(req, email)) {
        return res.status(403).json({ error: 'Yalnız kendi IMAP hesabınızdan mail tarayabilirsiniz.' });
    }
    const account = loadCredentials().find(a => a.email === email);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Quota check'i SADECE fresh scan'lerde yap — cache'ten dönüyorsak limit etkilemesin
    const isForce = forceRefresh === true || forceRefresh === 'true';
    const isFresh = isForce;  // not-force ise henüz cache var mı bilmiyoruz — service'de bakılır
    // Service'e ilet; limit check'i fresh scan döndüğünde uygulanacak.
    // Pratik yaklaşım: limit kontrolünü force durumunda yap, cache hit ise atla.
    if (isForce) {
        if (!checkDailyLimit(license))      return res.status(429).json({ error: 'Daily scan limit reached' });
        if (!checkMonthlyLimit(license))    return res.status(429).json({ error: 'Monthly scan limit reached' });
    }

    const out = await runManualImapScan({ account, uid, folder, license, forceRefresh: isForce });
    if (!out.ok) return res.status(out.status).json(out.body);

    // Eğer fresh scan yapıldıysa (cache'ten dönmediyse) ve force değilse — bu da bir
    // yeni scan'di — limit kontrolü retrospektif yap (sayaç artırma zaten içeride).
    if (!out.cached && !isForce) {
        if (!checkDailyLimit(license))   return res.status(429).json({ error: 'Daily scan limit reached' });
        if (!checkMonthlyLimit(license)) return res.status(429).json({ error: 'Monthly scan limit reached' });
    }
    res.json(out.result);
});

router.post('/smtp/test', async (req, res) => {
    res.json(await testSmtpConnection(req.body));
});

module.exports = router;
