// ============================================================
// I18N — Turkish / English translations
// ============================================================
const I18N = {
    tr: {
        mode_upload: 'EML Dosya Yükle', mode_upload_desc: 'Sürükle-bırak veya dosya seç',
        mode_paste: 'Ham Kaynak Yapıştır', mode_paste_desc: 'E-posta kaynağını yapıştırın',
        mode_imap: 'IMAP Tarama', mode_imap_desc: 'Gelen kutusunu tara ve izle',
        upload_title: 'EML Dosyasını Sürükleyin veya Tıklayın',
        upload_desc: '.eml dosyası veya şüpheli eki yükleyin',
        paste_title: 'Ham E-posta Kaynağı',
        btn_analyze: 'Analiz Et', btn_new: 'Yeni', btn_activate: 'Etkinleştir',
        btn_close: 'Kapat', btn_test: 'Test Et', btn_save: 'Kaydet',
        btn_scan_selected: 'Seçilenleri Tara', btn_monitor: 'Otomatik İzle',
        scanning: 'Analiz ediliyor...', scanning_desc: 'E-posta güvenlik kontrolleri yapılıyor',
        history: 'Son Taramalar', settings: 'Ayarlar',
        license_title: 'Lisans Anahtarı', license_key: 'Lisans Anahtarı',
        imap_title: 'IMAP Gelen Kutusu', imap_add: 'IMAP Hesabı Ekle',
        imap_password: 'Şifre / Uygulama Şifresi',
        imap_no_account: 'Henüz IMAP hesabı eklenmedi',
        risk_safe: 'Güvenli', risk_safe_desc: 'Bu e-posta güvenli görünüyor',
        risk_low: 'Düşük Risk', risk_low_desc: 'Bazı uyarılar mevcut',
        risk_medium: 'Orta Risk', risk_medium_desc: 'Dikkatli olunması gereken noktalar var',
        risk_high: 'Yüksek Risk', risk_high_desc: 'Bu e-posta güvenlik tehditleri içeriyor',
        stat_score: 'Risk Skoru', stat_threats: 'Tehdit', stat_warnings: 'Uyarı', stat_safe: 'Güvenli',
        from: 'Gönderen', to: 'Alıcı', subject: 'Konu', date: 'Tarih', attachments: 'Ekler',
        no_history: 'Henüz tarama yapılmadı',
        license_free: 'Ücretsiz Plan', license_pro: 'Pro Plan', license_ent: 'Enterprise Plan',
        license_valid: 'Lisans geçerli ✅', license_invalid: 'Geçersiz lisans ❌',
        license_expired: 'Lisans süresi dolmuş ⏰',
        imap_test_ok: 'Bağlantı başarılı ✅', imap_test_fail: 'Bağlantı başarısız ❌',
        tab_all: 'Tümü', tab_header: 'Header', tab_content: 'İçerik', tab_link: 'Link', tab_attachment: 'Ekler',
        mode_scanmailbox: 'Tarama Posta Kutusu', mode_scanmailbox_desc: 'Gelen mail → otomatik rapor',
        scanmailbox_title: 'Tarama Posta Kutuları', scanmailbox_add: 'Tarama Posta Kutusu Ekle',
        scanmailbox_imap_account: 'IMAP Hesabı (izlenecek)',
        scanmailbox_smtp_user: 'SMTP Kullanıcı Adı', scanmailbox_smtp_password: 'SMTP Şifre',
        scanmailbox_smtp_secure: 'Şifreleme', scanmailbox_from_name: 'Gönderen Adı',
        scanmailbox_report_lang: 'Rapor Dili', scanmailbox_ignore_ssl: 'SSL Sertifikasını Yoksay',
        scanmailbox_enabled: 'Aktif', scanmailbox_disabled: 'Devre Dışı',
        scanmailbox_no_items: 'Henüz tarama posta kutusu eklenmedi',
        scanmailbox_requires_pro: 'Tarama posta kutusu Pro+ lisans gerektirir',
        smtp_test_ok: 'SMTP bağlantısı başarılı ✅', smtp_test_fail: 'SMTP bağlantısı başarısız ❌',
        monthly_limit_reached: 'Aylık tarama limitine ulaşıldı',
        monthly_usage: 'Bu ay tarama', license_monthly_limit: 'Aylık Limit',
        auto_reply_sent: 'Otomatik rapor gönderildi', auto_reply_failed: 'Rapor gönderilemedi'
    },
    en: {
        mode_upload: 'Upload EML File', mode_upload_desc: 'Drag & drop or browse',
        mode_paste: 'Paste Raw Source', mode_paste_desc: 'Paste email source code',
        mode_imap: 'IMAP Scan', mode_imap_desc: 'Scan inbox & monitor',
        upload_title: 'Drag EML File Here or Click',
        upload_desc: 'Upload .eml file or suspicious attachment',
        paste_title: 'Raw Email Source',
        btn_analyze: 'Analyze', btn_new: 'New', btn_activate: 'Activate',
        btn_close: 'Close', btn_test: 'Test', btn_save: 'Save',
        btn_scan_selected: 'Scan Selected', btn_monitor: 'Auto Monitor',
        scanning: 'Analyzing...', scanning_desc: 'Running email security checks',
        history: 'Recent Scans', settings: 'Settings',
        license_title: 'License Key', license_key: 'License Key',
        imap_title: 'IMAP Inbox', imap_add: 'Add IMAP Account',
        imap_password: 'Password / App Password',
        imap_no_account: 'No IMAP account added yet',
        risk_safe: 'Safe', risk_safe_desc: 'This email appears to be safe',
        risk_low: 'Low Risk', risk_low_desc: 'Some warnings found',
        risk_medium: 'Medium Risk', risk_medium_desc: 'Caution is advised',
        risk_high: 'High Risk', risk_high_desc: 'This email contains security threats',
        stat_score: 'Risk Score', stat_threats: 'Threats', stat_warnings: 'Warnings', stat_safe: 'Safe',
        from: 'From', to: 'To', subject: 'Subject', date: 'Date', attachments: 'Attachments',
        no_history: 'No scans yet',
        license_free: 'Free Plan', license_pro: 'Pro Plan', license_ent: 'Enterprise Plan',
        license_valid: 'License valid ✅', license_invalid: 'Invalid license ❌',
        license_expired: 'License expired ⏰',
        imap_test_ok: 'Connection successful ✅', imap_test_fail: 'Connection failed ❌',
        tab_all: 'All', tab_header: 'Header', tab_content: 'Content', tab_link: 'Links', tab_attachment: 'Attachments',
        mode_scanmailbox: 'Scan Mailbox', mode_scanmailbox_desc: 'Incoming mail → auto report',
        scanmailbox_title: 'Scan Mailboxes', scanmailbox_add: 'Add Scan Mailbox',
        scanmailbox_imap_account: 'IMAP Account (to monitor)',
        scanmailbox_smtp_user: 'SMTP Username', scanmailbox_smtp_password: 'SMTP Password',
        scanmailbox_smtp_secure: 'Encryption', scanmailbox_from_name: 'Sender Name',
        scanmailbox_report_lang: 'Report Language', scanmailbox_ignore_ssl: 'Ignore SSL Certificate',
        scanmailbox_enabled: 'Enabled', scanmailbox_disabled: 'Disabled',
        scanmailbox_no_items: 'No scan mailboxes configured yet',
        scanmailbox_requires_pro: 'Scan mailbox requires Pro+ license',
        smtp_test_ok: 'SMTP connection successful ✅', smtp_test_fail: 'SMTP connection failed ❌',
        monthly_limit_reached: 'Monthly scan limit reached',
        monthly_usage: 'Scans this month', license_monthly_limit: 'Monthly Limit',
        auto_reply_sent: 'Auto-reply report sent', auto_reply_failed: 'Failed to send report'
    }
};

let currentLang = localStorage.getItem('msa_lang') || 'tr';

function t(key) { return I18N[currentLang]?.[key] || I18N.tr[key] || key; }

// Satır içi literal çeviri: currentLang === 'tr' ? trText : enText yerine kullanılır.
// Üçüncü dil desteği eklendiğinde yalnızca bu fonksiyon güncellenir.
function _tLit(trText, enText) { return currentLang === 'tr' ? trText : enText; }

function applyLang() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });
    document.getElementById('btnLang').textContent = '🌐 ' + (currentLang === 'tr' ? 'EN' : 'TR');
}

function toggleLang() {
    currentLang = currentLang === 'tr' ? 'en' : 'tr';
    localStorage.setItem('msa_lang', currentLang);
    applyLang();
}
