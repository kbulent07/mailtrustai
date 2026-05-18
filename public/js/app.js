// ============================================================
// MAILTRUSTAI - Frontend Application
// ============================================================

// ────────────────────────────────────────────────────────────
// Production console suppression
// Localhost/127.0.0.1 dışındaki origin'lerde console.log/debug/info
// bastırılır (network sniff'i + DevTools clutter azaltır).
// console.warn ve console.error production'da DA görünür (gerçek sorunlar).
// Debug için: ?debug=1 query param ile devre dışı bırakılabilir.
// ────────────────────────────────────────────────────────────
(function suppressDevLogsInProd() {
    try {
        const host = window.location.hostname;
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host === '';
        const debugFlag = window.location.search.includes('debug=1');
        if (!isLocal && !debugFlag) {
            const noop = () => {};
            console.log   = noop;
            console.info  = noop;
            console.debug = noop;
            // console.warn ve console.error KALIR
        }
    } catch (_) { /* silent */ }
})();

// ────────────────────────────────────────────────────────────
// UI HELPERS — Toast & Dialog (alert/confirm replacement)
// ────────────────────────────────────────────────────────────
(function initToastContainer() {
    if (document.getElementById('msaToastContainer')) return;
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('msaToastContainer')) return;
        const c = document.createElement('div');
        c.id = 'msaToastContainer';
        document.body.appendChild(c);
    });
})();

function _ensureToastHost() {
    let host = document.getElementById('msaToastContainer');
    if (!host) {
        host = document.createElement('div');
        host.id = 'msaToastContainer';
        document.body.appendChild(host);
    }
    return host;
}

/**
 * Profesyonel toast bildirim göster.
 * @param {string} message - mesaj
 * @param {'info'|'success'|'error'|'warning'} type
 * @param {Object} [opts] - { title, duration }
 */
function showToast(message, type = 'info', opts = {}) {
    const host = _ensureToastHost();
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    const duration = Number.isFinite(opts.duration) ? opts.duration : (type === 'error' ? 6000 : 3500);

    const toast = document.createElement('div');
    toast.className = `msa-toast ${type}`;
    toast.innerHTML = `
        <div class="msa-toast-icon">${icons[type] || 'ℹ️'}</div>
        <div class="msa-toast-body">
            ${opts.title ? `<div class="msa-toast-title">${_escHtml(opts.title)}</div>` : ''}
            <div>${_escHtml(message)}</div>
        </div>
        <button class="msa-toast-close" aria-label="Kapat">✕</button>
    `;

    const close = () => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 220);
    };
    toast.querySelector('.msa-toast-close').addEventListener('click', close);
    host.appendChild(toast);
    if (duration > 0) setTimeout(close, duration);
    return toast;
}

/**
 * Brand'li onay dialog. Promise<boolean> döner.
 * @param {Object} opts - { title, message, confirmText, cancelText, danger, icon }
 */
function showConfirm(opts = {}) {
    return new Promise((resolve) => {
        const {
            title = 'Onay Gerekli',
            message = 'Devam etmek istediğinizden emin misiniz?',
            confirmText = 'Onayla',
            cancelText = 'İptal',
            danger = false,
            icon = danger ? '⚠️' : '❓',
            type = danger ? 'danger' : ''
        } = opts;

        const backdrop = document.createElement('div');
        backdrop.id = 'msaDialogBackdrop';
        backdrop.innerHTML = `
            <div class="msa-dialog ${type}" role="dialog" aria-modal="true">
                <div class="msa-dialog-header">
                    <div class="msa-dialog-icon">${icon}</div>
                    <div class="msa-dialog-title">${_escHtml(title)}</div>
                </div>
                <div class="msa-dialog-body">${_escHtml(message)}</div>
                <div class="msa-dialog-actions">
                    <button class="msa-dialog-btn msa-dialog-btn-secondary" data-action="cancel">${_escHtml(cancelText)}</button>
                    <button class="msa-dialog-btn ${danger ? 'msa-dialog-btn-danger' : 'msa-dialog-btn-primary'}" data-action="confirm">${_escHtml(confirmText)}</button>
                </div>
            </div>
        `;

        const cleanup = (val) => {
            backdrop.remove();
            document.removeEventListener('keydown', escHandler);
            resolve(val);
        };
        const escHandler = (e) => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter')  cleanup(true);
        };

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) cleanup(false);
            const action = e.target.closest('[data-action]')?.getAttribute('data-action');
            if (action === 'confirm') cleanup(true);
            if (action === 'cancel')  cleanup(false);
        });

        document.body.appendChild(backdrop);
        document.addEventListener('keydown', escHandler);
        setTimeout(() => backdrop.querySelector('[data-action="confirm"]')?.focus(), 60);
    });
}

/**
 * Brand'li bilgi/uyarı dialog (tek butonlu). Promise<void> döner.
 * @param {Object} opts - { title, message, buttonText, type, icon }
 */
function showAlert(opts = {}) {
    if (typeof opts === 'string') opts = { message: opts };
    return new Promise((resolve) => {
        const {
            title = 'Bilgi',
            message = '',
            buttonText = 'Tamam',
            type = 'info',
            icon = ({ info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' })[type] || 'ℹ️'
        } = opts;

        const backdrop = document.createElement('div');
        backdrop.id = 'msaDialogBackdrop';
        backdrop.innerHTML = `
            <div class="msa-dialog ${type}" role="dialog" aria-modal="true">
                <div class="msa-dialog-header">
                    <div class="msa-dialog-icon">${icon}</div>
                    <div class="msa-dialog-title">${_escHtml(title)}</div>
                </div>
                <div class="msa-dialog-body">${_escHtml(message)}</div>
                <div class="msa-dialog-actions">
                    <button class="msa-dialog-btn msa-dialog-btn-primary" data-action="ok">${_escHtml(buttonText)}</button>
                </div>
            </div>
        `;
        const cleanup = () => {
            backdrop.remove();
            document.removeEventListener('keydown', escHandler);
            resolve();
        };
        const escHandler = (e) => { if (e.key === 'Escape' || e.key === 'Enter') cleanup(); };
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) cleanup();
            if (e.target.closest('[data-action="ok"]')) cleanup();
        });
        document.body.appendChild(backdrop);
        document.addEventListener('keydown', escHandler);
        setTimeout(() => backdrop.querySelector('[data-action="ok"]')?.focus(), 60);
    });
}

function _escHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ────────────────────────────────────────────────────────────
// Native alert() -> showToast monkey-patch.
// Mevcut kodun 44 alert() çağrısı native blocking dialog yerine
// brand-uyumlu toast bildirimi gösterir. UX tutarlılığı + mobile UX iyileşir.
// NOT: confirm() monkey-patch'i SYNC/ASYNC uyumsuzluğu yaratır — manuel refactor.
// ────────────────────────────────────────────────────────────
const _nativeAlert = window.alert.bind(window);
window.alert = function (message) {
    try { showToast(String(message ?? ''), 'warning', { title: 'Uyarı' }); }
    catch (_) { _nativeAlert(message); }   // showToast hazır değilse fallback
};

// Teknik hata mesajlarını kullanıcı dostu Türkçeye çevirir
function humanizeAnalyzeError(msg) {
    const m = String(msg || '').toLowerCase();
    if (m.includes('limit reached'))   return 'Aylık tarama limitiniz dolmuş. Lisansınızı yenileyin veya ay sonunu bekleyin.';
    if (m.includes('daily'))           return 'Günlük tarama limitiniz dolmuş. Lütfen yarın tekrar deneyin.';
    if (m.includes('failed to fetch')) return 'Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
    if (m.includes('analysis failed')) return 'E-posta analiz edilemedi. Dosyanın geçerli bir .eml/.msg formatında olduğundan emin olun.';
    if (m.includes('no eml file'))     return 'Lütfen bir e-posta dosyası seçin (.eml veya .msg).';
    if (m.includes('parse'))           return 'E-posta dosyası okunamadı. Dosya bozulmuş olabilir.';
    if (m.includes('license'))         return 'Lisansınızda bir sorun var. Yöneticinizle iletişime geçin.';
    if (m.includes('http 4') || m.includes('http 5')) return 'Sunucu hatası. Lütfen birazdan tekrar deneyin.';
    return msg || 'Bilinmeyen bir hata oluştu.';
}

let currentMode = 'upload';
let currentResult = null;
let licenseKey = localStorage.getItem('msa_license') || '';
let licenseInfo = null;
let ws = null;
let currentImapEmail = null;
let activeMonitorEmails = new Set();
let currentImapMessages = [];
let currentImapUid = null;
let currentImapLimit = 30;
let currentImapHasMore = false;
let currentImapTotal = 0;
let selectedImapUids = new Set();
let currentHistoryResults = [];
let imapScanToken = 0;
let resetFallbackTimer = null;
let activeReportMenuEmail = null;
// IMAP tarama önbelleği — in-memory + localStorage persist
// Key: `${email}::${uid}`  Value: scan result objesi
// LocalStorage'da tek key altında tutulur (JSON serialize). LRU benzeri:
// max 200 entry, dolu olursa en eskileri silinir.
const imapReportCache = new Map();
const inFlightImapScans = new Set();
const IMAP_CACHE_KEY = 'msa_imap_scan_cache_v1';
const IMAP_CACHE_MAX = 200;

(function _loadImapCacheFromStorage() {
    try {
        const raw = localStorage.getItem(IMAP_CACHE_KEY);
        if (!raw) return;
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
            for (const [k, v] of Object.entries(obj)) {
                imapReportCache.set(k, v);
            }
        }
    } catch { /* sessizce — bozuk cache ise yok say */ }
})();

function _persistImapCache() {
    try {
        // Map → plain object. Max 200 entry tut (en yenisi, fazlasını kes)
        const entries = Array.from(imapReportCache.entries());
        const trimmed = entries.length > IMAP_CACHE_MAX
            ? entries.slice(-IMAP_CACHE_MAX)
            : entries;
        const obj = Object.fromEntries(trimmed);
        localStorage.setItem(IMAP_CACHE_KEY, JSON.stringify(obj));
        // imapReportCache'i de aynı trim ile güncelle
        if (entries.length > IMAP_CACHE_MAX) {
            imapReportCache.clear();
            for (const [k, v] of trimmed) imapReportCache.set(k, v);
        }
    } catch (e) {
        // QuotaExceededError → en eski yarısını sil ve yeniden dene
        if (String(e?.name || '').includes('Quota')) {
            try {
                const entries = Array.from(imapReportCache.entries());
                const keep = entries.slice(-Math.floor(IMAP_CACHE_MAX / 2));
                imapReportCache.clear();
                for (const [k, v] of keep) imapReportCache.set(k, v);
                localStorage.setItem(IMAP_CACHE_KEY, JSON.stringify(Object.fromEntries(keep)));
            } catch {}
        }
    }
}

function _deleteImapCacheEntry(key) {
    imapReportCache.delete(key);
    _persistImapCache();
}
let currentExecutiveDashboard = null;

document.addEventListener('DOMContentLoaded', () => {
    applyLang();
    // Rol bazlı UI uygula (admin/user)
    applyCustomerRoleUI();
    setupUploadZone();
    loadHistory();
    // Lisans önceliği: localStorage → server'da kayıtlı (restart/yeni cihaz korumalı)
    syncLicenseFromServer().then(() => {
        if (licenseKey) validateStoredLicense();
    });
    connectWebSocket();
    loadImapAccounts();
    initializeNavigationState();
    renderImapReportPlaceholder(t('imap_no_account'));
    updateScanSelectedButton();

    // ─── OTX import dosya seçici — programmatik event bağlama ───
    // (inline onchange'e güvenmek yerine addEventListener kullanıyoruz)
    const _otxFileInput = document.getElementById('userTdImportFile');
    if (_otxFileInput) {
        _otxFileInput.addEventListener('change', function () {
            if (this.files && this.files[0]) userTdImport(this);
        });
    }
});

// Servisteki kalıcı (kayıtlı) lisansı al; localStorage boşsa veya farklıysa eşitle.
// Versiyon geçişi / yeni cihaz / sekmeler arası tutarlılığı sağlar.
async function syncLicenseFromServer() {
    try {
        const res = await fetch('/api/license');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.active && data.licenseKey) {
            // Yerelde lisans yoksa veya farklıysa server'dakini benimse
            if (!licenseKey || licenseKey !== data.licenseKey) {
                licenseKey = data.licenseKey;
                localStorage.setItem('msa_license', licenseKey);
                console.log('[License] Server\'daki kayıtlı lisans yüklendi:', data.maskedKey);
            }
        }
    } catch (e) {
        // Sunucu erişilemezse sessizce devam et
    }
}

// ============================================================
// MODE SWITCHING
// ============================================================
function selectMode(mode, updateState = true) {
    // Müşteri user rolü: scan-mailbox panelini açamaz (admin işi).
    // IMAP'i açabilir ama orada da admin butonları gizli.
    if (mode === 'scan-mailbox' && getCustomerRole() === 'user') {
        if (updateState) {
            showToast(
                _tLit('Tarama Posta Kutusu yönetimi yalnız müşteri yönetici hesabında.', 'Scan Mailbox management is admin-only.'),
                'warning',
                { title: '🔒 Yetki Yok' }
            );
        }
        mode = 'imap';
    }
    // Lisans gate'leri — yetersizse güvenli mode'a düş, kullanıcı tetiklediyse uyar
    if (mode === 'imap' && !licenseInfo?.features?.imapConnection) {
        if (updateState) {
            showToast(
                _tLit('IMAP Tarama yalnızca Enterprise lisansında kullanılabilir.', 'IMAP Scan is available only with an Enterprise license.'),
                'warning',
                { title: '🔒 Lisans Gerekli' }
            );
        }
        mode = 'upload';
    }
    if (mode === 'scan-mailbox' && !licenseInfo?.features?.scanMailbox) {
        if (updateState) {
            showToast(
                _tLit('Tarama Posta Kutusu Pro veya Enterprise lisansı gerektirir.', 'Scan Mailbox requires a Pro or Enterprise license.'),
                'warning',
                { title: '🔒 Lisans Gerekli' }
            );
        }
        mode = 'upload';
    }

    currentMode = mode;

    // Mobil IMAP rapor modu sıfırla (mod değişimi)
    document.body.removeAttribute('data-imap-mode');

    document.querySelectorAll('.scan-mode').forEach((el) => el.classList.remove('active'));
    document.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');

    document.getElementById('panelUpload').classList.toggle('hidden', mode !== 'upload');
    document.getElementById('panelPaste').classList.toggle('hidden', mode !== 'paste');
    document.getElementById('panelImap').classList.toggle('hidden', mode !== 'imap');
    document.getElementById('panelScanMailbox').classList.toggle('hidden', mode !== 'scan-mailbox');
    document.getElementById('resultsPanel').classList.add('hidden');
    document.getElementById('scanProgress').classList.add('hidden');
    document.getElementById('scanModes').classList.remove('hidden');

    if (mode === 'imap') {
        document.getElementById('connectionBar').classList.remove('hidden');
    } else {
        document.getElementById('connectionBar').classList.add('hidden');
    }

    if (mode === 'scan-mailbox') {
        loadScanMailboxes();
    }

    if (updateState && (!history.state || history.state.view !== 'results')) {
        history.replaceState({ view: 'main', mode }, '', location.pathname);
    }
}

// ============================================================
// FILE UPLOAD
// ============================================================
function setupUploadZone() {
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('fileInput');

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('dragover');
        if (event.dataTransfer.files.length) {
            analyzeFile(event.dataTransfer.files[0]);
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length) {
            analyzeFile(input.files[0]);
        }
    });
}

async function analyzeFile(file) {
    showProgress();

    const formData = new FormData();
    formData.append('file', file);

    const lowerName = (file.name || '').toLowerCase();
    const endpoint = (lowerName.endsWith('.eml') || lowerName.endsWith('.msg'))
        ? '/api/analyze/eml'
        : '/api/analyze/file';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            body: formData,
            headers: licenseKey ? { 'x-license-key': licenseKey } : {}
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Analysis failed');
        }
        showResults(data);
    } catch (error) {
        hideProgress();
        showToast(humanizeAnalyzeError(error.message), 'error', { title: 'Analiz başarısız' });
    }
}

async function analyzePaste() {
    const source = document.getElementById('sourceInput').value.trim();
    if (!source) return;

    showProgress();

    try {
        const res = await fetch('/api/analyze/eml', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(licenseKey ? { 'x-license-key': licenseKey } : {})
            },
            body: JSON.stringify({ source })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Analysis failed');
        }
        showResults(data);
    } catch (error) {
        hideProgress();
        showToast(humanizeAnalyzeError(error.message), 'error', { title: 'Analiz başarısız' });
    }
}

// ============================================================
// RESULTS DISPLAY
// ============================================================
function showResults(data, options = {}) {
    const { pushHistory = true } = options;

    currentResult = data;
    hideProgress();
    hideSecondaryResultBlocks();

    document.getElementById('panelUpload').classList.add('hidden');
    document.getElementById('panelPaste').classList.add('hidden');
    document.getElementById('panelImap').classList.add('hidden');
    document.getElementById('scanModes').classList.add('hidden');
    document.getElementById('resultsPanel').classList.remove('hidden');

    renderMainRiskBanner(data);
    renderMainMeta(data.emailMeta || {});
    renderMainStats(data);
    renderDeepAiPanel(data);
    renderOpenAIAnalysis(data.openaiAnalysis);
    renderClaudeAnalysis(data.claudeAnalysis);
    _autoSelectAiTab(data);   // hangi AI sekmesi aktif olmalı?
    renderStructuredReport(data);
    renderFindings(data.findings || []);
    renderAttachmentDetails(data);
    renderVirusTotal(data.virusTotal || [], data.vtStatus, data);

    loadHistory();

    if (pushHistory && data?.id) {
        sessionStorage.setItem(`msa_result_${data.id}`, JSON.stringify(data));
        history.pushState(
            { view: 'results', mode: currentMode, resultId: data.id },
            '',
            `${location.pathname}#result-${data.id}`
        );
    }
}

function renderMainRiskBanner(data) {
    const banner = document.getElementById('riskBanner');
    banner.className = `risk-banner ${data.level}`;

    const riskScore = document.getElementById('riskScore');
    riskScore.textContent = data.score;
    riskScore.style.color = data.color;

    const riskLevel = document.getElementById('riskLevel');
    riskLevel.textContent = _tLit(data.labelTR, data.labelEN);
    riskLevel.style.color = data.color;

    document.getElementById('riskDescription').textContent = buildExecutiveSummaryText(data);

    // Skor ↔ Seviye uyumsuzluk açıklaması (data.levelReason analizör tarafından üretilir)
    renderLevelEscalationBanner(data);
}

// Skor düşük ama seviye yüksekse "neden" açıklaması göster.
// Eski kayıtlarda data.levelReason olmayabilir — o zaman client tarafında türet.
function renderLevelEscalationBanner(data) {
    let host = document.getElementById('levelEscalationBanner');
    if (!host) {
        const banner = document.getElementById('riskBanner');
        if (!banner) return;
        host = document.createElement('div');
        host.id = 'levelEscalationBanner';
        host.style.cssText = 'margin:14px 0 0;padding:12px 14px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.45);border-left:4px solid #818cf8;border-radius:10px;color:#c7d2fe;font-size:13px;line-height:1.55;display:none';
        banner.parentNode.insertBefore(host, banner.nextSibling);
    }

    const reason = data.levelReason || _deriveLevelReason(data);
    if (!reason) {
        host.style.display = 'none';
        return;
    }

    const labelTxt = _tLit(data.labelTR, data.labelEN);
    host.innerHTML =
        '<div style="font-weight:700;color:#a5b4fc;font-size:11px;letter-spacing:1px;margin-bottom:4px">⚠️ ' +
        (_tLit('SKOR & SEVİYE FARKLILIĞI', 'SCORE / LEVEL DISCREPANCY')) + '</div>' +
        '<div>' + _tLit(
            `Kural motoru skoru <b>${data.score}/100</b> (düşük) çıktı, ancak risk seviyesi <b>${esc(labelTxt)}</b>'a yükseltildi.`,
            `Rule-engine score is <b>${data.score}/100</b> (low), but the risk level was raised to <b>${esc(labelTxt)}</b>.`) + '</div>' +
        '<div style="margin-top:6px;color:#e0e7ff"><b>' +
        (_tLit('Sebep', 'Reason')) + ':</b> ' + esc(reason.reason || reason) + '</div>';
    host.style.display = '';
}

// Eski kayıtlar için client-side fallback: skor düşük + seviye yüksek mi kontrol et,
// öyleyse sinyal kaynaklarını sayıp basit bir açıklama üret.
function _deriveLevelReason(data) {
    const score = Number(data.score || 0);
    const lvl = data.level;
    const scoreLvl = score <= 25 ? 'safe' : (score <= 50 ? 'low' : (score <= 75 ? 'medium' : 'high'));
    const rank = { safe:0, low:1, medium:2, high:3 };
    if ((rank[lvl] || 0) <= (rank[scoreLvl] || 0)) return null;

    const parts = [];
    const otx = data.otxData?.indicators || [];
    const otxMal = otx.filter(i => i.verdict === 'malicious').length;
    const otxSus = otx.filter(i => i.verdict === 'suspicious').length;
    if (otxMal) parts.push(`OTX'te ${otxMal} zararlı gösterge`);
    else if (otxSus) parts.push(`OTX'te ${otxSus} şüpheli gösterge`);

    const vt = data.virusTotal || [];
    const vtMal = vt.reduce((n,e) => n + (e.stats?.malicious || 0), 0);
    const vtSus = vt.reduce((n,e) => n + (e.stats?.suspicious || 0), 0);
    if (vtMal) parts.push(`AntiVirüs taramada ${vtMal} motor zararlı`);
    else if (vtSus) parts.push(`AntiVirüs taramada ${vtSus} motor şüpheli`);

    const abuseHits = (data.abuseData?.matches || []).length;
    if (abuseHits) parts.push(`Link Tarama Motorunda ${abuseHits} tehditli bağlantı`);

    const ai = data.openaiAnalysis;
    if (ai?.threatLevel) {
        const t = String(ai.threatLevel).toLowerCase();
        const c = Number(ai.confidence || 0);
        if (['high','critical','medium'].includes(t) && c >= 60) {
            parts.push(`AI ${t} tehdit (%${c} güvenle)`);
        }
    }

    const crit = (data.findings || []).filter(f => f.severity === 'critical').length;
    if (crit && !parts.length) parts.push(`${crit} kritik bulgu`);

    if (!parts.length) return null;
    return { reason: parts.join(' · ') };
}

function renderMainMeta(meta) {
    const from   = meta.from?.[0] || {};
    const to     = meta.to?.[0] || {};
    const email  = from.address || '';
    const domain = email.includes('@') ? email.split('@')[1] : '';

    const allowlistBtns = email ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
            ${domain ? `<button class="btn btn-ghost btn-sm" id="allowBtnDomain"
                data-allow="${esc(domain)}"
                style="font-size:11px;padding:3px 10px;color:var(--green);border-color:rgba(0,230,118,0.3)"
                onclick="addSenderToAllowlist(this, this.dataset.allow)">
                🌐 ${esc(domain)} güvenilir ekle
            </button>` : ''}
            <button class="btn btn-ghost btn-sm" id="allowBtnEmail"
                data-allow="${esc(email)}"
                style="font-size:11px;padding:3px 10px;color:var(--green);border-color:rgba(0,230,118,0.3)"
                onclick="addSenderToAllowlist(this, this.dataset.allow)">
                📧 ${esc(email)} güvenilir ekle
            </button>
        </div>` : '';

    document.getElementById('emailMeta').innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;font-size:14px;align-items:start">
            <div>
                <div><span class="text-muted">${t('from')}:</span> <strong>${esc(from.name || '')} &lt;${esc(email || 'N/A')}&gt;</strong></div>
                ${allowlistBtns}
            </div>
            <div><span class="text-muted">${t('subject')}:</span> <strong>${esc(meta.subject || 'N/A')}</strong></div>
            <div><span class="text-muted">${t('to')}:</span> ${esc(to.address || 'N/A')}</div>
            <div><span class="text-muted">${t('date')}:</span> ${formatDate(meta.date, true)}</div>
        </div>
    `;
}

async function addSenderToAllowlist(btn, value) {
    btn.disabled = true;
    btn.textContent = '⏳ Ekleniyor...';
    try {
        const res = await fetch('/api/lists/allowlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: value })
        });
        const data = await res.json();
        if (!res.ok) {
            btn.textContent = '❌ Hata';
            btn.style.color = '#f87171';
            setTimeout(() => { btn.disabled = false; btn.textContent = `✅ ${value} güvenilir ekle`; btn.style.color = ''; }, 2000);
            return;
        }
        btn.textContent = `✅ Eklendi: ${value}`;
        btn.style.color = 'var(--green)';
        btn.style.fontWeight = '600';
    } catch (e) {
        btn.disabled = false;
        btn.textContent = '❌ Bağlantı hatası';
        btn.style.color = '#f87171';
    }
}

function renderMainStats(data) {
    document.getElementById('statGrid').innerHTML = `
        <div class="stat-card">
            <div class="stat-value" style="color:${data.color}">${data.score}</div>
            <div class="stat-label">${t('stat_score')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value text-red">${data.summary?.critical || 0}</div>
            <div class="stat-label">${t('stat_threats')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value text-orange">${data.summary?.warning || 0}</div>
            <div class="stat-label">${t('stat_warnings')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value text-green">${data.summary?.safe || 0}</div>
            <div class="stat-label">${t('stat_safe')}</div>
        </div>
    `;
}

// ============================================================
// DERİN AI İNCELEME PANELİ
// Mevcut bir analiz raporunun üzerine kullanıcı isteğiyle çağrılır.
// 5 tarama hakkı tüketir; sonuç scan history'ye kaydedilir, tekrar
// açıldığında cache'ten gelir.
// ============================================================
const DEEP_AI_COST = 5;

// Hem ana sayfa raporu hem de IMAP rapor pane'i için tek panel render fonksiyonu.
// Çağrı şekilleri:
// ============================================================
// AI GÖRÜŞLERI — 3 AI blok (Deep AI / OpenAI / Claude) tek tabbed kart
// ============================================================
function switchAiTab(tabId) {
    // Tab butonlarını güncelle
    document.querySelectorAll('#aiViewsTabs .tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.aiTab === tabId);
    });
    // Panel gövdelerini göster/gizle
    document.querySelectorAll('.ai-tab-body').forEach(body => {
        body.style.display = body.id === `aiTab-${tabId}` ? '' : 'none';
    });
}

// İlk yükleme sonrası hangi tab aktif olmalı?
function _autoSelectAiTab(data) {
    if (!document.getElementById('aiViewsCard')) return;
    if (data?.deepAiAnalysis) switchAiTab('deep');
    else if (data?.openaiAnalysis) switchAiTab('openai');
    else if (data?.claudeAnalysis) switchAiTab('claude');
    else switchAiTab('deep');   // varsayılan: "Derinlemesine" butonu göster
}

//   renderDeepAiPanel(data)                    → ana sayfa (aiTab-deep)
//   renderDeepAiPanel(data, hostElementOrId)   → belirli bir hedef (örn IMAP slotu)
function renderDeepAiPanel(data, target) {
    let host;
    if (target) {
        host = (typeof target === 'string') ? document.getElementById(target) : target;
        if (!host) return;
    } else {
        // Ana sayfa: aiTab-deep içine render et
        host = document.getElementById('aiTab-deep');
        if (!host) return;
    }

    const scanId = data?.id || data?.scanId || null;
    if (!scanId) {
        host.style.display = 'none';
        return;
    }

    if (data.deepAiAnalysis) {
        host.innerHTML = renderDeepAiResult(data.deepAiAnalysis, true);
        host.style.display = '';
        return;
    }

    // Host'u panel olarak işaretle — requestDeepAiAnalysis butondan kalkıp bunu bulacak
    host.setAttribute('data-deep-ai-slot', '1');

    // Buton görünümü — henüz yapılmadı
    host.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(139,92,246,0.10),rgba(99,102,241,0.10));border:1px solid rgba(139,92,246,0.35);border-left:4px solid #a78bfa;border-radius:12px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:14px 0">
            <div style="flex:1;min-width:240px">
                <div style="font-size:14px;font-weight:700;color:#c4b5fd;margin-bottom:3px">🔬 Yapay Zekâ ile Derinlemesine İncele</div>
                <div style="font-size:12px;color:#a5b4fc;line-height:1.55">
                    Saldırı zinciri, sosyal mühendislik kalıpları, marka taklidi, kullanıcı/IT/kurum tavsiyeleri ve IoC listesi içeren detaylı forensic rapor üretir.
                    <br><b style="color:#fbbf24">⚠️ Bu işlem aylık tarama hakkından <span style="color:#fcd34d">${DEEP_AI_COST}</span> düşer.</b>
                </div>
            </div>
            <button class="deep-ai-trigger-btn" onclick="requestDeepAiAnalysis(this)" style="background:linear-gradient(135deg,#7c3aed,#6366f1);color:#fff;border:none;border-radius:10px;padding:11px 18px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(124,58,237,0.35);white-space:nowrap">
                🚀 Derinlemesine Analiz Et
            </button>
        </div>
        <div class="deep-ai-status" style="margin-top:6px;font-size:12px;color:var(--text-secondary);text-align:center"></div>
    `;
    host.style.display = '';
}

async function requestDeepAiAnalysis(buttonEl) {
    const data = currentResult;
    const scanId = data?.id || data?.scanId;
    if (!scanId) {
        await showAlert({
            title: 'Rapor henüz kaydedilmemiş',
            message: 'Önce sayfayı yenileyip tekrar deneyin.',
            type: 'warning'
        });
        return;
    }

    const confirmed = await showConfirm({
        title: '🔬 Yapay Zekâ Derinlemesine İncele',
        message: `Bu işlem yapay zekâdan kapsamlı bir forensic rapor (saldırı zinciri, IoC listesi, kullanıcı/IT/kurum tavsiyeleri) ister.\n\nAylık tarama hakkından ${DEEP_AI_COST} düşer.\n\nDevam edilsin mi?`,
        confirmText: '🚀 Evet, derinlemesine analiz et',
        cancelText: 'İptal',
        icon: '🤖'
    });
    if (!confirmed) return;

    // Hangi panel slotundan çağrıldığımızı bul (ana sayfa veya IMAP raporu)
    const host = buttonEl?.closest('[data-deep-ai-slot]')
              || document.querySelector('[data-deep-ai-slot]');
    const btn    = buttonEl || host?.querySelector('.deep-ai-trigger-btn');
    const status = host?.querySelector('.deep-ai-status');

    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ AI analiz yapıyor (~10-20 sn)...'; btn.style.opacity = '0.7'; btn.style.cursor = 'wait'; }
    if (status) status.textContent = 'Yapay zekâya delil paketi gönderildi, derinlemesine analiz hazırlanıyor...';

    try {
        const res = await fetch('/api/analyze/deep-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scanId })
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
            const msg = json.error || `Hata: HTTP ${res.status}`;
            if (status) status.innerHTML = `<span class="u-err">❌ ${esc(msg)}</span>`;
            if (btn) { btn.disabled = false; btn.innerHTML = '🚀 Derinlemesine Analiz Et'; btn.style.opacity = ''; btn.style.cursor = ''; }
            return;
        }

        // Sonucu currentResult'a yaz; varsa imapReportCache'i de güncelle
        currentResult.deepAiAnalysis = json.analysis;
        try {
            const cacheKey = currentResult.imapUid ? `${currentResult.imapEmail || currentImapEmail}:${currentResult.imapUid}` : null;
            if (cacheKey && imapReportCache.has(cacheKey)) {
                imapReportCache.set(cacheKey, currentResult);
            }
        } catch {}

        // Aktif panel'i güncelle
        if (host) host.innerHTML = renderDeepAiResult(json.analysis, json.cached);

        // Üst kısımdaki "Tarama hakkı 22/250" tipi göstergeyi güncelle
        try { if (typeof refreshLicenseUsageBadge === 'function') refreshLicenseUsageBadge(); } catch {}

        const remaining = (json.monthlyLimit === Infinity ? '∞' : (json.monthlyLimit - json.monthlyUsed));
        // Status host yenilenince DOM'dan silinir; yine de varsa güncelle
        const newStatus = host?.querySelector('.deep-ai-status');
        if (newStatus) newStatus.textContent = `✅ Tamamlandı. Aylık limit: ${json.monthlyUsed}/${json.monthlyLimit === Infinity ? '∞' : json.monthlyLimit} (kalan: ${remaining}).`;
    } catch (e) {
        if (status) status.innerHTML = `<span class="u-err">❌ Bağlantı hatası: ${esc(e.message)}</span>`;
        if (btn) { btn.disabled = false; btn.innerHTML = '🚀 Derinlemesine Analiz Et'; btn.style.opacity = ''; btn.style.cursor = ''; }
    }
}

function renderDeepAiResult(a, cached) {
    if (!a) return '';
    const verdictColors = { safe: '#10b981', low: '#facc15', medium: '#fb923c', high: '#ef4444' };
    const verdictLabels = { safe: 'GÜVENLİ', low: 'DÜŞÜK', medium: 'ORTA', high: 'KRİTİK' };
    const vc = verdictColors[a.verdict] || '#94a3b8';
    const vl = verdictLabels[a.verdict] || a.verdict?.toUpperCase() || '—';

    const tactics = (a.social_engineering_tactics || []).map(t =>
        `<span style="display:inline-block;background:rgba(139,92,246,0.18);border:1px solid rgba(139,92,246,0.4);color:#ddd6fe;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;margin:2px 4px 2px 0">${esc(t)}</span>`
    ).join('');

    const killChain = (a.kill_chain_steps_tr || []).map(s =>
        `<li style="margin-bottom:6px;color:#e5e7eb;font-size:13px;line-height:1.55">${esc(s)}</li>`
    ).join('');

    const iocSection = (() => {
        const groups = [
            ['Domains', a.iocs?.domains || []],
            ['IPs',     a.iocs?.ips     || []],
            ['URLs',    a.iocs?.urls    || []],
            ['Emails',  a.iocs?.emails  || []],
            ['Hashes',  a.iocs?.hashes  || []]
        ].filter(([_, list]) => list.length > 0);
        if (!groups.length) return '<div style="color:var(--text-secondary);font-size:13px;padding:6px 0">İndikatör bulunamadı</div>';
        return groups.map(([label, list]) => `
            <div class="u-mb8">
                <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:4px">${esc(label)} (${list.length})</div>
                <div style="background:#0b1220;border:1px solid var(--border);border-radius:6px;padding:8px;font-family:monospace;font-size:12px;color:#e5e7eb;word-break:break-all">${list.map(esc).join('<br>')}</div>
            </div>
        `).join('');
    })();

    const actionList = (items, color) => (items || []).length
        ? `<ol style="margin:0;padding-left:18px;color:#e5e7eb;font-size:13px;line-height:1.7">${items.map(i => `<li style="margin-bottom:3px">${esc(i)}</li>`).join('')}</ol>`
        : `<div style="color:var(--text-secondary);font-size:13px">Önerilen ek işlem yok</div>`;

    const brand = a.brand_impersonation || {};
    const brandHtml = brand.is_impersonating
        ? `<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px 12px;margin-bottom:14px">
                <div style="font-size:11px;color:#fca5a5;font-weight:700;letter-spacing:1px;margin-bottom:4px">🎭 MARKA TAKLİDİ TESPİT EDİLDİ</div>
                <div style="font-size:14px;color:#fecaca;font-weight:700">${esc(brand.impersonated_brand || 'Bilinmeyen marka')}</div>
                <div style="font-size:12px;color:#fee2e2;margin-top:4px">${esc(brand.evidence_tr || '')}</div>
           </div>`
        : '';

    return `
    <div style="background:linear-gradient(135deg,#1e1b4b,#1e293b);border:1px solid #6366f1;border-left:4px solid #a78bfa;border-radius:12px;padding:18px 20px;color:#e5e7eb">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
            <div style="font-size:15px;font-weight:800;color:#c4b5fd;letter-spacing:0.3px">🔬 Yapay Zekâ Derinlemesine İncelemesi ${cached ? '<span style="font-size:10px;background:rgba(99,102,241,0.3);color:#c7d2fe;padding:2px 8px;border-radius:999px;margin-left:8px;font-weight:700">CACHED</span>' : ''}</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="background:${vc}22;border:1px solid ${vc};color:${vc};padding:4px 12px;border-radius:8px;font-size:12px;font-weight:800">${esc(vl)} · ${a.score}/100</span>
                <span style="background:#0b1220;border:1px solid var(--border);color:var(--text-secondary);padding:4px 12px;border-radius:8px;font-size:11px">Güven: %${a.confidence}</span>
                <span style="background:#0b1220;border:1px solid var(--border);color:var(--text-secondary);padding:4px 12px;border-radius:8px;font-size:11px;font-family:monospace">${esc(a.modelUsed || '')}</span>
            </div>
        </div>

        <!-- Yönetici Özeti -->
        <div style="background:#0b1220;border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
            <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:6px">📋 YÖNETİCİ ÖZETİ</div>
            <div style="font-size:14px;color:#f1f5f9;line-height:1.65;font-weight:500">${esc(a.executive_summary_tr || '—')}</div>
        </div>

        ${brandHtml}

        <!-- Threat narrative -->
        <div class="u-mb14">
            <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:6px">🎯 SALDIRI/AMAÇ ANLATIMI</div>
            <div style="font-size:13px;color:#e5e7eb;line-height:1.65">${esc(a.threat_narrative_tr || '—')}</div>
        </div>

        <!-- Sosyal mühendislik kalıpları -->
        ${tactics ? `
        <div class="u-mb14">
            <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:6px">🧠 SOSYAL MÜHENDİSLİK KALIPLARI</div>
            <div>${tactics}</div>
        </div>` : ''}

        <!-- Kill chain -->
        ${killChain ? `
        <div class="u-mb14">
            <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:6px">⛓️ SALDIRI ZİNCİRİ (KILL CHAIN)</div>
            <ol style="margin:0;padding-left:20px">${killChain}</ol>
        </div>` : ''}

        <!-- Aksiyonlar 3 kolon -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:14px">
            <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:12px">
                <div style="font-size:11px;color:#86efac;font-weight:700;letter-spacing:1px;margin-bottom:8px">👤 KULLANICI YAPMALI</div>
                ${actionList(a.user_actions_tr, '#86efac')}
            </div>
            <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.3);border-radius:8px;padding:12px">
                <div style="font-size:11px;color:#93c5fd;font-weight:700;letter-spacing:1px;margin-bottom:8px">🛠️ IT EKİBİ YAPMALI</div>
                ${actionList(a.it_actions_tr, '#93c5fd')}
            </div>
            <div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.3);border-radius:8px;padding:12px">
                <div style="font-size:11px;color:#d8b4fe;font-weight:700;letter-spacing:1px;margin-bottom:8px">🏢 KURUM ÇAPINDA</div>
                ${actionList(a.organization_actions_tr, '#d8b4fe')}
            </div>
        </div>

        <!-- IoCs -->
        <div class="u-mb14">
            <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:6px">🔍 GÖSTERGELER (IoCs)</div>
            ${iocSection}
        </div>

        <!-- Benzer kampanyalar + FP riski -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:10px">
            <div style="background:#0b1220;border:1px solid var(--border);border-radius:8px;padding:12px">
                <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:6px">📊 BENZER KAMPANYALAR</div>
                <div style="font-size:13px;color:#e5e7eb;line-height:1.55">${esc(a.similar_campaigns_tr || '-')}</div>
            </div>
            <div style="background:#0b1220;border:1px solid var(--border);border-radius:8px;padding:12px">
                <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px;margin-bottom:6px">⚠️ YANLIŞ POZİTİF RİSKİ</div>
                <div style="font-size:13px;color:#e5e7eb;line-height:1.55">${esc(a.false_positive_risk_tr || '-')}</div>
            </div>
        </div>

        <!-- Güven gerekçesi -->
        <div style="background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.25);border-radius:8px;padding:10px 12px;font-size:12px;color:#c7d2fe">
            <b>Güven seviyesi gerekçesi:</b> ${esc(a.confidence_reasoning_tr || '-')}
        </div>

        <div style="margin-top:10px;font-size:10px;color:var(--text-secondary);text-align:right">
            ${cached ? 'Önbellekten yüklendi' : `Oluşturuldu: ${a.requestedAt ? new Date(a.requestedAt).toLocaleString('tr-TR') : '-'}`}
        </div>
    </div>
    `;
}

function renderStructuredReport(data) {
    const container = document.getElementById('structuredReportContent');
    if (!container) return;

    const meta = data.emailMeta || {};
    const from = meta.from?.[0] || {};
    const attachmentRows = mergeAttachmentScanData(data);
    const authRows = buildAuthRows(data);
    const threatTags = buildThreatTags(data);
    const linkSummary = buildLinkSummary(data);
    const recommendations = buildRecommendations(data);

    // ─── E-POSTA ÜSTÜ VERDICT BANDI ─────────────────────────────
    const levelIcon = { high: '🔴', medium: '🟠', low: '🟡', safe: '🟢' }[data.level] || '⚠️';
    const levelText = (_tLit(data.labelTR, data.labelEN)) || data.level || '';
    const verdictColor = data.color || '#94a3b8';
    const isRisky = data.level === 'high' || data.level === 'medium';
    const topTagsHtml = threatTags.slice(0, 4).map(tag =>
        `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,0.12);color:#fff;font-size:11px;font-weight:700;margin:0 4px 4px 0">${esc(tag.label)}</span>`
    ).join('');
    const verdictBanner = `
        <div style="position:relative;margin-bottom:14px;border-radius:10px;overflow:hidden;border:2px solid ${verdictColor};background:linear-gradient(90deg,${verdictColor}28,${verdictColor}10)">
            <div style="display:flex;align-items:center;gap:12px;padding:12px 16px">
                <div style="font-size:28px;line-height:1">${levelIcon}</div>
                <div class="u-flex1-0">
                    <div style="font-size:11px;color:var(--text-secondary);font-weight:700;letter-spacing:1px">📩 BU E-POSTA İÇİN TARAMA SONUCU</div>
                    <div style="font-size:18px;font-weight:800;color:${verdictColor};margin-top:2px">${esc(levelText)} <span style="font-size:13px;color:var(--text-secondary);font-weight:600;margin-left:6px">· Skor ${data.score ?? '-'}/100</span></div>
                </div>
                <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;padding:6px 14px;border-radius:8px;background:${verdictColor};color:#0f172a">${isRisky ? '⚠ RİSKLİ' : '✓ GÜVENLİ'}</div>
            </div>
            ${topTagsHtml ? `<div style="padding:0 16px 12px;border-top:1px dashed ${verdictColor}55;padding-top:10px">${topTagsHtml}</div>` : ''}
        </div>
    `;

    container.innerHTML = `
        ${verdictBanner}
        <div class="report-section">
            <div class="report-section-title">Incelenen E-posta</div>
            <div class="report-kv-grid">
                <div><span class="text-muted">${t('from')}:</span> <strong>${esc(from.name || from.address || 'N/A')}</strong></div>
                <div><span class="text-muted">${t('subject')}:</span> <strong>${esc(meta.subject || 'N/A')}</strong></div>
                <div><span class="text-muted">${t('date')}:</span> ${formatDate(meta.date, true)}</div>
                <div><span class="text-muted">Baglanti:</span> ${esc(String(linkSummary.total))} adet</div>
                <div class="report-span-2"><span class="text-muted">Ekler:</span> ${attachmentRows.length ? attachmentRows.map((row) => `<span class="report-chip">${esc(row.filename)}</span>`).join(' ') : '<span class="text-muted">Ek yok</span>'}</div>
            </div>
        </div>

        <div class="report-section">
            <div class="report-section-title">Kimlik Dogrulama ve Gonderen Itibari</div>
            <div class="report-auth-grid">
                ${authRows.map((row) => `
                    <div class="report-auth-card">
                        <div class="report-auth-label">${esc(row.label)}</div>
                        <div class="report-auth-value severity-${row.severity}">${esc(row.value)}</div>
                        ${row.note ? `<div class="report-auth-note">${esc(row.note)}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="report-section">
            <div class="report-section-title">Antivirus ve Ek Tarama Sonuclari</div>
            <div class="report-table-wrap">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Dosya</th>
                            <th>SHA-256</th>
                            <th>Sonuc</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${attachmentRows.length ? attachmentRows.map((row) => `
                            <tr>
                                <td>${esc(row.filename)}</td>
                                <td><code>${esc(shortHash(row.hash))}</code></td>
                                <td>${renderAttachmentVerdict(row, data.vtStatus)}</td>
                            </tr>
                        `).join('') : `
                            <tr>
                                <td colspan="3" class="text-muted">Ek bulunamadi.</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="report-section">
            <div class="report-section-title">Tespit Edilen Tehdit Tipleri</div>
            <div class="report-chip-row">
                ${threatTags.length ? threatTags.map((tag) => `<span class="report-chip severity-${tag.severity}">${esc(tag.label)}</span>`).join('') : '<span class="text-muted">Belirgin tehdit tipi tespit edilmedi.</span>'}
            </div>
        </div>

        <div class="report-section">
            <div class="report-section-title">Detayli Bulgular</div>
            <div class="report-table-wrap">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Kategori</th>
                            <th>Detay</th>
                            <th>Ciddiyet</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(data.findings || []).map((finding) => `
                            <tr>
                                <td>${esc(localizeCategory(finding.category))}</td>
                                <td>${esc(finding.message)}</td>
                                <td><span class="report-pill severity-${finding.severity}">${esc(localizeSeverity(finding.severity))}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="report-section">
            <div class="report-section-title">Supheli Baglantilar</div>
            ${linkSummary.items.length ? `
                <div class="report-link-list">
                    ${linkSummary.items.map((item) => `<div class="finding-item compact"><div class="finding-icon warning">!</div><div>${esc(item)}</div></div>`).join('')}
                </div>
            ` : '<div class="text-muted">Supheli baglanti tespit edilmedi.</div>'}
        </div>

        <div class="report-section">
            <div class="report-section-title">Guvenlik Onerileri</div>
            <ul class="report-list">
                ${recommendations.map((item) => `<li>${esc(item)}</li>`).join('')}
            </ul>
        </div>
    `;
}

function jsString(value) {
    return JSON.stringify(String(value || ''));
}

function canReportOtxFalsePositive(finding) {
    return finding?.category === 'otx'
        && finding.indicatorValue
        && finding.indicatorType !== 'IPv4'
        && (finding.severity === 'critical' || finding.severity === 'warning');
}

function renderFindingFpButton(finding, idx, buttonId = '') {
    if (!canReportOtxFalsePositive(finding)) return '';
    const idAttr = buttonId ? ` id="${esc(buttonId)}"` : '';
    const argButtonId = buttonId ? jsString(buttonId) : 'null';
    return `<button${idAttr} class="finding-fp-btn" onclick='reportFalsePositive(${jsString(finding.indicatorValue)},${jsString(finding.category)},${jsString(finding.severity)},${jsString(idx)},${argButtonId})' title="Bu domain yanlış pozitif — onay kuyruğuna gönder" style="margin-left:auto;background:transparent;border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#94a3b8;font-size:11px;padding:3px 8px;cursor:pointer;white-space:nowrap">⚠️ Yanlış pozitif</button>`;
}

function renderFindings(findings, filter = 'all') {
    const list = document.getElementById('findingsList');
    // 'ai' kategorisi ayrı ChatGPT kartında gösterildiği için burada tekrarlanmaz
    const filtered = filter === 'all'
        ? findings.filter(f => f.category !== 'ai')
        : findings.filter((finding) => finding.category === filter);

    list.innerHTML = filtered.map((finding, idx) => {
        const fpBtn = renderFindingFpButton(finding, idx);
        return `
        <div class="finding-item" data-finding-idx="${idx}" class="u-row-10">
            <div class="finding-icon ${finding.severity}">${findingIcon(finding.severity)}</div>
            <div class="u-flex1">
                <div class="finding-text">${esc(finding.message)}</div>
                <div class="finding-category">${esc(formatCategory(finding.category))}</div>
            </div>
            ${fpBtn}
        </div>`;
    }).join('');
}

async function reportFalsePositive(domain, category, severity, idx, buttonId = null) {
    if (!domain) return;
    const ok = await showConfirm({
        title: 'Yanlış Pozitif Bildir',
        message: `"${domain}" için yanlış pozitif raporu gönderilsin mi?\n\nAdmin onayından sonra bu domain güvenilir listeye eklenir ve bir daha tehdit olarak işaretlenmez.`,
        confirmText: '✅ Evet, raporla',
        cancelText: 'İptal',
        icon: '⚠️'
    });
    if (!ok) return;

    const item = buttonId ? null : document.querySelector(`.finding-item[data-finding-idx="${idx}"]`);
    const btn = buttonId ? document.getElementById(buttonId) : (item ? item.querySelector('.finding-fp-btn') : null);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Gönderiliyor…'; }

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (typeof licenseKey !== 'undefined' && licenseKey) headers['x-license-key'] = licenseKey;
        const res = await fetch('/api/fp-suggestions', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                domain,
                category,
                severity,
                scanId:  currentResult?.id || currentResult?.scanId || null,
                message: (currentResult?.findings || []).find(f => f.indicatorValue === domain)?.message || ''
            })
        });
        const data = await res.json();
        if (!res.ok) {
            if (btn) { btn.disabled = false; btn.textContent = '⚠️ Yanlış pozitif'; }
            showToast(data.error || `Hata: HTTP ${res.status}`, 'error', { title: 'FP raporu gönderilemedi' });
            return;
        }
        if (btn) {
            btn.disabled = true;
            if (data.alreadyDecided && data.status === 'approved') {
                btn.textContent = '✅ Onaylanmış';
                btn.style.color = '#4ade80';
                showToast(`"${domain}" zaten onaylanmış güvenilir listede.`, 'info');
            } else if (data.alreadyDecided && data.status === 'rejected') {
                btn.textContent = '🚫 Reddedilmiş';
                btn.style.color = '#94a3b8';
                showToast(`"${domain}" daha önce admin tarafından reddedilmiş.`, 'warning');
            } else {
                btn.textContent = data.incremented ? '✓ Sayaç +1' : '✓ Gönderildi';
                btn.style.color = '#4ade80';
                showToast(`"${domain}" yanlış pozitif olarak raporlandı. Admin onayı bekleniyor.`, 'success', {
                    title: '✅ Rapor gönderildi'
                });
            }
        }
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = '⚠️ Yanlış pozitif'; }
        showToast(e.message, 'error', { title: 'Bağlantı hatası' });
    }
}

function filterFindings(tab) {
    document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
    if (currentResult) {
        renderFindings(currentResult.findings || [], tab);
    }
}

function renderVirusTotal(entries, vtStatus, data) {
    const vtResults = document.getElementById('vtResults');
    const vtContent = document.getElementById('vtContent');
    const archiveWarnings = collectArchiveWarnings(data);
    const quarantinedRows = mergeAttachmentScanData(data).filter((row) => row.quarantined);

    if (!entries.length && !(vtStatus?.available && !vtStatus?.configured) && !archiveWarnings.length && !quarantinedRows.length) {
        vtResults.classList.add('hidden');
        vtContent.innerHTML = '';
        return;
    }

    vtResults.classList.remove('hidden');
    const statusNotice = vtStatus?.available && !vtStatus?.configured
        ? `
            <div class="finding-item">
                <div class="finding-icon warning">!</div>
                <div>
                    <div class="finding-text"><strong>AntiVirüs Tarama API anahtarı tanımlı değil</strong></div>
                    <div class="finding-category">Ek dosyalar AntiVirüs taramasına gönderilmedi. Yalnızca yerel ek kontrolleri çalıştırıldı.</div>
                </div>
            </div>
        `
        : '';

    const archiveNotice = archiveWarnings.length
        ? `
            <div class="finding-item">
                <div class="finding-icon critical">!!</div>
                <div>
                    <div class="finding-text"><strong>Arşiv içeriğinde tehlikeli dosyalar tespit edildi</strong></div>
                    <div class="finding-category">${archiveWarnings.map((item) => esc(item)).join(' | ')}</div>
                </div>
            </div>
        `
        : '';

    const quarantineNotice = quarantinedRows.length
        ? quarantinedRows.map((row) => `
            <div class="finding-item">
                <div class="finding-icon critical">!!</div>
                <div>
                    <div class="finding-text"><strong>${esc(row.filename)}</strong> mail guvenlik gecidi tarafindan karantinaya alindi</div>
                    <div class="finding-category">${esc(row.quarantineDetection || 'Malware tespiti')} ${row.quarantineAction ? `| ${esc(row.quarantineAction)}` : ''}</div>
                    <div class="text-red" class="u-mt8">Bu nedenle ek, posta kutusuna orijinal hâliyle ulaşmadı ve virüs taramasına gönderilemedi.</div>
                </div>
            </div>
        `).join('')
        : '';

    vtContent.innerHTML = statusNotice + archiveNotice + quarantineNotice + entries.map((entry) => `
        <div class="finding-item">
            <div class="finding-icon ${virusTotalDisplaySeverity(entry, data)}">
                ${virusTotalDisplaySeverity(entry, data) === 'critical' ? '!!' : ((entry.stats?.malicious > 0 || entry.stats?.suspicious > 0) ? 'VT' : 'OK')}
            </div>
            <div>
                <div class="finding-text"><strong>${esc(entry.filename)}</strong></div>
                <div class="finding-category">SHA256: <code>${esc((entry.hash || '').substring(0, 16))}...</code></div>
                ${renderVirusTotalDetails(entry)}
                ${renderArchiveWarningForEntry(entry, data)}
                ${entry.link
                    ? `<a href="${entry.link}" target="_blank" class="text-accent" class="u-sm">AntiVirüs Tarama Raporunu Görüntüle →</a>`
                    : ''}
            </div>
        </div>
    `).join('');
}

function renderVirusTotalDetails(entry) {
    if (entry.error) {
        return `<div class="text-orange">AntiVirüs Tarama hatası: ${esc(entry.error)}</div>`;
    }

    if (!entry.checked) {
        return '<div class="text-orange">AntiVirüs Tarama sorgusu tamamlanamadı.</div>';
    }

    if (!entry.found) {
        return '<div class="text-muted">AntiVirüs Tarama veritabanında kayıt bulunamadı.</div>';
    }

    const stats = entry.stats || {};
    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const harmless = stats.harmless || 0;
    const undetected = stats.undetected || 0;
    const total = stats.total || (malicious + suspicious + harmless + undetected);
    const isClean = malicious === 0 && suspicious === 0;

    const summaryLine = isClean
        ? `<span style="color:#4ade80">✅ Temiz</span> — <strong>${total}</strong> motor taradı, tehdit tespit edilmedi`
        : `<span class="u-err">⚠️ Zararlı: <strong>${malicious}</strong></span> / Şüpheli: <strong>${suspicious}</strong> / Toplam: <strong>${total}</strong> motor`;

    return `
        <div class="finding-text">${summaryLine}</div>
        ${!isClean ? `<div class="finding-text" style="margin-top:4px;font-size:12px;color:#94a3b8;">
            Temiz: ${harmless + undetected} &nbsp;|&nbsp; Zararsız: ${harmless} &nbsp;|&nbsp; Tespit edilmedi: ${undetected}
        </div>` : ''}
        ${entry.typeDescription ? `<div class="finding-text">Tür: ${esc(entry.typeDescription)}</div>` : ''}
        ${typeof entry.reputation === 'number' ? `<div class="finding-text">İtibar skoru: ${esc(String(entry.reputation))}</div>` : ''}
        ${entry.maliciousEngines?.length ? `
            <div class="finding-category" class="u-mt8">Zararlı bulan motorlar</div>
            <div class="finding-text">${entry.maliciousEngines.map((engine) => `${esc(engine.engine)} (${esc(engine.result)})`).join(', ')}</div>
        ` : ''}
        ${entry.suspiciousEngines?.length ? `
            <div class="finding-category" class="u-mt8">Şüpheli bulan motorlar</div>
            <div class="finding-text">${entry.suspiciousEngines.map((engine) => `${esc(engine.engine)} (${esc(engine.result)})`).join(', ')}</div>
        ` : ''}
    `;
}

function renderAttachmentDetails(data) {
    const attachmentResults = document.getElementById('attachmentResults');
    const attachmentContent = document.getElementById('attachmentContent');
    const rows = mergeAttachmentScanData(data);

    if (!rows.length) {
        attachmentResults.classList.add('hidden');
        attachmentContent.innerHTML = '';
        return;
    }

    attachmentResults.classList.remove('hidden');
    attachmentContent.innerHTML = rows.map((row) => `
        <div class="finding-item" style="align-items:flex-start;">
            <div class="finding-icon ${row.severity}">${row.severity === 'critical' ? '!!' : row.severity === 'warning' ? '!' : 'OK'}</div>
            <div style="width:100%;">
                <div class="finding-text"><strong>${esc(row.filename)}</strong></div>
                <div class="finding-category">
                    ${esc(row.contentType || 'bilinmeyen tür')} - ${esc(formatBytes(row.size || 0))}
                </div>
                ${row.hash ? `<div class="finding-category">SHA256: <code>${esc(row.hash)}</code></div>` : ''}
                ${row.issues?.length ? `<div class="finding-text">Yerel kontroller: ${row.issues.map((issue) => esc(issue)).join(', ')}</div>` : ''}
                ${renderLocalScannerSummary(row)}
                ${renderArchiveEntries(row)}
                ${renderAttachmentVirusTotal(row.vt, resolveAttachmentVtStatus(row, data.vtStatus))}
            </div>
        </div>
    `).join('');
}

function renderAttachmentVirusTotal(vt, vtStatus) {
    if (!vt) {
        if (vtStatus?.reason === 'quarantined-upstream') {
            return '<div class="text-red" class="u-mt8">Bu ek, kurum mail güvenlik geçidi tarafından karantinaya alındığı için virüs taramasına gönderilemedi.</div>';
        }

        if (vtStatus?.reason === 'image-local-scan') {
            return '<div class="text-muted" class="u-mt8">Virüs taraması yerine yerel görüntü bütünlüğü kontrolü kullanıldı.</div>';
        }

        if (vtStatus?.reason === 'imap-part-unavailable') {
            return '<div class="text-orange" class="u-mt8">IMAP sunucusu bu ekin dosya içeriğini indirmeye izin vermedi veya boş döndürdü. Dosya adı görünüyor, ancak içerik alınamadığı için virüs taramasına yüklenemedi.</div>';
        }

        if (vtStatus?.available && !vtStatus?.configured) {
            return '<div class="text-orange" class="u-mt8">Virüs tarama API anahtarı tanımlı değil. Bu dosya için yalnızca yerel ek kontrolleri çalıştırıldı.</div>';
        }

        return '<div class="text-muted" class="u-mt8">Virüs tarama sonucu yok.</div>';
    }

    if (vt.error) {
        return `<div class="text-orange" class="u-mt8">Virüs tarama hatası: ${esc(vt.error)}</div>`;
    }

    if (!vt.checked) {
        return '<div class="text-orange" class="u-mt8">Virüs tarama sorgusu tamamlanamadı.</div>';
    }

    if (!vt.found) {
        return '<div class="text-muted" class="u-mt8">Virüs tarama veritabanında kayıt bulunamadı.</div>';
    }

    const malicious = vt.stats?.malicious || 0;
    const suspicious = vt.stats?.suspicious || 0;
    const harmless = vt.stats?.harmless || 0;
    const undetected = vt.stats?.undetected || 0;
    const total = vt.stats?.total || (malicious + suspicious + harmless + undetected);
    const isClean = malicious === 0 && suspicious === 0;

    const engines = [
        ...(vt.maliciousEngines || []).map((engine) => `${engine.engine} (${engine.result})`),
        ...(vt.suspiciousEngines || []).map((engine) => `${engine.engine} (${engine.result})`)
    ];

    const summaryLine = isClean
        ? `<span style="color:#4ade80">✅ Temiz</span> — <strong>${total}</strong> motor taradı, tehdit tespit edilmedi`
        : `<span class="u-err">⚠️ Zararlı: <strong>${malicious}</strong></span> / Şüpheli: <strong>${suspicious}</strong> / Toplam: <strong>${total}</strong> motor`;

    return `
        <div class="finding-text" class="u-mt8">${summaryLine}</div>
        ${vt.typeDescription ? `<div class="finding-category">Tür: ${esc(vt.typeDescription)}</div>` : ''}
        ${typeof vt.reputation === 'number' ? `<div class="finding-category">İtibar skoru: ${esc(String(vt.reputation))}</div>` : ''}
        ${engines.length ? `<div class="finding-text">Tetikleyen motorlar: ${engines.map((item) => esc(item)).join(', ')}</div>` : ''}
    `;
}

function resolveAttachmentVtStatus(row, vtStatus) {
    if (row?.quarantined) {
        return { ...(vtStatus || {}), reason: 'quarantined-upstream' };
    }

    if (row?.vtSkipReason) {
        return { ...(vtStatus || {}), reason: row.vtSkipReason };
    }

    return vtStatus || {};
}

function renderArchiveEntries(row) {
    if (!row.archiveEntries?.length) return '';

    const items = row.archiveEntries.map((entry) => {
        const severity = entry.severity === 'critical'
            ? 'dangerous'
            : (entry.severity === 'warning' ? 'suspicious' : 'normal');
        return `${esc(entry.name)} (${severity})`;
    });

    return `<div class="finding-text" class="u-mt8">Archive contents: ${items.join(', ')}</div>`;
}

function renderLocalScannerSummary(row) {
    if (!row?.localScanner) return '';

    if (row.localScanner === 'mail-gateway') {
        const notes = [];
        if (row.quarantineDetection) notes.push(`tespit=${row.quarantineDetection}`);
        if (row.quarantineAction) notes.push(`aksiyon=${row.quarantineAction}`);
        return `<div class="finding-category">Upstream scanner: mail-gateway${notes.length ? ` (${esc(notes.join(', '))})` : ''}</div>`;
    }

    if (row.localScanner === 'image-integrity') {
        const notes = [];
        if (row.imageAnalysis?.type) notes.push(`type=${row.imageAnalysis.type}`);
        if (row.imageAnalysis?.validSignature === false) notes.push('signature-mismatch');
        if (row.imageAnalysis?.trailingPayload) notes.push('trailing-payload');
        if (row.imageAnalysis?.suspiciousMarkers?.length) notes.push(`markers=${row.imageAnalysis.suspiciousMarkers.join('|')}`);

        return `<div class="finding-category">Local scanner: image-integrity${notes.length ? ` (${esc(notes.join(', '))})` : ''}</div>`;
    }

    return `<div class="finding-category">Local scanner: ${esc(row.localScanner)}</div>`;
}

function renderClaudeAnalysis(analysis) {
    const claudeContent = document.getElementById('aiTab-claude');
    if (!claudeContent) return;

    if (!analysis) {
        claudeContent.innerHTML = `
            <div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:14px;">
                🧠 Claude API anahtarı yapılandırılmamış veya bu analiz için çalıştırılmadı.
            </div>`;
        return;
    }

    const threatLevel = (analysis.threatLevel || '').toLowerCase();
    const levelIcon = {
        critical: '!!',
        high: '!!',
        medium: '!',
        low: '~',
        safe: 'OK'
    };

    let html = `
        <div style="font-size:15px;line-height:1.6;margin-bottom:16px;">
            <strong>Ozet:</strong> ${esc(_tLit(analysis.summaryTR, analysis.summaryEN))}
        </div>
        <div class="grid-2" class="u-mb16">
            <div class="finding-item">
                <div class="finding-icon">${levelIcon[threatLevel] || 'i'}</div>
                <div>
                    <div class="finding-category">THREAT LEVEL</div>
                    <div class="finding-text" style="text-transform:uppercase;font-weight:bold;">${esc(analysis.threatLevel || 'N/A')}</div>
                </div>
            </div>
            <div class="finding-item">
                <div class="finding-icon">AI</div>
                <div>
                    <div class="finding-category">CATEGORY</div>
                    <div class="finding-text" style="text-transform:capitalize;">${esc(analysis.category || 'N/A')}</div>
                </div>
            </div>
        </div>
    `;

    if (analysis.suspiciousElements?.length) {
        html += `
            <div class="finding-category" class="u-mb8">SUSPICIOUS ELEMENTS IDENTIFIED:</div>
            <ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:8px;">
                ${analysis.suspiciousElements.map((item) => `
                    <li style="background:var(--bg-glass);padding:8px 12px;border-radius:6px;border-left:3px solid var(--orange);font-size:14px;">
                        ${esc(item)}
                    </li>
                `).join('')}
            </ul>
        `;
    }

    claudeContent.innerHTML = html;
}

function buildAuthRows(data) {
    const findings = data.findings || [];
    const hasSpfIssue = findings.some((finding) => finding.category === 'header' && /spf/i.test(finding.message));
    const hasDkimIssue = findings.some((finding) => finding.category === 'header' && /dkim/i.test(finding.message));
    const hasDmarcIssue = findings.some((finding) => finding.category === 'header' && /dmarc/i.test(finding.message));
    const suspiciousSender = findings.some((finding) => /sender|gonderen|reputation|itibar/i.test(finding.message));
    const authIssues = [hasSpfIssue, hasDkimIssue, hasDmarcIssue].filter(Boolean).length;
    const gatewayBlocked = findings.some((finding) => /quarantined attachment as malware/i.test(finding.message || ''));

    return [
        { label: 'SPF', value: hasSpfIssue ? 'bilinmiyor' : 'gecerli / temiz', severity: hasSpfIssue ? 'warning' : 'safe' },
        { label: 'DKIM', value: hasDkimIssue ? 'bilinmiyor' : 'gecerli / temiz', severity: hasDkimIssue ? 'warning' : 'safe' },
        { label: 'DMARC', value: hasDmarcIssue ? 'bilinmiyor' : 'gecerli / temiz', severity: hasDmarcIssue ? 'warning' : 'safe' },
        {
            label: 'Gonderen itibari',
            value: suspiciousSender ? 'riskli / dikkat gerekli' : (authIssues >= 2 ? 'orta' : 'normal'),
            severity: suspiciousSender ? 'warning' : (authIssues >= 2 ? 'warning' : 'safe'),
            note: suspiciousSender ? 'Icerik ve gonderen kalibi ek dogrulama gerektiriyor.' : ''
        },
        {
            label: 'Mail gateway',
            value: gatewayBlocked ? 'zararli ek karantinaya alindi' : 'ek bloklama sinyali yok',
            severity: gatewayBlocked ? 'critical' : 'safe',
            note: gatewayBlocked ? 'Ek mail kutusuna ulasmadan once guvenlik gecidinde yakalandi.' : ''
        }
    ];
}

function buildThreatTags(data) {
    const findings = data.findings || [];
    const tags = [];
    const seen = new Set();

    const pushTag = (key, label, severity) => {
        if (seen.has(key)) return;
        seen.add(key);
        tags.push({ label, severity });
    };

    findings.forEach((finding) => {
        const message = (finding.message || '').toLowerCase();
        if (finding.category === 'attachment') pushTag('attachment', 'Supheli ek / dosya riski', finding.severity);
        if (finding.category === 'attachment' && /quarantined attachment as malware/i.test(message)) {
            pushTag('gateway-malware', 'Mail gecidi zararli eki engelledi', 'critical');
        }
        if (finding.category === 'virusTotal') pushTag('vt', 'Antivirus / itibar kontrolu', finding.severity);
        if (finding.category === 'header') pushTag('auth', 'Kimlik dogrulama eksikligi', finding.severity);
        if (finding.category === 'link') pushTag('link', 'Supheli baglanti davranisi', finding.severity);
        if (finding.category === 'content' && /urgent|acil|teklif|quotation|invoice|payment|wire|bank/.test(message)) {
            pushTag('fraud', 'Potansiyel dolandiricilik / sosyal muhendislik', finding.severity);
        }
        if (finding.category === 'ai' && /phish|fraud|bec|spoof|imperson/i.test(message)) {
            pushTag('ai-fraud', 'Yapay zeka tabanli tehdit sinyali', finding.severity);
        }
    });

    return tags;
}

function buildLinkSummary(data) {
    const findings = data.findings || [];
    const linkItems = findings
        .filter((finding) => finding.category === 'link' && !/no links found|issues found|no issues found/i.test(finding.message))
        .map((finding) => finding.message);

    const safeNoLinks = findings.some((finding) => finding.category === 'link' && /no links found/i.test(finding.message));
    const total = safeNoLinks ? 0 : Math.max(linkItems.length, findings.some((finding) => finding.category === 'link') ? 1 : 0);

    return { total, items: linkItems };
}

function buildRecommendations(data) {
    const recommendations = [];
    const findings = data.findings || [];

    if (data.level === 'high' || data.level === 'medium') {
        recommendations.push('Maili acmadan once gonderen ve talep edilen islemi ikinci bir kanal ile dogrulayiniz.');
    }
    if (findings.some((finding) => finding.category === 'attachment')) {
        recommendations.push('Ek dosyalari yalnizca guvenilir kaynagi dogruladiktan sonra aciniz.');
    }
    if (findings.some((finding) => /quarantined attachment as malware/i.test(finding.message || ''))) {
        recommendations.push('Bu maildeki zararli ek gateway tarafinda engellenmis. Orijinal gondereni ve is ihtiyacini ikinci kanal ile dogrulayiniz.');
    }
    if (findings.some((finding) => finding.category === 'header')) {
        recommendations.push('Kimlik dogrulama basliklari eksik oldugu icin maili dikkatli degerlendiriniz.');
    }
    if (findings.some((finding) => finding.category === 'link' && finding.severity !== 'safe')) {
        recommendations.push('Baglantilara tiklamadan once hedef alan adini manuel olarak kontrol ediniz.');
    }
    if (!recommendations.length) {
        recommendations.push('Belirgin risk gorunmese de standart e-posta guvenlik prosedurlerini uygulayiniz.');
    }

    return recommendations;
}

function renderAttachmentVerdict(row, vtStatus) {
    if (row.quarantined) {
        return `<span class="report-pill severity-critical">Gateway tarafinda zararli olarak karantinaya alindi</span>`;
    }

    if (row.vt?.checked && row.vt?.found) {
        const malicious = row.vt.stats?.malicious || 0;
        const total = row.vt.stats?.total || 0;
        if (malicious > 0) {
            return `<span class="report-pill severity-critical">Zararli - ${malicious}/${total} motor</span>`;
        }
        const suspicious = row.vt.stats?.suspicious || 0;
        if (suspicious > 0) {
            return `<span class="report-pill severity-warning">Supheli - ${suspicious} motor</span>`;
        }
        return `<span class="report-pill severity-safe">Temiz — ${total} antivirüste tehdit yok</span>`;
    }

    if (row.issues?.some((issue) => issue !== 'clean' && issue !== 'large-file')) {
        return `<span class="report-pill severity-critical">Yerel kontrolde risk bulundu</span>`;
    }

    if (vtStatus?.available && !vtStatus?.configured) {
        return `<span class="report-pill severity-warning">Yerel kontrol temiz, virüs tarama anahtarı yok</span>`;
    }

    return `<span class="report-pill severity-safe">Yerel kontrol temiz</span>`;
}

function localizeSeverity(severity) {
    return {
        critical: 'Yuksek',
        warning: 'Orta',
        info: 'Bilgi',
        safe: 'Dusuk'
    }[severity] || severity;
}

function localizeCategory(category) {
    return {
        header: 'Kimlik Dogrulama',
        content: 'Icerik',
        link: 'Baglantilar',
        attachment: 'Ek Dosya',
        virusTotal: 'Tespit Edilen Tehdit Tipleri',
        abuse:      'Link Tarama Motoru Sonuçları',
        ai: 'Yapay Zeka'
    }[category] || category || 'Genel';
}

function shortHash(hash) {
    if (!hash) return 'N/A';
    return hash.length > 18 ? `${hash.slice(0, 18)}...` : hash;
}

function collectArchiveWarnings(data) {
    const rows = Array.isArray(data?.attachmentDetails) ? data.attachmentDetails : [];
    return rows
        .filter((row) => Array.isArray(row.archiveEntries) && row.archiveEntries.some((entry) => entry.severity === 'critical'))
        .map((row) => `${row.filename} -> ${row.archiveEntries.filter((entry) => entry.severity === 'critical').map((entry) => entry.name).join(', ')}`);
}

function renderArchiveWarningForEntry(entry, data) {
    const row = findAttachmentRowForEntry(entry, data);
    const dangerousEntries = row?.archiveEntries?.filter((item) => item.severity === 'critical') || [];
    if (!dangerousEntries.length) return '';

    return `<div class="text-red" class="u-mt8">Archive inspection warning: embedded dangerous file(s) detected -> ${dangerousEntries.map((item) => esc(item.name)).join(', ')}</div>`;
}

function virusTotalDisplaySeverity(entry, data) {
    if ((entry.stats?.malicious || 0) > 0 || (entry.stats?.suspicious || 0) > 0) {
        return 'critical';
    }

    const row = findAttachmentRowForEntry(entry, data);
    if (row?.archiveEntries?.some((item) => item.severity === 'critical')) {
        return 'critical';
    }

    return 'safe';
}

function findAttachmentRowForEntry(entry, data) {
    const rows = Array.isArray(data?.attachmentDetails) ? data.attachmentDetails : [];
    return rows.find((row) => row.hash && entry.hash && row.hash === entry.hash)
        || rows.find((row) => row.filename === entry.filename);
}

function renderOpenAIAnalysis(analysis) {
    const openaiContent = document.getElementById('aiTab-openai');
    if (!openaiContent) return;

    // Tab her zaman dolu; içerik güncellenir
    if (!analysis) {
        openaiContent.innerHTML = `
            <div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:14px;">
                🔑 OpenAI API anahtarı yapılandırılmamış veya bu analiz için AI çalıştırılmadı.
            </div>`;
        return;
    }

    const summary   = _tLit(analysis.summaryTR, analysis.summaryEN);
    const narrative = _tLit(analysis.attackNarrativeTR, analysis.attackNarrativeEN);
    const modelName = analysis._model || 'gpt-4o-mini';

    openaiContent.innerHTML = `
        <!-- Hangi AI modeli kullanıldı — küçük rozet -->
        <div style="padding:6px 12px 0;margin-bottom:12px;">
            <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;
                         color:#a5b4fc;background:rgba(99,102,241,0.12);
                         border:1px solid rgba(99,102,241,0.3);border-radius:20px;padding:3px 10px;">
                <span style="font-size:13px;">🤖</span>
                Model: <code style="font-size:11px;color:#c7d2fe;">${esc(modelName)}</code>
            </span>
        </div>

        <div style="font-size:15px;line-height:1.6;margin-bottom:16px;padding:0 12px;">
            <strong>${esc(summary || 'No summary available')}</strong>
        </div>
        <div class="grid-2" style="margin-bottom:16px;padding:0 12px;">
            <div class="finding-item">
                <div class="finding-icon ${severityFromThreatLevel(analysis.threatLevel)}">${findingIcon(severityFromThreatLevel(analysis.threatLevel))}</div>
                <div>
                    <div class="finding-category">THREAT LEVEL</div>
                    <div class="finding-text" style="text-transform:uppercase;font-weight:bold;">${esc(analysis.threatLevel || 'N/A')}</div>
                </div>
            </div>
            <div class="finding-item">
                <div class="finding-icon">AI</div>
                <div>
                    <div class="finding-category">CATEGORY / CONFIDENCE</div>
                    <div class="finding-text" style="text-transform:capitalize;">${esc(analysis.category || 'N/A')} — ${esc(String(analysis.confidence || 0))}%</div>
                </div>
            </div>
        </div>
        <div class="finding-item" style="margin-bottom:16px;padding:0 12px;">
            <div>
                <div class="finding-category">ANALYST NARRATIVE</div>
                <div class="finding-text">${esc(narrative || summary || '')}</div>
            </div>
        </div>
        <div class="grid-2" style="margin-bottom:16px;padding:0 12px;">
            <div class="finding-item">
                <div>
                    <div class="finding-category">RISK PROFILE</div>
                    <div class="finding-text">Impersonation: ${esc(analysis.impersonationRisk || 'N/A')}</div>
                    <div class="finding-text">Financial: ${esc(analysis.financialRisk || 'N/A')}</div>
                    <div class="finding-text">Credential: ${esc(analysis.credentialRisk || 'N/A')}</div>
                    <div class="finding-text">Urgency: ${esc(analysis.urgencyRisk || 'N/A')}</div>
                </div>
            </div>
            <div class="finding-item">
                <div>
                    <div class="finding-category">MALICIOUS INTENT SCORE</div>
                    <div class="finding-text" style="font-size:22px;font-weight:700;">${esc(String(analysis.maliciousIntentScore || 0))}/100</div>
                </div>
            </div>
        </div>
        <div style="padding:0 12px 4px;">
        ${renderAnalysisList('Red Flags', analysis.redFlagsTR)}
        ${renderAnalysisList('Social Engineering Signals', analysis.socialEngineeringSignalsTR)}
        ${renderAnalysisList('Requested Actions', analysis.requestedActionsTR)}
        ${renderAnalysisList(_tLit('Önerilen Aksiyonlar', 'Recommended Actions'), analysis.recommendedActionsTR)}
        </div>
    `;
}

/** Eski: OpenAI kartı toggle — artık tab sistemiyle çalışıyor */
function toggleOpenaiCard() { switchAiTab('openai'); }

function renderAnalysisList(title, items) {
    if (!items || !items.length) return '';
    return `
        <div class="u-mb16">
            <div class="finding-category" class="u-mb8">${esc(title)}</div>
            <div class="findings-list">
                ${items.map((item) => `
                    <div class="finding-item compact">
                        <div class="finding-icon info">i</div>
                        <div class="finding-text">${esc(item)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function resetView() {
    const targetMode = history.state?.mode || currentMode || 'upload';

    if (resetFallbackTimer) {
        clearTimeout(resetFallbackTimer);
        resetFallbackTimer = null;
    }

    if (history.state?.view === 'results' && history.length > 1) {
        history.back();
        resetFallbackTimer = window.setTimeout(() => {
            if (!document.getElementById('resultsPanel').classList.contains('hidden')) {
                restoreMainView(targetMode, true);
            }
        }, 250);
        return;
    }

    restoreMainView(targetMode, true);
}

function hideSecondaryResultBlocks() {
    document.getElementById('attachmentResults').classList.add('hidden');
    document.getElementById('attachmentContent').innerHTML = '';
    document.getElementById('vtResults').classList.add('hidden');
    document.getElementById('vtContent').innerHTML = '';
    // AI sekmeleri temizle
    const tabs = ['aiTab-deep', 'aiTab-openai', 'aiTab-claude'];
    tabs.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
}

function restoreMainView(mode = currentMode, updateState = false) {
    currentResult = null;
    hideSecondaryResultBlocks();
    document.getElementById('resultsPanel').classList.add('hidden');
    document.getElementById('scanProgress').classList.add('hidden');
    document.getElementById('scanModes').classList.remove('hidden');
    selectMode(mode, false);

    if (updateState) {
        history.replaceState({ view: 'main', mode }, '', location.pathname);
    }
}

// ============================================================
// IMAP
// ============================================================
// Müşteri user rolü için ortak yetki kontrolü — admin-only işlemleri engeller.
function _denyIfCustomerUser(actionLabel) {
    if (getCustomerRole() !== 'user') return false;
    alert(_tLit(`Bu işlem (${actionLabel}) yalnız müşteri yönetici hesabında yapılabilir.`, `This action (${actionLabel}) is admin-only.`));
    return true;
}

function showImapModal() {
    if (_denyIfCustomerUser('IMAP Hesabı Ekle/Düzenle')) return;
    document.getElementById('imapModal').classList.remove('hidden');
}

// ---- Multi-email tag input for Rapor Alıcısı ----
let alertEmailList = [];
let editingImapAlertAccountEmail = null;

function updateAlertDefaultRecipientHint() {
    const hint = document.getElementById('imapAlertDefaultHint');
    if (hint) {
        if (!editingImapAlertAccountEmail) {
            hint.innerHTML = '<span class="u-err">⚠️ Tarama posta kutusu tanımlanmamış</span>';
        } else {
            hint.innerHTML = `Birden fazla alıcı ekleyebilirsiniz. Boş bırakılırsa: <span style="opacity:0.45">${editingImapAlertAccountEmail}</span>`;
        }
    }
    // Özet kutusundaki alıcı etiketini de güncelle
    const summary = document.getElementById('imapAlertSummaryRecipient');
    if (summary) {
        summary.textContent = editingImapAlertAccountEmail || 'bu hesabın kendisi';
    }
}

function toggleImapAlertAdvanced() {
    const adv = document.getElementById('imapAlertAdvanced');
    const btn = document.getElementById('imapAlertAdvancedBtn');
    if (!adv) return;
    const open = adv.style.display !== 'none';
    adv.style.display = open ? 'none' : 'block';
    if (btn) btn.textContent = open ? '⚙️ Özelleştir' : '🙈 Gizle';
}

function renderAlertEmailTags() {
    const container = document.getElementById('imapAlertReportToTags');
    if (!container) return;
    container.innerHTML = '';
    alertEmailList.forEach((email, i) => {
        const tag = document.createElement('span');
        tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:rgba(99,102,241,0.25);border:1px solid rgba(99,102,241,0.45);border-radius:4px;padding:2px 8px;font-size:12px;white-space:nowrap';
        tag.innerHTML = `${email} <span onclick="removeAlertEmail(${i})" style="cursor:pointer;opacity:0.7;font-size:14px;line-height:1">&times;</span>`;
        container.appendChild(tag);
    });
    syncAlertEmailHidden();
}

function syncAlertEmailHidden() {
    const hidden = document.getElementById('imapAlertReportTo');
    if (hidden) hidden.value = alertEmailList.join(',');
}

function onAlertEmailKeydown(e) {
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        tryAddAlertEmail();
    } else if (e.key === 'Backspace' && e.target.value === '' && alertEmailList.length) {
        alertEmailList.pop();
        renderAlertEmailTags();
    }
}

function tryAddAlertEmail() {
    const input = document.getElementById('imapAlertReportToInput');
    if (!input) return;
    const val = input.value.trim().replace(/,+$/, '');
    if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) && !alertEmailList.includes(val)) {
        alertEmailList.push(val);
        renderAlertEmailTags();
    }
    input.value = '';
}

function removeAlertEmail(index) {
    alertEmailList.splice(index, 1);
    renderAlertEmailTags();
}

function clearAlertEmails() {
    alertEmailList = [];
    renderAlertEmailTags();
    const input = document.getElementById('imapAlertReportToInput');
    if (input) input.value = '';
}

function setAlertEmails(csvOrArray) {
    if (Array.isArray(csvOrArray)) {
        alertEmailList = csvOrArray.filter(Boolean);
    } else {
        alertEmailList = String(csvOrArray || '').split(',').map(s => s.trim()).filter(Boolean);
    }
    renderAlertEmailTags();
}

// ---- end multi-email tag input ----

function closeImapModal() {
    document.getElementById('imapModal').classList.add('hidden');
    const quarantineCheck = document.getElementById('imapMoveHighRiskToQuarantine');
    if (quarantineCheck) quarantineCheck.checked = false;
    const alertCheck = document.getElementById('imapRealTimeAlert');
    if (alertCheck) { alertCheck.checked = false; toggleImapRealTimeAlertSection(false); }
    clearAlertEmails();
    const senderSel = document.getElementById('imapAlertSenderAccount');
    if (senderSel) senderSel.value = '';
    // Advanced bölümü kapalı duruma sıfırla
    const adv = document.getElementById('imapAlertAdvanced');
    if (adv) adv.style.display = 'none';
    const advBtn = document.getElementById('imapAlertAdvancedBtn');
    if (advBtn) advBtn.textContent = '⚙️ Özelleştir';
    editingImapAlertAccountEmail = null;
}

function toggleImapRealTimeAlertSection(show) {
    if (show && licenseInfo?.plan !== 'enterprise') {
        alert('Anlık güvenlik raporu özelliği yalnızca Enterprise lisansında kullanılabilir.');
        const cb = document.getElementById('imapRealTimeAlert');
        if (cb) cb.checked = false;
        const section = document.getElementById('imapRealTimeAlertSection');
        if (section) section.style.display = 'none';
        return;
    }
    const section = document.getElementById('imapRealTimeAlertSection');
    if (section) section.style.display = show ? 'block' : 'none';
    if (show) {
        updateAlertDefaultRecipientHint();
        loadAlertSenderOptions('');
    }
}

async function loadAlertSenderOptions(selectedEmail) {
    const select = document.getElementById('imapAlertSenderAccount');
    if (!select) return;
    select.innerHTML = '<option value="">— Bu hesabın kimlik bilgileriyle gönder —</option>';
    try {
        const res = await fetch('/api/scan-mailboxes');
        if (!res.ok) return;
        const mailboxes = await res.json();
        mailboxes.forEach(smb => {
            const opt = document.createElement('option');
            opt.value = smb.imapEmail;
            opt.textContent = smb.imapEmail;
            if (smb.imapEmail === selectedEmail) opt.selected = true;
            select.appendChild(opt);
        });
    } catch {}
}

function onImapAlertModeChange(select) {
    const warning = document.getElementById('imapAlertModeWarning');
    if (warning) warning.style.display = (select.value === 'all' && licenseInfo?.plan !== 'enterprise') ? 'block' : 'none';
}

function getImapAlertFormData() {
    return {
        enabled: document.getElementById('imapRealTimeAlert')?.checked === true,
        reportMode: document.getElementById('imapAlertMode')?.value || 'risky',
        reportTo: (document.getElementById('imapAlertReportTo')?.value || '').trim(),
        senderSmtpEmail: document.getElementById('imapAlertSenderAccount')?.value || '',
        reportLang: document.getElementById('imapAlertLang')?.value || 'tr'
    };
}

async function testImapConnection() {
    const account = getImapFormData();
    const resultDiv = document.getElementById('imapTestResult');
    resultDiv.innerHTML = `<div class="text-muted mt-16">Testing connection...</div>`;

    try {
        const res = await fetch('/api/imap/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(account)
        });
        const data = await res.json();
        resultDiv.innerHTML = data.success
            ? `<div class="text-green mt-16" style="font-weight:bold;font-size:16px;">${t('imap_test_ok')}</div>`
            : `<div class="text-red mt-16">${t('imap_test_fail')}: ${esc(data.message)}</div>`;
    } catch (error) {
        resultDiv.innerHTML = `<div class="text-red mt-16">Connection error: ${esc(error.message)}</div>`;
    }
}

async function saveImapAccount() {
    const account = getImapFormData();
    const isEditMode = !!editingImapAlertAccountEmail;

    if (!account.email || !account.host) {
        alert(_tLit('E-posta ve sunucu zorunludur', 'Email and host are required'));
        return;
    }

    if (!account.password && isEditMode) {
        account.password = '__KEEP_EXISTING_PASSWORD__';
    }

    // Yeni hesap eklerken şifre zorunlu; düzenlemede boş bırakılırsa IMAP kaydını atla
    if (!account.password && !isEditMode) {
        alert(_tLit('Yeni hesap icin sifre zorunludur', 'Password is required for new accounts'));
        return;
    }

    // Anlık rapor ayarlarını kaydet / sil
    const imapSaveRes = await fetch('/api/imap/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(account)
    });
    const imapSaveData = await imapSaveRes.json();
    if (!imapSaveRes.ok) {
        alert(imapSaveData.error || 'Failed to save IMAP account');
        return;
    }

    const alert_ = getImapAlertFormData();
    const targetEmail = account.email || editingImapAlertAccountEmail;
    if (alert_.enabled) {
        if (alert_.reportMode === 'all' && licenseInfo?.plan !== 'enterprise') {
            alert_.reportMode = 'risky';
        }
        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;
        // IMAP bağlantı bilgilerini de gönder — server scan-mailbox kaydı için bunlara ihtiyaç duyuyor.
        // Edit modunda şifre boş olabilir; o durumda server mevcut kayıttaki şifreyi yeniden kullanır.
        const payload = {
            ...alert_,
            imapEmail:              targetEmail,
            imapHost:               account.host,
            imapPort:               account.port,
            imapPassword:           account.password,
            imapTls:                account.secure,
            imapRejectUnauthorized: account.rejectUnauthorized,
            realtimeAlert:          true
        };
        try {
            const res = await fetch('/api/scan-mailboxes', {
                method: 'POST', headers, body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert((_tLit('Anlık rapor kaydedilemedi: ', 'Failed to save instant report: ')) + (data.error || res.status));
                return;
            }
        } catch (e) {
            alert((_tLit('Anlık rapor kaydedilemedi: ', 'Failed to save instant report: ')) + e.message);
            return;
        }
    } else {
        await fetch(`/api/scan-mailboxes/${encodeURIComponent(targetEmail)}`, { method: 'DELETE' }).catch(() => {});
    }

    closeImapModal();
    document.getElementById('imapTestResult').innerHTML = '';
    loadImapAccounts();
    if (currentMode === 'scan-mailbox') loadScanMailboxes();
}

function getImapFormData() {
    const portVal = parseInt(document.getElementById('imapPort').value, 10) || 993;
    return {
        email: document.getElementById('imapEmail').value,
        password: document.getElementById('imapPassword').value,
        host: document.getElementById('imapHost').value,
        port: portVal,
        secure: portVal === 993,
        rejectUnauthorized: !document.getElementById('imapIgnoreSSL').checked,
        autoSummaryReport: document.getElementById('imapAutoSummaryReport')?.checked === true,
        moveHighRiskToQuarantine: document.getElementById('imapMoveHighRiskToQuarantine')?.checked === true
    };
}

async function loadImapAccounts() {
    try {
        const res = await fetch('/api/imap/accounts');
        const accounts = await res.json();
        const select = document.getElementById('imapAccountSelect');

        const accountExists = currentImapEmail && accounts.some((account) => account.email === currentImapEmail);
        if (!accountExists) {
            currentImapEmail = accounts[0]?.email || null;
            currentImapUid = null;
            currentImapLimit = 30;
            currentImapHasMore = false;
            currentImapTotal = 0;
        }

        if (accounts.length > 0) {
            const isCustomerUserRole = getCustomerRole() === 'user';
            select.innerHTML = accounts.map((account) => {
                const isMonitoring = activeMonitorEmails.has(account.email);
                const isReportMenuOpen = activeReportMenuEmail === account.email;
                // Müşteri user rolünde: Edit, Delete, Rutin Rapor, Rapor Gönder
                // gizli. Yalnız "Listele" butonu görünür — mailleri görüntüleyebilir.
                const adminControls = isCustomerUserRole ? '' : `
                    <button class="btn btn-ghost btn-sm" onclick='editImapAccount(${JSON.stringify(account.email)})'>Edit</button>
                    <button class="btn btn-danger btn-sm" onclick='deleteImapAccount(${JSON.stringify(account.email)})'>Delete</button>
                    <label class="btn btn-ghost btn-sm imap-report-toggle" title="Günlük/haftalık/aylık özet rapor alır" onclick="event.stopPropagation()">
                        <input type="checkbox" ${account.autoSummaryReport ? 'checked' : ''} onchange='toggleImapAutoReport(${JSON.stringify(account.email)}, this.checked)'>
                        Rutin Rapor
                    </label>
                    <div class="imap-report-actions" onclick="event.stopPropagation()">
                        <button class="btn btn-ghost btn-sm" onclick='toggleReportMenu(${JSON.stringify(account.email)})'>Rapor Gonder</button>
                        ${isReportMenuOpen ? `
                            <div class="imap-report-menu">
                                <button class="btn btn-ghost btn-sm" onclick='triggerMailboxReport(${JSON.stringify(account.email)}, "daily")'>Gunluk</button>
                                <button class="btn btn-ghost btn-sm" onclick='triggerMailboxReport(${JSON.stringify(account.email)}, "weekly")'>Haftalik</button>
                                <button class="btn btn-ghost btn-sm" onclick='triggerMailboxReport(${JSON.stringify(account.email)}, "monthly")'>Aylik</button>
                                <button class="btn btn-ghost btn-sm" onclick='triggerMailboxReport(${JSON.stringify(account.email)}, "yearly")'>Yillik</button>
                            </div>
                        ` : ''}
                    </div>`;
                return `
                <div class="connection-bar imap-account-row ${isMonitoring ? 'monitoring' : ''}" data-account-email="${esc(account.email)}" class="u-mb8">
                    <span class="status-dot ${isMonitoring ? 'monitoring' : 'connected'}"></span>
                    <strong>${esc(account.email)}</strong>
                    <span class="text-muted">${esc(account.host)}:${account.port}</span>
                    ${account.moveHighRiskToQuarantine ? '<span class="email-monitor-badge">Quarantine</span>' : ''}
                    <span class="u-flex1"></span>
                    ${adminControls}
                    <button class="btn btn-primary btn-sm" style="margin-left:8px" onclick='refreshInbox(${JSON.stringify(account.email)})'>Listele</button>
                </div>
            `;
            }).join('');

            document.getElementById('connectionBar').classList.remove('hidden');
            document.getElementById('connectionText').textContent = accounts.map((account) => account.email).join(', ');
        } else {
            select.innerHTML = '';
            document.getElementById('connectionBar').classList.add('hidden');
            document.getElementById('statusDot').className = 'status-dot disconnected';
            document.getElementById('connectionText').textContent = _tLit('Bagli degil', 'Not connected');
            document.getElementById('emailList').innerHTML = `<p class="text-muted">${t('imap_no_account')}</p>`;
            renderImapReportPlaceholder(t('imap_no_account'));
            currentImapMessages = [];
            activeMonitorEmails = new Set();
            currentImapLimit = 30;
            currentImapHasMore = false;
            currentImapTotal = 0;
        }

        updateMonitorIndicators();
        updateMonitorButton();
        updateScanSelectedButton();
    } catch (error) {
        console.warn('Failed to load IMAP accounts', error);
    }
}

async function deleteImapAccount(email) {
    if (_denyIfCustomerUser('IMAP Hesabı Sil')) return;
    const okay = await showConfirm({
        title:       _tLit('IMAP Hesabı Sil', 'Delete IMAP Account'),
        message:     _tLit(`${email} hesabini silmek istediginize emin misiniz?`, `Are you sure you want to delete ${email}?`),
        confirmText: _tLit('Sil', 'Delete'),
        cancelText:  _tLit('Vazgeç', 'Cancel'),
        danger: true
    });
    if (!okay) return;

    await fetch(`/api/imap/accounts/${encodeURIComponent(email)}`, { method: 'DELETE' });

    if (currentImapEmail === email) {
        currentImapEmail = null;
        currentImapUid = null;
        currentImapMessages = [];
        currentImapLimit = 30;
        currentImapHasMore = false;
        currentImapTotal = 0;
        imapReportCache.clear();
        renderImapReportPlaceholder(t('imap_no_account'));
        document.getElementById('emailList').innerHTML = `<p class="text-muted">${t('imap_no_account')}</p>`;
    }

    activeMonitorEmails.delete(email);

    loadImapAccounts();
}

async function editImapAccount(email) {
    if (_denyIfCustomerUser('IMAP Hesabı Düzenle')) return;
    const res = await fetch('/api/imap/accounts');
    const accounts = await res.json();
    const account = accounts.find((item) => item.email === email);
    if (!account) return;

    editingImapAlertAccountEmail = account.email;
    document.getElementById('imapEmail').value = account.email;
    document.getElementById('imapPassword').value = '';
    document.getElementById('imapPassword').placeholder = _tLit('Mevcut sifreyi tekrar girin', 'Re-enter current password');
    document.getElementById('imapHost').value = account.host;
    document.getElementById('imapPort').value = account.port || 993;
    document.getElementById('imapIgnoreSSL').checked = account.rejectUnauthorized === false;
    document.getElementById('imapAutoSummaryReport').checked = account.autoSummaryReport === true;
    document.getElementById('imapMoveHighRiskToQuarantine').checked = account.moveHighRiskToQuarantine === true;

    // Anlık rapor bölümünü temizle
    document.getElementById('imapRealTimeAlert').checked = false;
    toggleImapRealTimeAlertSection(false);

    // Varsa mevcut scan mailbox ayarlarını doldur
    try {
        const smRes = await fetch('/api/scan-mailboxes');
        const scanMailboxes = await smRes.json();
        const smb = scanMailboxes.find(s => s.imapEmail === email);
        if (smb) {
            const enabled = smb.enabled !== false;
            document.getElementById('imapRealTimeAlert').checked = enabled;
            toggleImapRealTimeAlertSection(enabled);
            document.getElementById('imapAlertMode').value = smb.reportMode || 'risky';
            setAlertEmails(smb.reportTo || '');
            document.getElementById('imapAlertLang').value = smb.reportLang || 'tr';
            await loadAlertSenderOptions(smb.senderSmtpEmail || '');
            // Daha önce varsayılan dışı bir ayar yapılmışsa advanced'i otomatik aç
            const isCustomized =
                (smb.reportMode && smb.reportMode !== 'risky') ||
                (smb.reportTo && smb.reportTo.length > 0) ||
                (smb.reportLang && smb.reportLang !== 'tr') ||
                !!smb.senderSmtpEmail;
            if (enabled && isCustomized) {
                const adv = document.getElementById('imapAlertAdvanced');
                const btn = document.getElementById('imapAlertAdvancedBtn');
                if (adv) adv.style.display = 'block';
                if (btn) btn.textContent = '🙈 Gizle';
            }
        }
    } catch {}

    showImapModal();
}

async function toggleImapAutoReport(email, enabled) {
    if (_denyIfCustomerUser('Rutin Rapor')) return;
    try {
        const res = await fetch(`/api/imap/accounts/${encodeURIComponent(email)}/report`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Rapor ayari guncellenemedi');
        }
        loadImapAccounts();
        loadPeriodicReportSettings();
    } catch (error) {
        alert(error.message);
        loadImapAccounts();
    }
}

function toggleReportMenu(email) {
    if (_denyIfCustomerUser('Rapor Gönder')) return;
    activeReportMenuEmail = activeReportMenuEmail === email ? null : email;
    loadImapAccounts();
}

async function triggerMailboxReport(email, period) {
    if (_denyIfCustomerUser('Rapor Gönder')) return;
    const statusEl = document.getElementById('periodicReportStatus');
    activeReportMenuEmail = email;
    if (statusEl) {
        statusEl.textContent = `${email} icin ${period} raporu hazirlaniyor...`;
    }

    try {
        const res = await fetch('/api/reports/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ period, targetEmail: email })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Rapor gonderilemedi');
        }
        if (statusEl) {
            statusEl.textContent = `${email} adresine ${period} raporu gonderildi. Toplam tarama: ${data.stats.total} | Riskli: ${data.stats.risky}`;
        }
    } catch (error) {
        if (statusEl) {
            statusEl.textContent = `${email} icin rapor gonderilemedi: ${error.message}`;
        }
        alert(error.message);
    } finally {
        activeReportMenuEmail = null;
        loadImapAccounts();
    }
}

async function refreshInbox(email, options = {}) {
    const { keepLimit = false, preserveSelection = false } = options;
    let targetEmail = email || currentImapEmail;

    if (!targetEmail) {
        const res = await fetch('/api/imap/accounts');
        const accounts = await res.json();
        targetEmail = accounts[0]?.email;
    }

    if (!targetEmail) return;

    currentImapEmail = targetEmail;
    currentImapMessages = [];
    if (!preserveSelection) {
        currentImapUid = null;
        selectedImapUids.clear();
    }
    if (!keepLimit) {
        currentImapLimit = 30;
    }
    currentImapHasMore = false;
    currentImapTotal = 0;
    if (!preserveSelection) {
        imapReportCache.clear();
    }

    updateMonitorButton();
    updateScanSelectedButton();

    document.getElementById('emailList').innerHTML = `
        <div class="imap-report-empty">
            <div class="inline-spinner"></div>
            <span>${_tLit('Mail listesi yukleniyor...', 'Loading inbox...')}</span>
        </div>
    `;
    if (!preserveSelection) {
        renderImapReportPlaceholder(_tLit('Sag tarafta rapor icin bir e-posta sececeksiniz.', 'Select an email to load its health report.'));
    }

    try {
        const res = await fetch('/api/imap/list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(licenseKey ? { 'x-license-key': licenseKey } : {})
            },
            body: JSON.stringify({ email: targetEmail, folder: 'INBOX', limit: currentImapLimit })
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Inbox load failed');
        }

        currentImapMessages = data.messages || [];
        currentImapHasMore = typeof data.hasMore === 'boolean'
            ? data.hasMore
            : currentImapMessages.length >= currentImapLimit;
        currentImapTotal = Number(data.total) || currentImapMessages.length + (currentImapHasMore ? 1 : 0);
        renderImapMessageList();

        if (!currentImapMessages.length) {
            renderImapReportPlaceholder(_tLit('Bu hesapta listelenecek e-posta bulunamadi.', 'No emails found for this account.'));
        }
    } catch (error) {
        currentImapMessages = [];
        currentImapUid = null;
        currentImapHasMore = false;
        currentImapTotal = 0;
        document.getElementById('btnLoadMoreImap')?.classList.add('hidden');
        updateScanSelectedButton();
        document.getElementById('emailList').innerHTML = `<p class="text-red">${esc(error.message)}</p>`;
        renderImapReportPlaceholder(
            `Rapor yüklenemedi: ${error.message}`,
            'error'
        );
    }
}

function loadMoreInbox() {
    if (!currentImapEmail || !currentImapHasMore) return;
    currentImapLimit += 30;
    refreshInbox(currentImapEmail, { keepLimit: true, preserveSelection: true });
}

function renderImapMessageList() {
    const list = document.getElementById('emailList');
    const loadMoreButton = document.getElementById('btnLoadMoreImap');
    const isMonitoringCurrentMailbox = !!currentImapEmail && activeMonitorEmails.has(currentImapEmail);

    if (!currentImapMessages.length) {
        list.innerHTML = `
            <div class="imap-report-empty">
                ${_tLit('Listelenecek mail bulunamadi.', 'No messages to display.')}
            </div>
        `;
        if (loadMoreButton) {
            loadMoreButton.classList.add('hidden');
        }
        updateScanSelectedButton();
        return;
    }

    const allSelected = currentImapMessages.length > 0 && currentImapMessages.every(m => selectedImapUids.has(m.uid));
    const selectAllHtml = `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 10px 4px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:2px">
            <input type="checkbox" id="imapSelectAll" ${allSelected ? 'checked' : ''}
                onchange="toggleSelectAllImap(this.checked)"
                style="width:15px;height:15px;cursor:pointer;accent-color:var(--blue,#60a5fa);flex-shrink:0">
            <span class="text-muted" class="u-xs">${_tLit('Tümünü seç', 'Select all')} (${currentImapMessages.length})</span>
        </div>`;

    list.innerHTML = selectAllHtml + currentImapMessages.map((message) => {
        const isActive = message.uid === currentImapUid ? 'selected' : '';
        const isChecked = selectedImapUids.has(message.uid);
        const from = message.from?.name || message.from?.address || 'N/A';
        const cacheKey = `${currentImapEmail}::${message.uid}`;
        const isScanning = inFlightImapScans.has(cacheKey);
        return `
            <div style="display:flex;align-items:center;gap:0">
                <label style="display:flex;align-items:center;padding:0 8px;height:100%;cursor:pointer;flex-shrink:0" onclick="event.stopPropagation()">
                    <input type="checkbox" ${isChecked ? 'checked' : ''}
                        onchange="toggleImapCheckbox(${message.uid})"
                        style="width:15px;height:15px;cursor:pointer;accent-color:var(--blue,#60a5fa)">
                </label>
                <button
                    type="button"
                    class="email-item email-row ${isActive} ${isMonitoringCurrentMailbox ? 'monitoring' : ''}"
                    class="u-flex1-0"
                    onclick='openImapMail(${message.uid}, ${JSON.stringify(currentImapEmail)})'
                >
                    <span class="email-bullet"></span>
                    <div class="email-main">
                        <div class="email-head">
                            <div class="email-head-main">
                                <span class="email-from">${esc(from)}</span>
                                ${isMonitoringCurrentMailbox ? `<span class="email-monitor-badge">${_tLit('Izleniyor', 'Monitoring')}</span>` : ''}
                                ${isScanning ? `<span class="email-monitor-badge">${_tLit('Taraniyor', 'Scanning')}</span>` : ''}
                            </div>
                            <span class="email-date">${formatDate(message.date, false)}</span>
                        </div>
                        <div class="email-subject">${esc(message.subject || '(No subject)')}</div>
                    </div>
                </button>
            </div>
        `;
    }).join('');

    if (loadMoreButton) {
        if (currentImapHasMore) {
            loadMoreButton.classList.remove('hidden');
            loadMoreButton.disabled = false;
            loadMoreButton.innerHTML = _tLit(`⬇️ <span>Daha Fazla Yükle (${currentImapMessages.length}/${currentImapTotal})</span>`, `⬇️ <span>Load More (${currentImapMessages.length}/${currentImapTotal})</span>`);
        } else {
            loadMoreButton.classList.add('hidden');
        }
    }

    updateScanSelectedButton();
}

async function openImapMail(uid, email, forceRefresh = false) {
    const targetEmail = email || currentImapEmail;
    if (!targetEmail) return;

    currentImapEmail = targetEmail;
    currentImapUid = uid;
    renderImapMessageList();
    updateMonitorButton();

    const message = currentImapMessages.find((item) => item.uid === uid);
    const cacheKey = `${targetEmail}::${uid}`;

    if (forceRefresh) {
        // 'Yeniden Tara' tıklandı — eski cache'i sil, yeni tarama yapılacak
        _deleteImapCacheEntry(cacheKey);
    } else if (imapReportCache.has(cacheKey)) {
        currentResult = imapReportCache.get(cacheKey);
        renderImapReport(currentResult, message);
        return;
    }

    renderImapReportLoading(message);

    const requestId = ++imapScanToken;
    inFlightImapScans.add(cacheKey);
    renderImapMessageList();

    try {
        const res = await fetch('/api/imap/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(licenseKey ? { 'x-license-key': licenseKey } : {})
            },
            body: JSON.stringify({ email: targetEmail, uid, folder: 'INBOX', forceRefresh })
        });
        const data = await res.json();
        inFlightImapScans.delete(cacheKey);
        renderImapMessageList();

        if (!res.ok) {
            throw new Error(data.error || 'Scan failed');
        }

        const normalized = { ...data, imapEmail: targetEmail, imapUid: uid };
        imapReportCache.set(cacheKey, normalized);
        _persistImapCache();
        loadHistory();

        const stillSelected = requestId === imapScanToken
            && currentImapEmail === targetEmail
            && currentImapUid === uid;

        if (stillSelected) {
            currentResult = normalized;
            renderImapReport(normalized, message);
        } else {
            showImapBackgroundScanNotification(normalized, message);
        }
    } catch (error) {
        inFlightImapScans.delete(cacheKey);
        renderImapMessageList();

        const stillSelected = requestId === imapScanToken
            && currentImapEmail === targetEmail
            && currentImapUid === uid;

        if (stillSelected) {
            renderImapReportPlaceholder(
                `Mail raporu alınamadı: ${error.message}`,
                'error'
            );
        }
    }
}

function toggleImapCheckbox(uid) {
    if (selectedImapUids.has(uid)) {
        selectedImapUids.delete(uid);
    } else {
        selectedImapUids.add(uid);
    }
    updateScanSelectedButton();
    // "Tümünü seç" checkbox'ını güncelle
    const selectAll = document.getElementById('imapSelectAll');
    if (selectAll) {
        selectAll.checked = currentImapMessages.length > 0 &&
            currentImapMessages.every(m => selectedImapUids.has(m.uid));
    }
}

function toggleSelectAllImap(checked) {
    currentImapMessages.forEach(m => {
        if (checked) selectedImapUids.add(m.uid);
        else selectedImapUids.delete(m.uid);
    });
    renderImapMessageList();
    updateScanSelectedButton();
}

async function scanSelected() {
    if (!currentImapEmail) return;
    const uids = selectedImapUids.size > 0
        ? [...selectedImapUids]
        : (currentImapUid ? [currentImapUid] : []);
    if (!uids.length) {
        alert(_tLit('Önce listeden en az bir mail seçin', 'Select at least one email from the list first'));
        return;
    }
    for (const uid of uids) {
        await openImapMail(uid, currentImapEmail, true);
    }
}

function updateScanSelectedButton() {
    const button = document.getElementById('btnScanSelected');
    if (!button) return;
    const count = selectedImapUids.size || (currentImapUid ? 1 : 0);
    button.disabled = !currentImapEmail || count === 0;
    if (selectedImapUids.size > 1) {
        button.innerHTML = `✅ <span>${selectedImapUids.size} ${_tLit('Mail Tara', 'Mails Scan')}</span>`;
    } else {
        button.innerHTML = `✅ <span data-i18n="btn_scan_selected">${t('btn_scan_selected')}</span>`;
    }
}

function renderImapReportPlaceholder(message, tone = 'muted') {
    const pane = document.getElementById('imapReportPane');
    pane.innerHTML = `
        <div class="imap-report-empty ${tone === 'error' ? 'error' : ''}">
            ${esc(message)}
        </div>
    `;
}

function renderImapReportLoading(message) {
    const subject = message?.subject || (_tLit('Mail raporu yukleniyor', 'Loading mail report'));
    const from = message?.from?.name || message?.from?.address || '';

    document.getElementById('imapReportPane').innerHTML = `
        <div class="imap-report-loading">
            <div class="inline-spinner"></div>
            <div>
                <div class="imap-group-title">${_tLit('Saglik raporu hazirlaniyor', 'Preparing health report')}</div>
                <div class="text-muted">${esc(subject)}${from ? ` - ${esc(from)}` : ''}</div>
            </div>
        </div>
    `;
}

function renderImapReport(data, message = null) {
    const pane = document.getElementById('imapReportPane');
    const meta = data.emailMeta || {};
    const from = meta.from?.[0] || {};
    const to = meta.to?.[0] || {};
    // 'virusTotal' kategorisindeki bulguları (= Tespit Edilen Tehdit Tipleri)
    // groups'tan ayır → renderImapThreatTypesSection ile Link Tarama Motoru'nun
    // hemen altında ayrı bir bölüm olarak göstereceğiz.
    const allGroups = groupFindingsByCategory(data.findings || []);
    const groups    = allGroups.filter(g => g.category !== 'virusTotal');

    pane.innerHTML = `
        <div class="imap-health-banner ${data.level}">
            <div class="imap-health-score" style="color:${data.color}">
                <span>${data.score}</span>
            </div>
            <div class="imap-health-copy">
                <h3 style="color:${data.color}">${esc(_tLit(data.labelTR, data.labelEN))}</h3>
                <p>${esc(buildExecutiveSummaryText(data))}</p>
            </div>
            <div class="imap-health-actions">
                <button class="btn btn-ghost btn-sm" onclick="reScanCurrentImapMail()" title="Önbelleği yok say, sunucudan yeni tarama iste">🔄 Yeniden Tara</button>
                <button class="btn btn-ghost btn-sm" onclick="exportPDF()">PDF</button>
                <button class="btn btn-ghost btn-sm" onclick="exportJSON()">JSON</button>
            </div>
        </div>

        <div class="imap-meta-card">
            <div>
                <span class="text-muted">${t('from')}:</span>
                <strong>${esc(from.name || '')} &lt;${esc(from.address || 'N/A')}&gt;</strong>
            </div>
            <div>
                <span class="text-muted">${t('subject')}:</span>
                <strong>${esc(meta.subject || message?.subject || 'N/A')}</strong>
            </div>
            <div>
                <span class="text-muted">${t('to')}:</span>
                ${esc(to.address || currentImapEmail || 'N/A')}
            </div>
            <div>
                <span class="text-muted">${t('date')}:</span>
                ${formatDate(meta.date || message?.date, true)}
            </div>
        </div>

        <div class="imap-summary-grid">
            <div class="imap-summary-card">
                <div class="stat-value" style="color:${data.color}">${data.score}</div>
                <div class="stat-label">${t('stat_score')}</div>
            </div>
            <div class="imap-summary-card">
                <div class="stat-value text-red">${data.summary?.critical || 0}</div>
                <div class="stat-label">${t('stat_threats')}</div>
            </div>
            <div class="imap-summary-card">
                <div class="stat-value text-orange">${data.summary?.warning || 0}</div>
                <div class="stat-label">${t('stat_warnings')}</div>
            </div>
            <div class="imap-summary-card">
                <div class="stat-value text-green">${data.summary?.safe || 0}</div>
                <div class="stat-label">${t('stat_safe')}</div>
            </div>
        </div>

        <!-- AI Görüşleri (IMAP) — 3 sekme: Derinlemesine / OpenAI / Claude
             Link Tarama Motoru'nun ÜZERİNDE konumlandırılmıştır (kullanıcı talebi). -->
        <div class="imap-finding-group" style="margin-bottom:16px;padding:0;overflow:hidden;border:1px solid rgba(99,102,241,0.25);border-radius:10px;">
            <div style="display:flex;gap:0;border-bottom:1px solid rgba(99,102,241,0.2);background:rgba(99,102,241,0.06);">
                <button onclick="switchImapAiTab(this,'imapAiTab-deep')"
                    style="flex:1;border:none;background:transparent;padding:9px 4px;font-size:12px;font-weight:600;color:#a5b4fc;cursor:pointer;border-bottom:2px solid #a78bfa;">
                    🔬 Derinlemesine
                </button>
                <button onclick="switchImapAiTab(this,'imapAiTab-openai')"
                    style="flex:1;border:none;background:transparent;padding:9px 4px;font-size:12px;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;">
                    🤖 OpenAI
                </button>
                <button onclick="switchImapAiTab(this,'imapAiTab-claude')"
                    style="flex:1;border:none;background:transparent;padding:9px 4px;font-size:12px;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;">
                    🧠 Claude
                </button>
            </div>
            <div id="imapAiTab-deep"   style="padding:10px"></div>
            <div id="imapAiTab-openai" style="padding:10px;display:none">${renderImapAiSection(data.openaiAnalysis, data.openaiError)}</div>
            <div id="imapAiTab-claude" style="padding:10px;display:none">${renderImapClaudeSection(data.claudeAnalysis)}</div>
        </div>

        ${renderImapAbuseSection(data)}

        ${renderImapThreatTypesSection(data)}

        ${renderImapAttachmentSection(data)}

        <div class="imap-finding-groups">
            ${groups.map((group) => `
                <div class="imap-finding-group">
                    <div class="imap-group-title">
                        <span>${esc(group.label)}</span>
                        <span class="text-muted">${group.items.length}</span>
                    </div>
                    <div class="findings-list">
                        ${group.items.map((finding, findingIdx) => {
                            const fpButtonId = `imap-fp-${group.category}-${findingIdx}`;
                            return `
                            <div class="finding-item compact" class="u-row-10">
                                <div class="finding-icon ${finding.severity}">${findingIcon(finding.severity)}</div>
                                <div class="u-flex1-0">
                                    <div class="finding-text">${esc(finding.message)}</div>
                                    <div class="finding-category">${esc(formatCategory(finding.category))}</div>
                                </div>
                                ${renderFindingFpButton(finding, `imap-${group.category}-${findingIdx}`, fpButtonId)}
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // IMAP AI sekmeleri: Deep AI butonunu/sonucunu imapAiTab-deep içine render et
    renderDeepAiPanel(data, 'imapAiTab-deep');
    // IMAP: hangi AI sekmesi aktif olacak?
    const _imapInitTab = data?.deepAiAnalysis ? 'imapAiTab-deep'
        : (data?.openaiAnalysis ? 'imapAiTab-openai'
        : (data?.claudeAnalysis ? 'imapAiTab-claude' : 'imapAiTab-deep'));
    document.querySelectorAll('.imap-finding-group button[onclick^="switchImapAiTab"]').forEach((btn, i) => {
        const targetId = ['imapAiTab-deep','imapAiTab-openai','imapAiTab-claude'][i];
        btn.style.color = targetId === _imapInitTab ? '#a5b4fc' : 'var(--text-secondary)';
        btn.style.borderBottomColor = targetId === _imapInitTab ? '#a78bfa' : 'transparent';
    });
    ['imapAiTab-deep','imapAiTab-openai','imapAiTab-claude'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === _imapInitTab ? '' : 'none';
    });

    // Mobilde rapor görünür olduğunda mail listesini sakla (CSS data attribute ile)
    document.body.setAttribute('data-imap-mode', 'report');
}

// IMAP raporu içindeki AI sekme geçişi
window.switchImapAiTab = function(btn, targetId) {
    const container = btn.closest('.imap-finding-group');
    if (!container) return;
    // Buton stilleri
    container.querySelectorAll('button[onclick^="switchImapAiTab"]').forEach(b => {
        b.style.color = '#888';
        b.style.borderBottomColor = 'transparent';
    });
    btn.style.color = '#a5b4fc';
    btn.style.borderBottomColor = '#a78bfa';
    // Panel görünürlüğü
    ['imapAiTab-deep','imapAiTab-openai','imapAiTab-claude'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === targetId ? '' : 'none';
    });
};

// Mobilde "← Mail Listesine Dön" butonu için
window.imapMobileBackToList = function() {
    document.body.removeAttribute('data-imap-mode');
};

// 🔄 Yeniden Tara — mevcut IMAP mailini cache atlayarak yeniden tarar
// Eski cache silinir, yeni tarama yapılır, sonuç kaydedilir ve gösterilir.
window.reScanCurrentImapMail = function() {
    if (!currentImapEmail || !currentImapUid) {
        alert(_tLit('Yeniden taranacak mail seçili değil.', 'No selected mail to re-scan.'));
        return;
    }
    // forceRefresh=true → openImapMail eski cache'i siler, sunucudan yeni tarama yapar
    openImapMail(currentImapUid, currentImapEmail, true);
};

// ─── Link Tarama Motoru Sonuçları (abuse.ch URLhaus + OpenPhish) ──────────
// X / Y sayacı: Y = maildeki toplam link sayısı, X = tehdit eşleşmesi (kırmızı)
// 'Linkleri Göster' butonu — modal'da tüm linkleri listeler, sorunlular kırmızı
function renderImapAbuseSection(data) {
    const status   = data?.abuseStatus  || {};
    const matches  = data?.abuseData?.matches || [];

    // Linkleri 3 kaynaktan da topla (geriye uyumluluk: eski scan'ler allLinks
    // alanı yok, sadece findings içinde URL'ler yer alıyor olabilir):
    //   1) data.allLinks                              (yeni backend)
    //   2) data.findings içinde URL geçen mesajlar    (regex çıkarımı)
    //   3) abuseData.matches'taki tehditler           (en azından bunlar olsun)
    function _collectLinks() {
        const set = new Set();
        if (Array.isArray(data?.allLinks)) data.allLinks.forEach(u => set.add(u));
        const urlRx = /https?:\/\/[^\s<>"'`]+/gi;
        for (const f of (data?.findings || [])) {
            const m = String(f.message || '').match(urlRx);
            if (m) m.forEach(u => set.add(u.replace(/[.,;:!?\)]+$/, '')));
        }
        for (const m of matches) {
            if (m.type === 'url' && m.value) set.add(m.value);
        }
        return Array.from(set);
    }
    const allLinks = _collectLinks();
    const totalLinks = allLinks.length || (data?.breakdown?.linkCount || 0);
    const threatCount = matches.length;

    // Tehditli URL/domain set'i — frontend hızlı eşleştirme için
    const threatUrls    = new Set(matches.filter(m => m.type === 'url').map(m => m.value));
    const threatDomains = new Set(matches.filter(m => m.type === 'domain').map(m => m.value));

    function _isLinkThreat(url) {
        if (threatUrls.has(url)) return true;
        try {
            const host = new URL(url).hostname.toLowerCase();
            return threatDomains.has(host);
        } catch { return false; }
    }

    // X / Y sayacı (sorun varsa kırmızı, yoksa yeşil/gri)
    let counterBadge;
    if (totalLinks === 0) {
        counterBadge = `<span class="text-muted" class="u-xs">0 link</span>`;
    } else if (threatCount === 0 && status.available) {
        counterBadge = `<span style="font-size:11px;color:#34d399;font-weight:600">0/${totalLinks} ✅</span>`;
    } else if (threatCount === 0 && !status.available) {
        counterBadge = `<span style="font-size:11px;color:#fbbf24">⚠️ ${totalLinks} link · feed kullanılamıyor</span>`;
    } else {
        counterBadge = `<span style="font-size:13px;color:#f87171;font-weight:800;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.35);padding:2px 8px;border-radius:4px">${threatCount}/${totalLinks} ⚠️</span>`;
    }

    const showButton = totalLinks > 0
        ? `<button class="btn btn-ghost btn-sm" onclick='openLinkListModal(${JSON.stringify({ scanId: data?.id || null })})' style="font-size:11px;padding:3px 10px">🔍 Linkleri Göster</button>`
        : '';

    const source = status.source || 'URLhaus + OpenPhish';

    // Ana içerik — eşleşme yoksa kısa özet, varsa eşleşme listesi
    const body = matches.length === 0
        ? `<div style="font-size:12px;color:var(--text-secondary);padding:8px 4px">
              ${totalLinks === 0
                ? 'Bu mailde taranacak bağlantı bulunmuyor.'
                : (status.available
                    ? `✅ ${totalLinks} bağlantının hiçbiri bilinen tehdit veritabanlarında bulunamadı.`
                    : '⚠️ Tehdit besleme önbelleği henüz hazır değil — kontroller atlandı.')}
           </div>`
        : matches.map(m => {
            const typeLabel = m.type === 'url' ? 'URL' : 'Domain';
            const val = String(m.value || '');
            const display = val.length > 90 ? val.slice(0, 87) + '…' : val;
            return `
              <div class="finding-item compact" class="u-row-10">
                <div class="finding-icon critical">!!</div>
                <div class="u-flex1-0">
                    <div class="finding-text"><strong>${esc(typeLabel)}:</strong> <code style="word-break:break-all;color:#f87171">${esc(display)}</code></div>
                    <div class="finding-category">${esc(m.source || source)}</div>
                </div>
              </div>`;
        }).join('');

    // Verileri sonraki modal açılışı için window'a koy (basit IPC)
    window.__msaLastScanLinks = {
        all:    allLinks,
        threats: matches,
        isThreatFn: _isLinkThreat,
        source: source,
        feedAvailable: !!status.available
    };

    return `
        <div class="imap-finding-group" class="u-mb16">
            <div class="imap-group-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <span style="flex:1;min-width:160px">🔗 Link Tarama Motoru Sonuçları</span>
                ${counterBadge}
                ${showButton}
            </div>
            <div style="padding:0 4px 6px;font-size:11px;color:var(--text-secondary)">
                Tehdit feed kaynağı: <strong>${esc(source)}</strong>
            </div>
            <div class="findings-list">
                ${body}
            </div>
        </div>
    `;
}

// ─── Link liste modali ─────────────────────────────────────────────────────
// renderImapAbuseSection tüm linkleri window.__msaLastScanLinks'e yazar;
// buton tıklayınca burası popup modal açıp listeyi gösterir. Tehditli olan
// linkler kırmızı, temizler nötr.
function openLinkListModal() {
    const payload = window.__msaLastScanLinks;
    if (!payload || !payload.all?.length) {
        alert('Listelenecek bağlantı yok.');
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = '__msaLinkListOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,14,23,0.85);display:flex;align-items:center;justify-content:center;padding:24px';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const all = payload.all || [];
    const threatCount = all.filter(u => payload.isThreatFn(u)).length;

    const rows = all.map((url, idx) => {
        const isThreat = payload.isThreatFn(url);
        let host = '';
        try { host = new URL(url).hostname; } catch { host = '—'; }
        const display = url.length > 110 ? url.slice(0, 107) + '…' : url;
        return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.06);${isThreat ? 'background:rgba(248,113,113,0.08)' : ''}">
                <td style="padding:6px 8px;color:var(--text-secondary);font-size:11px;text-align:right;width:40px">${idx + 1}</td>
                <td style="padding:6px 8px;width:90px">
                    ${isThreat
                        ? '<span style="color:#f87171;font-weight:700;font-size:11px">⚠️ TEHDİT</span>'
                        : '<span style="color:#34d399;font-size:11px">✓ temiz</span>'}
                </td>
                <td style="padding:6px 8px;color:#94a3b8;font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(host)}">${esc(host)}</td>
                <td style="padding:6px 8px;font-size:11px;word-break:break-all;${isThreat ? 'color:#f87171;font-weight:600' : 'color:#cbd5e1'}">
                    <a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow"
                       style="text-decoration:none;${isThreat ? 'color:#f87171' : 'color:#60a5fa'}"
                       title="Yeni sekmede aç (DİKKAT: tehditli olabilir)">
                        ${esc(display)}
                    </a>
                </td>
            </tr>`;
    }).join('');

    overlay.innerHTML = `
        <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px 20px;width:min(900px,96vw);max-height:88vh;overflow:hidden;display:flex;flex-direction:column">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;flex-wrap:wrap">
                <div>
                    <div style="font-size:16px;font-weight:700;color:#f1f5f9">🔗 Maildeki Bağlantılar</div>
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">
                        ${threatCount > 0
                            ? `<span class="u-err-b">${threatCount}/${all.length} tehdit tespit edildi</span>`
                            : `<span class="u-ok2">${all.length} bağlantı, hepsi temiz</span>`}
                        · Feed: ${esc(payload.source || 'URLhaus + OpenPhish')}
                    </div>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn btn-ghost btn-sm" onclick="(function(){const o=document.getElementById('__msaLinkListOverlay');if(o)o.remove();})()">✕ Kapat</button>
                </div>
            </div>
            <div style="overflow-y:auto;flex:1;border:1px solid rgba(255,255,255,0.06);border-radius:8px">
                <table style="width:100%;border-collapse:collapse;font-family:'SF Mono',Consolas,monospace">
                    <thead style="position:sticky;top:0;background:#1e293b;z-index:1">
                        <tr style="text-align:left;font-size:11px;color:#94a3b8">
                            <th style="padding:8px;text-align:right">#</th>
                            <th style="padding:8px">Durum</th>
                            <th style="padding:8px">Domain</th>
                            <th style="padding:8px">URL</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:10px">
                ⚠️ <strong>Uyarı:</strong> Linklere tıklamadan önce dikkatli olun; tehditli olarak işaretli olanlar zararlı içerik barındırabilir.
                Tarayıcı tıklamayı yeni sekmede açar.
            </div>
        </div>`;

    document.body.appendChild(overlay);

    // ESC ile kapat
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}
window.openLinkListModal = openLinkListModal;

// ─── Tespit Edilen Tehdit Tipleri (virusTotal kategorisi) ─────────────────
// renderImapReport içinde Link Tarama Motoru'nun HEMEN ALTINDA gösterilir.
// data.findings içindeki category='virusTotal' bulguları + virusTotal scan
// sonuçları (motor sayıları) birleşik şekilde tek panelde sunulur.
function renderImapThreatTypesSection(data) {
    const findings = (data?.findings || []).filter(f => f.category === 'virusTotal');
    const vtEntries = Array.isArray(data?.virusTotal) ? data.virusTotal : [];

    // VT entry istatistikleri özeti
    const vtStats = vtEntries.reduce((acc, e) => {
        acc.malicious  += (e.stats?.malicious  || 0);
        acc.suspicious += (e.stats?.suspicious || 0);
        return acc;
    }, { malicious: 0, suspicious: 0 });

    const hasAny = findings.length > 0 || vtEntries.length > 0 || vtStats.malicious > 0 || vtStats.suspicious > 0;

    // Üst rozet
    let badge;
    if (vtStats.malicious > 0) {
        badge = `<span style="font-size:11px;color:#f87171;font-weight:700;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.35);padding:2px 8px;border-radius:4px">${vtStats.malicious} zararlı motor tespiti</span>`;
    } else if (vtStats.suspicious > 0) {
        badge = `<span style="font-size:11px;color:#fbbf24;font-weight:600;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.35);padding:2px 8px;border-radius:4px">${vtStats.suspicious} şüpheli motor tespiti</span>`;
    } else if (findings.length > 0) {
        badge = `<span style="font-size:11px;color:#fbbf24;font-weight:600">${findings.length} bulgu</span>`;
    } else {
        badge = `<span style="font-size:11px;color:#34d399">✅ Tehdit tipi tespit edilmedi</span>`;
    }

    // Eğer hiçbir bulgu yoksa kısa "temiz" mesajı, varsa findings listesi
    const findingsHtml = findings.length === 0
        ? ''
        : findings.map(f => `
            <div class="finding-item compact" class="u-row-10">
                <div class="finding-icon ${esc(f.severity)}">${findingIcon(f.severity)}</div>
                <div class="u-flex1-0">
                    <div class="finding-text">${esc(f.message)}</div>
                </div>
            </div>
        `).join('');

    // VT entry'leri (dosya bazlı motor sonuçları)
    const vtHtml = vtEntries.length === 0
        ? ''
        : vtEntries.map(e => {
            const stats = e.stats || {};
            const mal = stats.malicious || 0;
            const sus = stats.suspicious || 0;
            const tot = stats.total || (mal + sus + (stats.harmless || 0) + (stats.undetected || 0));
            const isClean = mal === 0 && sus === 0;
            const summary = isClean
                ? `<span class="u-ok2">✅ Temiz</span> — ${tot} motor taradı`
                : `<span class="u-err-b">⚠️ ${mal} zararlı</span> · ${sus} şüpheli · toplam ${tot} motor`;
            return `
                <div class="finding-item compact" class="u-row-10">
                    <div class="finding-icon ${isClean ? 'safe' : 'critical'}">${isClean ? 'OK' : '!!'}</div>
                    <div class="u-flex1-0">
                        <div class="finding-text"><strong>${esc(e.filename || 'ek')}</strong></div>
                        <div class="finding-text">${summary}</div>
                        ${e.maliciousEngines?.length
                            ? `<div class="finding-category" style="color:#fca5a5;margin-top:4px">Zararlı bulan motorlar: ${e.maliciousEngines.slice(0,5).map(m => esc(m.engine)).join(', ')}${e.maliciousEngines.length>5?`, … +${e.maliciousEngines.length-5}`:''}</div>`
                            : ''}
                    </div>
                </div>
            `;
        }).join('');

    const body = hasAny
        ? (findingsHtml + vtHtml)
        : `<div style="font-size:12px;color:var(--text-secondary);padding:8px 4px">
              ✅ Bu mailde tespit edilen tehdit tipi yok. Belirgin antivirüs/itibar uyarısı bulunmadı.
           </div>`;

    return `
        <div class="imap-finding-group" class="u-mb16">
            <div class="imap-group-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <span style="flex:1;min-width:160px">🔍 Tespit Edilen Tehdit Tipleri</span>
                ${badge}
            </div>
            <div class="findings-list">
                ${body}
            </div>
        </div>
    `;
}

function renderImapAttachmentSection(data) {
    const rows = mergeAttachmentScanData(data);
    if (!rows.length) return '';

    return `
        <div class="imap-finding-group" class="u-mb16">
            <div class="imap-group-title">
                <span>Ek Dosya Tarama Detayları</span>
                <span class="text-muted">${rows.length}</span>
            </div>
            <div class="findings-list">
                ${rows.map((row) => `
                    <div class="finding-item compact" style="align-items:flex-start;">
                        <div class="finding-icon ${row.severity}">${row.severity === 'critical' ? '!!' : row.severity === 'warning' ? '!' : 'OK'}</div>
                        <div>
                            <div class="finding-text"><strong>${esc(row.filename)}</strong></div>
                            <div class="finding-category">${esc(row.contentType || 'bilinmeyen tür')} - ${esc(formatBytes(row.size || 0))}</div>
                            ${row.issues?.length ? `<div class="finding-text">Yerel kontroller: ${row.issues.map((issue) => esc(issue)).join(', ')}</div>` : ''}
                            ${renderArchiveEntries(row)}
                            ${renderAttachmentVirusTotal(row.vt, resolveAttachmentVtStatus(row, data.vtStatus))}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderImapAiSection(analysis, error) {
    // Başlık satırı — her zaman göster
    const headerHtml = `
        <div class="imap-group-title" style="border-bottom:1px solid rgba(99,102,241,0.2);padding-bottom:8px;margin-bottom:10px;">
            <span style="display:flex;align-items:center;gap:8px;">
                🤖 <strong>ChatGPT AI Değerlendirmesi</strong>
                ${analysis ? `<span style="font-size:10px;font-weight:400;color:#a5b4fc;
                    background:rgba(99,102,241,0.15);border-radius:10px;
                    padding:1px 7px;">${esc(analysis._model || 'gpt-4o-mini')}</span>` : ''}
            </span>
            ${analysis ? `<span class="text-muted">Güven: %${esc(String(analysis.confidence || 0))}</span>` : ''}
        </div>`;

    // API anahtarı yok veya analiz çalıştırılmadı
    if (!analysis) {
        const msg = error
            ? `⚠️ AI analizi başarısız: ${esc(error)}`
            : '🔑 OpenAI API anahtarı yapılandırılmamış — Ayarlar\'dan ekleyin.';
        return `
            <div class="imap-finding-group" style="margin-bottom:16px;border:1px solid rgba(99,102,241,0.2);border-radius:8px;padding:12px;">
                ${headerHtml}
                <div style="color:var(--text-secondary);font-size:13px;padding:4px 0;">${msg}</div>
            </div>`;
    }

    const modelName  = analysis._model || 'gpt-4o-mini';
    const summary    = _tLit(analysis.summaryTR, analysis.summaryEN);
    const narrative  = _tLit(analysis.attackNarrativeTR, analysis.attackNarrativeEN);
    const sev        = severityFromThreatLevel(analysis.threatLevel);

    return `
        <div class="imap-finding-group" style="margin-bottom:16px;border:1px solid rgba(99,102,241,0.25);border-radius:8px;padding:12px;">
            ${headerHtml}

            <!-- Özet -->
            <div class="finding-item compact" style="margin-bottom:10px;">
                <div class="finding-icon ${sev}">${findingIcon(sev)}</div>
                <div>
                    <div class="finding-category">TEHDİT SEVİYESİ / KATEGORİ</div>
                    <div class="finding-text" style="font-weight:600;text-transform:uppercase;">
                        ${esc(analysis.threatLevel || 'N/A')} — ${esc(analysis.category || 'N/A')}
                    </div>
                </div>
            </div>

            <div style="font-size:13px;line-height:1.6;margin-bottom:10px;color:var(--text-primary);">
                <strong>${esc(summary || '')}</strong>
            </div>

            ${narrative && narrative !== summary ? `
            <div class="finding-item compact" style="margin-bottom:10px;">
                <div>
                    <div class="finding-category">ANALİZ</div>
                    <div class="finding-text">${esc(narrative)}</div>
                </div>
            </div>` : ''}

            <!-- Risk profili -->
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px;font-size:12px;">
                <div><span class="text-muted">Kimlik sahteciliği:</span> ${esc(analysis.impersonationRisk || 'N/A')}</div>
                <div><span class="text-muted">Finansal risk:</span> ${esc(analysis.financialRisk || 'N/A')}</div>
                <div><span class="text-muted">Kimlik bilgisi:</span> ${esc(analysis.credentialRisk || 'N/A')}</div>
                <div><span class="text-muted">Aciliyet:</span> ${esc(analysis.urgencyRisk || 'N/A')}</div>
            </div>

            <div class="finding-category" style="margin-bottom:6px;">
                KÖTÜ NİYET SKORU: <strong style="font-size:16px;">${esc(String(analysis.maliciousIntentScore || 0))}/100</strong>
            </div>

            ${renderAnalysisList(_tLit('Kırmızı Bayraklar', 'Red Flags'), analysis.redFlagsTR)}
            ${renderAnalysisList(_tLit('Sosyal Mühendislik Sinyalleri', 'Social Engineering'), analysis.socialEngineeringSignalsTR)}
            ${renderAnalysisList(_tLit('Önerilen Aksiyonlar', 'Recommended Actions'), analysis.recommendedActionsTR)}
        </div>
    `;
}

function renderImapClaudeSection(analysis) {
    if (!analysis) return '';
    // Claude returns object: { threatLevel, category, summaryTR, summaryEN, suspiciousElements }
    if (Array.isArray(analysis) || (!analysis.summaryTR && !analysis.summaryEN)) return '';
    const sum = _tLit(analysis.summaryTR || analysis.summaryEN || '', analysis.summaryEN || analysis.summaryTR || '');
    return `
        <div class="imap-finding-group" class="u-mb16">
            <div class="imap-group-title">
                <span>🤖 Claude AI (Anthropic)</span>
                <span class="text-muted">${esc(analysis.threatLevel || '')}</span>
            </div>
            <div class="finding-item compact" class="u-mb8">
                <div>
                    <div class="finding-category">ÖZET</div>
                    <div class="finding-text">${esc(sum)}</div>
                </div>
            </div>
            ${analysis.category ? `
            <div class="finding-item compact" class="u-mb8">
                <div>
                    <div class="finding-category">KATEGORİ / TEHDİT SEVİYESİ</div>
                    <div class="finding-text">${esc(analysis.category)} / ${esc(analysis.threatLevel || '-')}</div>
                </div>
            </div>` : ''}
            ${analysis.suspiciousElements?.length ? renderAnalysisList(
                _tLit('Şüpheli Unsurlar', 'Suspicious Elements'),
                analysis.suspiciousElements
            ) : ''}
        </div>
    `;
}

function groupFindingsByCategory(findings) {
    const labels = {
        header:      _tLit('Header Kontrolleri', 'Header Checks'),
        content:     _tLit('Icerik Kontrolleri', 'Content Checks'),
        link:        _tLit('Link Kontrolleri', 'Link Checks'),
        attachment:  _tLit('Ek Kontrolleri', 'Attachment Checks'),
        virusTotal:  _tLit('Tespit Edilen Tehdit Tipleri', 'Detected Threat Types'),
        abuse:       _tLit('Link Tarama Motoru Sonuçları', 'Link Scan Engine Results'),
        general:     _tLit('Genel Kontroller', 'General Checks')
        // 'ai' kategorisi IMAP görünümünde renderImapAiSection tarafından ayrıca gösterilir
    };

    const grouped = new Map();

    findings.forEach((finding) => {
        const category = finding.category || 'general';
        // AI bulgularını atla — ChatGPT kart / renderImapAiSection zaten gösteriyor
        if (category === 'ai') return;
        if (!grouped.has(category)) {
            grouped.set(category, []);
        }
        grouped.get(category).push(finding);
    });

    return Array.from(grouped.entries()).map(([category, items]) => ({
        category,
        label: labels[category] || category,
        items
    }));
}

// ============================================================
// IMAP MONITOR (WEBSOCKET)
// ============================================================
function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Auth: müşteri token'ı varsa onu kullan, yoksa kayıtlı lisans anahtarı.
    // Sunucu en az birini doğrulayamazsa bağlantıyı 1008 ile kapatır.
    const params = new URLSearchParams();
    try {
        const t = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('msa_customer_token')) || '';
        if (t) params.set('token', t);
        const lic = (typeof localStorage !== 'undefined' && localStorage.getItem('msa_license')) || '';
        if (lic) params.set('license', lic);
    } catch { /* sessizce devam */ }
    const qs = params.toString();
    ws = new WebSocket(`${protocol}//${location.host}/${qs ? '?' + qs : ''}`);

    ws.onopen = () => updateMonitorButton();

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'monitor-status') {
            activeMonitorEmails = new Set(msg.emails || []);
            updateMonitorButton();
            loadImapAccounts();
            if (currentMode === 'scan-mailbox') loadScanMailboxes();
        }

        if (msg.type === 'new-email-scanned') {
            showNotification(msg.result);
            loadHistory();
        }

        if (msg.type === 'monitor-started') {
            activeMonitorEmails.add(msg.email);
            updateMonitorButton();
            loadImapAccounts();
            if (currentMode === 'scan-mailbox') loadScanMailboxes();
            alert(
                (_tLit('Otomatik izleme baslatildi: ', 'Automatic monitoring started: '))
                + msg.email
            );
        }

        if (msg.type === 'monitor-stopped') {
            activeMonitorEmails.delete(msg.email);
            updateMonitorButton();
            loadImapAccounts();
            if (currentMode === 'scan-mailbox') loadScanMailboxes();
            alert(
                (_tLit('Otomatik izleme durduruldu: ', 'Automatic monitoring stopped: '))
                + msg.email
            );
        }

        if (msg.type === 'error') {
            alert(msg.message || 'WebSocket error');
        }
    };

    ws.onclose = () => {
        updateMonitorButton();
        setTimeout(connectWebSocket, 5000);
    };
}

function startMonitor() {
    if (_denyIfCustomerUser('Otomatik İzle')) return;
    fetch('/api/imap/accounts')
        .then((res) => res.json())
        .then((accounts) => {
            if (!accounts.length) {
                alert(_tLit('Kayitli IMAP hesabi yok', 'No IMAP account'));
                return;
            }

            if (!ws || ws.readyState !== WebSocket.OPEN) {
                alert(_tLit('WebSocket baglantisi hazir degil', 'WebSocket connection is not ready yet'));
                return;
            }

            const targetEmail = currentImapEmail || accounts[0]?.email;
            if (!targetEmail) {
                alert(_tLit('Once bir hesap secin', 'Select an account first'));
                return;
            }

            if (activeMonitorEmails.has(targetEmail)) {
                ws.send(JSON.stringify({ type: 'stop-monitor', email: targetEmail }));
                return;
            }

            ws.send(JSON.stringify({ type: 'start-monitor', email: targetEmail, licenseKey }));
        });
}

function updateMonitorButton() {
    const button = document.getElementById('btnMonitor');
    if (!button) return;

    const socketReady = ws && ws.readyState === WebSocket.OPEN;
    const targetEmail = currentImapEmail || '';
    const isActive = !!targetEmail && activeMonitorEmails.has(targetEmail);
    const activeCount = activeMonitorEmails.size;

    button.disabled = !targetEmail || !socketReady;
    button.classList.toggle('btn-primary', isActive);
    button.classList.toggle('btn-ghost', !isActive);

    const label = isActive
        ? (_tLit('Izlemeyi Durdur', 'Stop Monitoring'))
        : (_tLit('Otomatik Izle', 'Auto Monitor'));

    button.innerHTML = `${label}${targetEmail ? ` (${esc(targetEmail)})` : ''}${activeCount ? ` [${activeCount}]` : ''}`;
    updateMonitorIndicators();
}

function updateMonitorIndicators() {
    const topDot = document.getElementById('statusDot');
    const accountRows = document.querySelectorAll('.imap-account-row');

    if (topDot) {
        if (!accountRows.length) {
            topDot.className = 'status-dot disconnected';
        } else if (activeMonitorEmails.size > 0) {
            topDot.className = 'status-dot monitoring';
        } else {
            topDot.className = 'status-dot connected';
        }
    }

    accountRows.forEach((row) => {
        const isMonitoring = activeMonitorEmails.has(row.dataset.accountEmail);
        const dot = row.querySelector('.status-dot');
        row.classList.toggle('monitoring', isMonitoring);
        if (dot) {
            dot.classList.remove('connected', 'monitoring', 'disconnected');
            dot.classList.add(isMonitoring ? 'monitoring' : 'connected');
        }
    });
}

function showNotification(result) {
    const notification = document.createElement('div');
    notification.className = `risk-banner ${result.level}`;
    notification.style.cssText = 'position:fixed;top:80px;right:24px;z-index:300;max-width:400px;animation:slideDown 0.5s ease;cursor:pointer';
    notification.innerHTML = `
        <div class="risk-score" style="color:${result.color};width:48px;height:48px;font-size:18px">${result.score}</div>
        <div>
            <strong>${esc(result.emailMeta?.subject || 'New Email')}</strong><br>
            <span class="text-muted" class="u-sm">${esc(result.emailMeta?.from?.[0]?.address || '')}</span>
        </div>
    `;
    notification.onclick = () => {
        notification.remove();
        showResults(result);
    };
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 8000);
}

function showImapBackgroundScanNotification(result, message) {
    const notification = document.createElement('div');
    notification.className = `risk-banner ${result.level}`;
    notification.style.cssText = 'position:fixed;top:80px;right:24px;z-index:300;max-width:420px;animation:slideDown 0.5s ease;cursor:pointer';
    notification.innerHTML = `
        <div class="risk-score" style="color:${result.color};width:48px;height:48px;font-size:18px">${result.score}</div>
        <div>
            <strong>${_tLit('Arka plan taramasi tamamlandi', 'Background scan completed')}</strong><br>
            <span class="text-muted" class="u-sm">${esc(message?.subject || result.emailMeta?.subject || 'Mail')}</span>
        </div>
    `;
    notification.onclick = () => {
        notification.remove();
        currentImapEmail = result.imapEmail || currentImapEmail;
        currentImapUid = result.imapUid || currentImapUid;
        renderImapMessageList();
        currentResult = result;
        renderImapReport(result, currentImapMessages.find((item) => item.uid === result.imapUid));
    };
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 8000);
}

// ============================================================
// LICENSE
// ============================================================
function showLicenseModal() {
    document.getElementById('licenseModal').classList.remove('hidden');
}

function closeLicenseModal() {
    document.getElementById('licenseModal').classList.add('hidden');
}

async function activateLicense() {
    const key = document.getElementById('licenseKeyInput').value.trim();
    // Activate endpoint license-server'a remote activation yapar + sonuc cache'lenir.
    const res = await fetch('/api/customer/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key })
    });
    const payload = await res.json();
    // Yeni endpoint cevabi: { ok, snapshot:{ plan, tier, features, limits, expiresAt, customerId, dealerId } }
    const snap = payload.snapshot || payload;
    const data = snap ? {
        valid: !!payload.ok,
        plan: snap.plan,
        tier: snap.tier,
        features: snap.features || {},
        monthlyLimit: snap.limits?.monthlyScans ?? snap.limits?.monthly ?? null,
        expiryDate: snap.expiresAt,
        tierInfo: snap.tierInfo || {}
    } : {};

    if (res.ok && payload.ok && data.valid) {
        const previousPlan = licenseInfo?.plan;
        licenseKey = key;
        licenseInfo = data;
        localStorage.setItem('msa_license', key);
        updateLicenseBadge(data);
        loadLicenseUsage();
        // Plan düşürme: IMAP ekranındaysa ve yeni lisansta yetki yoksa ana ekrana dön
        if (previousPlan === 'enterprise' && data.plan !== 'enterprise' && currentMode === 'imap') {
            selectMode('upload');
        }
        if (currentMode === 'scan-mailbox' && !data.features?.scanMailbox) {
            selectMode('upload');
        }
        const limitLabel = data.monthlyLimit === Infinity || data.monthlyLimit == null
            ? '∞' : data.monthlyLimit.toLocaleString();
        document.getElementById('licenseResult').innerHTML = `
            <div class="text-green mt-16">
                ${t('license_valid')}<br>
                ${esc(data.plan.toUpperCase())} ${esc(data.tier || '')} — ${esc(data.tierInfo?.label || '')}
                <br>
                ${_tLit('Aylık limit', 'Monthly limit')}: ${limitLabel}
                <br>
                ${_tLit('Son kullanma', 'Expires')}: ${formatDate(data.expiryDate, true)}
                <div style="font-size:11px;margin-top:8px;color:var(--green)">
                    ✓ ${_tLit('Lisans sunucuya kaydedildi — restart ve versiyon geçişlerinde otomatik korunur.', 'License saved on server — preserved across restarts and upgrades.')}
                </div>
            </div>
        `;
    } else {
        const errMsg = payload.error || data.error || '';
        document.getElementById('licenseResult').innerHTML = `
            <div class="text-red mt-16">
                ${errMsg === 'License expired' ? t('license_expired') : t('license_invalid')}<br>
                ${esc(errMsg)}
            </div>
        `;
    }
}

async function validateStoredLicense() {
    let res, raw, data;
    try {
        res = await fetch('/api/customer/license/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey })
        });
        raw = await res.json();
    } catch (e) {
        // Sunucu henüz hazır değil (yeniden başlatılıyor) — sessizce atla
        console.warn('[License] validateStoredLicense network error:', e.message);
        return;
    }
    // license-client.validate() cevabi: { ok, snapshot, expiresAt, ... } veya { error }
    data = raw.ok ? {
        valid: true,
        plan: raw.snapshot?.plan,
        tier: raw.snapshot?.tier,
        features: raw.snapshot?.features || {},
        monthlyLimit: raw.snapshot?.limits?.monthlyScans ?? raw.snapshot?.limits?.monthly ?? null,
        expiryDate: raw.snapshot?.expiresAt
    } : { valid: false, error: raw.error };

    if (data.valid) {
        licenseInfo = data;
        updateLicenseBadge(data);
        loadLicenseUsage();
    } else {
        // Lisans geçersiz/süresi dolmuş — tüm önbelleği temizle ve kısıtlı moddan çık
        const prevInfo = licenseInfo;
        licenseKey = '';
        licenseInfo = null;
        localStorage.removeItem('msa_license');
        // Server'daki kalıcı kaydı da temizle (yeniden yüklenmesin)
        fetch('/api/license/deactivate', { method: 'POST' }).catch(() => {});

        // Badge'i Free'ye döndür
        const badge = document.getElementById('licenseBadge');
        if (badge) {
            badge.className = 'license-badge free';
            badge.textContent = 'Free';
            badge.removeAttribute('title');
            badge.style.removeProperty('border-color');
        }

        // Kısıtlı modlardaysa upload moduna geç
        if ((currentMode === 'imap' || currentMode === 'scan-mailbox') && prevInfo?.plan) {
            selectMode('upload', false);
        }

        // Süresi dolmuş lisans varsa kullanıcıya bildirim göster
        if (data.error === 'License expired' && prevInfo?.plan) {
            showExpiryAlert(0, prevInfo);
        }
    }
}

function updateLicenseBadge(info) {
    const badge = document.getElementById('licenseBadge');
    badge.className = `license-badge ${info.plan}`;
    badge.removeAttribute('title');
    badge.style.removeProperty('border-color');

    const labels = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };
    const tier = info.tier || '';
    let label = tier ? `${labels[info.plan] || 'Free'}-${tier}` : (labels[info.plan] || 'Free');

    // Sona erme uyarısı
    const daysLeft = info.daysLeft ?? (info.expiryDate
        ? Math.ceil((new Date(info.expiryDate) - Date.now()) / 86400000) : null);
    if (daysLeft !== null) {
        if (daysLeft <= 0) {
            label += ' ❌';
            badge.style.borderColor = '#ef4444';
            badge.title = 'Lisans süresi dolmuş!';
        } else if (daysLeft <= 3) {
            label += ` ⚠️${daysLeft}g`;
            badge.style.borderColor = '#ef4444';
            badge.title = `Lisans ${daysLeft} gün içinde sona eriyor!`;
            showExpiryAlert(daysLeft, info);
        } else if (daysLeft <= 7) {
            label += ` ⚠️${daysLeft}g`;
            badge.style.borderColor = '#f59e0b';
            badge.title = `Lisans ${daysLeft} gün içinde sona eriyor.`;
            showExpiryAlert(daysLeft, info);
        }
    }

    badge.textContent = label;
}

let _expiryAlertShown = false;
function showExpiryAlert(daysLeft, info) {
    if (_expiryAlertShown) return;
    _expiryAlertShown = true;

    const expired = daysLeft <= 0;
    const borderColor = expired ? '#ef4444' : (daysLeft <= 3 ? '#ef4444' : '#f59e0b');
    const notif = document.createElement('div');
    notif.style.cssText = `position:fixed;top:80px;right:24px;z-index:400;max-width:360px;background:#1e293b;border:1px solid ${borderColor};border-radius:10px;padding:14px 18px;color:${expired ? '#fca5a5' : '#fde68a'};font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,.5);cursor:pointer`;
    notif.innerHTML = expired
        ? `<div style="font-weight:700;margin-bottom:4px">❌ Lisans Süresi Doldu</div>
<div>${(info.plan || '').toUpperCase()} ${info.tier || ''} lisansınızın süresi dolmuş. Lütfen yenileyiniz.</div>
<div style="font-size:11px;margin-top:6px;opacity:.7">Kapatmak için tıklayın</div>`
        : `<div style="font-weight:700;margin-bottom:4px">⚠️ Lisans Süresi Uyarısı</div>
<div>${(info.plan || '').toUpperCase()} ${info.tier || ''} lisansınızın sona ermesine <strong>${daysLeft} gün</strong> kaldı.</div>
<div style="font-size:11px;margin-top:6px;opacity:.7">Kapatmak için tıklayın</div>`;
    notif.onclick = () => notif.remove();
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), expired ? 30000 : 12000);
}

// ============================================================
// SETTINGS
// ============================================================
let _settingsEscHandler = null;

function showSettings() {
    document.getElementById('settingsModal').classList.remove('hidden');
    showSettingsTab('api');
    loadSettingsStatus();
    loadPeriodicReportSettings();
    loadServiceStatus();
    loadUserTdCount();
    loadWebhookSettings();

    // ESC ile kapat
    if (_settingsEscHandler) document.removeEventListener('keydown', _settingsEscHandler);
    _settingsEscHandler = (e) => { if (e.key === 'Escape') closeSettings(); };
    document.addEventListener('keydown', _settingsEscHandler);
}

function showSettingsTab(tab) {
    document.querySelectorAll('[data-settings-tab]').forEach((panel) => {
        panel.style.display = panel.dataset.settingsTab === tab ? '' : 'none';
    });
    document.querySelectorAll('[data-settings-tab-btn]').forEach((button) => {
        const active = button.dataset.settingsTabBtn === tab;
        button.style.background = active ? 'rgba(99,102,241,0.18)' : 'transparent';
        button.style.borderColor = active ? 'rgba(99,102,241,0.55)' : 'rgba(255,255,255,0.1)';
        button.style.color = active ? 'var(--text-primary)' : 'var(--text-secondary)';
    });
    // Sistem sekmesi açıldığında disk bilgisini otomatik yükle
    if (tab === 'system' && getCustomerRole() !== 'user') {
        loadDiskUsage();
    }
    if (tab === 'system-smtp') {
        loadSystemSmtp();
    }
}

// ─── Disk Kullanımı & Tarama Geçmişi Silme ───────────────────────────────
function _fmtBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

async function loadDiskUsage() {
    const box = document.getElementById('diskUsageInfo');
    if (!box) return;
    box.innerHTML = '<span class="text-muted">⏳ Disk bilgisi yükleniyor…</span>';
    try {
        const r = await fetch('/api/stats/disk-usage');
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            box.innerHTML = `<span class="u-err">Yüklenemedi: ${esc(err.error || r.status)}</span>`;
            return;
        }
        const d = await r.json();

        // Disk doluluk yüzdesi varsa görsel bar
        const usedPct = d.usedPercent;
        const barHtml = usedPct != null
            ? `<div class="u-mt8">
                  <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">
                      Disk Doluluk: <strong style="color:${usedPct > 85 ? '#f87171' : usedPct > 70 ? '#fbbf24' : '#34d399'}">${usedPct}%</strong>
                      <span style="opacity:.7;margin-left:6px">(${_fmtBytes(d.totalBytes - (d.freeBytes||0))} / ${_fmtBytes(d.totalBytes)})</span>
                  </div>
                  <div style="background:rgba(255,255,255,0.06);height:6px;border-radius:3px;overflow:hidden">
                      <div style="width:${Math.min(usedPct, 100)}%;height:100%;background:${usedPct > 85 ? '#f87171' : usedPct > 70 ? '#fbbf24' : '#34d399'}"></div>
                  </div>
               </div>`
            : '<div style="margin-top:8px;font-size:11px;color:var(--text-secondary)">⚠️ Sistemde disk doluluk bilgisi alınamadı (Node 19+ gerekir)</div>';

        box.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
                <div>
                    <div class="u-xs-m">📦 Uygulama Verisi</div>
                    <div style="font-size:16px;font-weight:700;color:#cbd5e1">${esc(_fmtBytes(d.dataDir))}</div>
                </div>
                <div>
                    <div class="u-xs-m">🗄️ Local Data Store</div>
                    <div style="font-size:16px;font-weight:700;color:#cbd5e1">${esc(_fmtBytes(d.dbFile))}</div>
                </div>
                <div>
                    <div class="u-xs-m">📋 Tarama Kaydı</div>
                    <div style="font-size:16px;font-weight:700;color:#cbd5e1">${(d.historyCount || 0).toLocaleString('tr-TR')}</div>
                </div>
            </div>
            ${barHtml}
        `;
    } catch (e) {
        box.innerHTML = `<span class="u-err">Hata: ${esc(e.message)}</span>`;
    }
}
window.loadDiskUsage = loadDiskUsage;

async function deleteScanHistoryByRange() {
    const fromEl = document.getElementById('histDelFrom');
    const toEl   = document.getElementById('histDelTo');
    const status = document.getElementById('histDelStatus');
    const from = fromEl?.value || '';
    const to   = toEl?.value   || '';

    status.textContent = '';

    if (!from || !to) {
        status.innerHTML = '<span class="u-err">Başlangıç ve bitiş tarihi seçin</span>';
        return;
    }
    if (from > to) {
        status.innerHTML = '<span class="u-err">Başlangıç bitişten büyük olamaz</span>';
        return;
    }
    const ok = await showConfirm({
        title: 'Tarama Geçmişini Sil',
        message: `${from} → ${to} aralığındaki TÜM tarama kayıtları kalıcı olarak silinecek.\n\nDevam edilsin mi?`,
        confirmText: 'Sil', cancelText: 'Vazgeç', danger: true
    });
    if (!ok) return;

    status.innerHTML = '⏳ Siliniyor…';
    try {
        const r = await fetch(`/api/scan-history/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
            method: 'DELETE'
        });
        const data = await r.json();
        if (!r.ok) {
            status.innerHTML = `<span class="u-err">${esc(data.error || 'Hata')}</span>`;
            return;
        }
        status.innerHTML = `<span class="u-ok2">✅ ${data.deleted} kayıt silindi (kalan: ${data.after.toLocaleString('tr-TR')})</span>`;
        loadDiskUsage();           // disk bilgisini yenile
        if (typeof loadHistory === 'function') loadHistory();
    } catch (e) {
        status.innerHTML = `<span class="u-err">Bağlantı hatası: ${esc(e.message)}</span>`;
    }
}
window.deleteScanHistoryByRange = deleteScanHistoryByRange;

function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
    // ESC dinleyiciyi temizle
    if (_settingsEscHandler) {
        document.removeEventListener('keydown', _settingsEscHandler);
        _settingsEscHandler = null;
    }
}

// NOT: Eski "Admin Şifresi" alanı ve OTP-tabanlı sıfırlama paneli müşteri
// ayarlarından kaldırıldı. Yeni rol modelinde:
//   - Müşteri admin şifresi → /keygen.html'deki sistem admin'inden bağımsız
//   - Müşteri kullanıcı şifresi → 👥 Müşteri Kullanıcıları modal'ından sıfırlanır
//   - Sistem admin (keygen.html) şifresi → keygen.html üzerinden yönetilir

async function readApiJsonOrThrow(res, fallbackMessage) {
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || data.success === false) {
        const message = data.error || fallbackMessage || 'Kayit basarisiz';
        const statusEl = document.getElementById('settingsStatus');
        if (statusEl) statusEl.innerHTML = `<span class="u-err-b">Kaydedilemedi: ${esc(message)}</span>`;
        throw new Error(message);
    }
    return data;
}

function settingsAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (licenseKey) headers['x-license-key'] = licenseKey;
    return headers;
}

async function saveSettings() {
    const statusEl = document.getElementById('settingsStatus');
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-secondary)">Kaydediliyor...</span>';

    const vtKey     = document.getElementById('vtApiKeyInput').value.trim();
    const otxKey    = document.getElementById('otxApiKeyInput')?.value.trim() || '';
    const claudeKey = document.getElementById('claudeApiKeyInput').value.trim();
    const openaiKey = document.getElementById('openaiApiKeyInput').value.trim();
    const companyProfile = {
        name:        document.getElementById('companyNameInput')?.value.trim() || '',
        details:     document.getElementById('companyDetailsInput')?.value.trim() || '',
        contactInfo: document.getElementById('companyContactInfoInput')?.value.trim() || ''
    };
    const reportSettings = {
        daily:   document.getElementById('periodicDaily')?.checked !== false,
        weekly:  document.getElementById('periodicWeekly')?.checked !== false,
        monthly: document.getElementById('periodicMonthly')?.checked !== false
    };

    // OpenAI model: "__custom__" seçiliyse text box'tan al, yoksa select değerini kullan
    const modelSel   = document.getElementById('openaiModelSelect');
    const modelInp   = document.getElementById('openaiModelCustom');
    const openaiModel = (modelSel?.value === '__custom__')
        ? (modelInp?.value.trim() || '')
        : (modelSel?.value || '');

    const riskMode = document.getElementById('riskModeSelect')?.value || 'classic';

    const payload = {
        vtApiKey: vtKey, claudeApiKey: claudeKey, openaiApiKey: openaiKey,
        otxApiKey: otxKey,
        openaiModel,
        companyProfile,
        riskMode
    };

    const keysRes = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: settingsAuthHeaders(),
        body: JSON.stringify(payload)
    });
    await readApiJsonOrThrow(keysRes, 'Ayar anahtarlari kaydedilemedi');

    if (!keysRes.ok) {
        const statusEl = document.getElementById('settingsStatus');
        if (statusEl) {
            statusEl.innerHTML = '<span class="u-err-b">⛔ Yetki reddedildi. Lütfen tekrar giriş yapın.</span>';
            setTimeout(() => { statusEl.textContent = ''; }, 3000);
        }
        return;
    }

    const reportRes = await fetch('/api/reports/settings', {
        method: 'POST',
        headers: settingsAuthHeaders(),
        body: JSON.stringify(reportSettings)
    });
    await readApiJsonOrThrow(reportRes, 'Periyodik rapor ayarlari kaydedilemedi');

    await saveWebhookSettings({ throwOnError: true, silent: true });

    await loadSettingsStatus();
    await loadPeriodicReportSettings();
    await loadWebhookSettings();
    // Başarı bildirimi göster, sonra kapat
    if (statusEl) {
        const prev = statusEl.innerHTML;
        statusEl.innerHTML = '<span style="color:var(--green,#00e676);font-weight:600">✅ Ayarlar başarıyla kaydedildi.</span>';
        setTimeout(() => { statusEl.innerHTML = prev; closeSettings(); }, 1400);
    } else {
        closeSettings();
    }
}

// Select ile custom input senkronizasyonu — "__custom__" seçilince text box aç
function syncOpenaiModelInput() {
    const sel = document.getElementById('openaiModelSelect');
    const inp = document.getElementById('openaiModelCustom');
    if (!sel || !inp) return;
    if (sel.value === '__custom__') {
        inp.style.display = '';
        inp.focus();
    } else {
        inp.style.display = 'none';
        inp.value = '';
    }
}

async function loadSettingsStatus() {
    try {
        const res = await fetch('/api/settings/status');
        const status = await res.json();
        const statusEl = document.getElementById('settingsStatus');
        if (!statusEl) return;
        const profile = status.companyProfile || {};
        const companyNameEl = document.getElementById('companyNameInput');
        const companyDetailsEl = document.getElementById('companyDetailsInput');
        const companyContactEl = document.getElementById('companyContactInfoInput');
        if (companyNameEl) companyNameEl.value = profile.name || '';
        if (companyDetailsEl) companyDetailsEl.value = profile.details || '';
        if (companyContactEl) companyContactEl.value = profile.contactInfo || '';

        // API key alanlarını her zaman boş bırak; placeholder mevcut durumu göster
        const setKeyPlaceholder = (id, configured) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = '';
            el.placeholder = configured
                ? '••••••• (kayıtlı, değiştirmek için yeni değer girin)'
                : el.dataset.defaultPlaceholder || el.placeholder;
            if (!el.dataset.defaultPlaceholder) el.dataset.defaultPlaceholder = el.placeholder;
        };
        setKeyPlaceholder('vtApiKeyInput', status.vtConfigured);
        setKeyPlaceholder('otxApiKeyInput', status.otxConfigured);
        setKeyPlaceholder('claudeApiKeyInput', status.claudeConfigured);
        setKeyPlaceholder('openaiApiKeyInput', status.openaiConfigured);

        // Model dropdown — seçenekler HTML'de hardcoded; sadece kayıtlı değeri seç
        const modelSel = document.getElementById('openaiModelSelect');
        const modelInp = document.getElementById('openaiModelCustom');
        if (modelSel) {
            const currentModel = status.openaiModel || '';
            modelSel.value = currentModel;
            // Değer listede yoksa "Özel" seçeneğini etkinleştir
            if (currentModel && modelSel.value !== currentModel) {
                modelSel.value = '__custom__';
                if (modelInp) { modelInp.style.display = ''; modelInp.value = currentModel; }
            } else {
                if (modelInp) { modelInp.style.display = 'none'; modelInp.value = ''; }
            }

            // Kurucu kilidi: MSA_LOCKED_OPENAI_MODEL .env'de set ise UI kilitlenir.
            // Müşteri admin görür ama değiştiremez — "Sistem yöneticisi tarafından
            // sabitlendi" notu eklenir.
            const lockHintId = 'openaiModelLockHint';
            const existingHint = document.getElementById(lockHintId);
            if (existingHint) existingHint.remove();
            modelSel.disabled = !!status.openaiModelLocked;
            if (modelInp) modelInp.disabled = !!status.openaiModelLocked;
            if (status.openaiModelLocked) {
                modelSel.title = 'Bu model sunucu yöneticisi tarafından sabitlendi (.env: MSA_LOCKED_OPENAI_MODEL).';
                modelSel.style.cursor = 'not-allowed';
                modelSel.style.opacity = '0.7';
                const hint = document.createElement('div');
                hint.id = lockHintId;
                hint.style.cssText = 'font-size:11px;color:#fbbf24;margin-top:4px;display:flex;align-items:center;gap:4px';
                hint.innerHTML = '🔒 <span>Model kilidi: sistem yöneticisi <code>.env</code> üzerinden değiştirebilir.</span>';
                modelSel.parentElement?.appendChild(hint);
            } else {
                modelSel.title = '';
                modelSel.style.cursor = '';
                modelSel.style.opacity = '';
            }
        }

        // Risk modu select'ini güncel değere ayarla
        const riskModeSel = document.getElementById('riskModeSelect');
        if (riskModeSel) riskModeSel.value = status.riskMode || 'classic';

        statusEl.textContent = [
            `AntiVirüs: ${status.vtConfigured ? '✅' : '—'}`,
            `OTX: ${status.otxConfigured ? '✅' : '—'}`,
            `Link Tarama Motoru: ${status.abuseFeedAvailable ? 'OK' : '-'}`,
            `Claude: ${status.claudeConfigured ? '✅' : '—'}`,
            `OpenAI: ${status.openaiConfigured ? `✅ (${status.openaiModel || 'default'})` : '—'}`,
            `Firma: ${profile.name || 'tanımsız'}`
        ].join(' | ');
    } catch (error) {
        const statusEl = document.getElementById('settingsStatus');
        if (statusEl) {
            statusEl.textContent = `Settings status unavailable: ${error.message}`;
        }
    }
}

async function testOtxConnection() {
    const apiKey = document.getElementById('otxApiKeyInput')?.value.trim();
    const statusEl = document.getElementById('otxTestStatus');
    if (!statusEl) return;
    if (!apiKey) {
        statusEl.innerHTML = '<span style="color:#f59e0b">⚠️ Önce OTX API anahtarını girin.</span>';
        return;
    }
    statusEl.innerHTML = '<span style="color:var(--text-secondary)">⏳ Test ediliyor...</span>';
    try {
        const res = await fetch('/api/settings/otx/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(licenseKey ? { 'x-license-key': licenseKey } : {})
            },
            body: JSON.stringify({ otxApiKey: apiKey })
        });
        const data = await res.json();
        if (res.ok) {
            statusEl.innerHTML = `<span class="u-ok">✅ ${esc(data.message)}</span>`;
        } else {
            statusEl.innerHTML = `<span class="u-err">❌ ${esc(data.error)}</span>`;
        }
    } catch (e) {
        statusEl.innerHTML = `<span class="u-err">❌ Bağlantı hatası: ${esc(e.message)}</span>`;
    }
}

async function loadPeriodicReportSettings() {
    const statusEl = document.getElementById('periodicReportStatus');
    try {
        const res = await fetch('/api/reports/settings');
        const settings = await res.json();
        const accountsRes = await fetch('/api/imap/accounts');
        const accounts = await accountsRes.json();
        const dailyEl = document.getElementById('periodicDaily');
        const weeklyEl = document.getElementById('periodicWeekly');
        const monthlyEl = document.getElementById('periodicMonthly');
        if (dailyEl) dailyEl.checked = settings.daily !== false;
        if (weeklyEl) weeklyEl.checked = settings.weekly !== false;
        if (monthlyEl) monthlyEl.checked = settings.monthly !== false;
        if (statusEl) {
            const activeCount = accounts.filter((account) => account.autoSummaryReport).length;
            statusEl.textContent = `Otomatik rapor alacak IMAP hesabi: ${activeCount}. Otomatik: gunluk ${settings.daily ? 'acik' : 'kapali'}, haftalik ${settings.weekly ? 'acik' : 'kapali'}, aylik ${settings.monthly ? 'acik' : 'kapali'}. Manuel tetikleme IMAP satirindaki Rapor Gonder menusunden yapilir.`;
        }
    } catch (error) {
        if (statusEl) statusEl.textContent = `Rapor ayarlari yuklenemedi: ${error.message}`;
    }
}

async function triggerPeriodicReport(period) {
    const statusEl = document.getElementById('periodicReportStatus');
    if (statusEl) statusEl.textContent = 'Rapor hazirlaniyor ve gonderiliyor...';

    try {
        const res = await fetch('/api/reports/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ period })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Rapor gonderilemedi');
        }
        if (statusEl) {
            statusEl.textContent = `${period} raporu gonderildi. Alici: ${data.recipients.join(', ')} | Toplam tarama: ${data.stats.total} | Riskli: ${data.stats.risky}`;
        }
    } catch (error) {
        if (statusEl) statusEl.textContent = `Rapor gonderilemedi: ${error.message}`;
    }
}

// ============================================================
// EXPORT
// ============================================================
function exportJSON() {
    if (!currentResult) return;
    const blob = new Blob([JSON.stringify(currentResult, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `mailtrustai-report-${currentResult.id || 'scan'}.json`);
}

function exportPDF() {
    if (!currentResult || !window.jspdf) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const result = currentResult;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 34;
    const contentWidth = pageWidth - (margin * 2);
    const sectionGap = 18;
    const summary = buildExecutiveSummaryText(result);
    const meta = result.emailMeta || {};
    const from = meta.from?.[0]?.address || 'N/A';
    const to = meta.to?.[0]?.address || currentImapEmail || 'N/A';
    const attachments = mergeAttachmentScanData(result);
    const authRows = buildAuthRows(result);
    const threatTags = buildThreatTags(result);
    const recommendations = buildRecommendations(result);
    const risky = result.level !== 'safe';
    const levelLabel = asciiPdfText(_tLit(result.labelTR || result.labelEN || result.level, result.labelEN || result.level));
    const verdictLabel = risky ? 'RISKLI' : 'GUVENLI';
    const bannerColor = pdfHexToRgb(result.color || '#94a3b8');
    const dangerColor = risky ? [251, 113, 133] : [52, 211, 153];
    let y = margin;

    const ensureSpace = (needed) => {
        if (y + needed <= pageHeight - margin) return;
        doc.addPage();
        y = margin;
    };

    const drawWrappedText = (text, x, top, maxWidth, lineHeight = 14, color = [229, 231, 235], font = 'normal', size = 11) => {
        const safe = asciiPdfText(text || '');
        if (!safe) return top;
        doc.setFont('helvetica', font);
        doc.setFontSize(size);
        doc.setTextColor(...color);
        const lines = doc.splitTextToSize(safe, maxWidth);
        doc.text(lines, x, top);
        return top + (lines.length * lineHeight);
    };

    const drawSectionTitle = (title) => {
        ensureSpace(28);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(148, 163, 184);
        doc.text(asciiPdfText(title), margin, y);
        y += 16;
    };

    const drawMetricCard = (x, width, title, value, valueColor, bgColor) => {
        const cardHeight = 72;
        doc.setFillColor(...bgColor);
        doc.setDrawColor(38, 50, 68);
        doc.roundedRect(x, y, width, cardHeight, 12, 12, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184);
        doc.text(asciiPdfText(title), x + 14, y + 18);
        doc.setFontSize(18);
        doc.setTextColor(...valueColor);
        doc.text(asciiPdfText(value), x + 14, y + 46);
        return cardHeight;
    };

    ensureSpace(150);
    doc.setFillColor(17, 24, 39);
    doc.setDrawColor(...bannerColor);
    doc.roundedRect(margin, y, contentWidth, 126, 18, 18, 'FD');
    doc.setFillColor(11, 18, 32);
    doc.circle(margin + 42, y + 42, 28, 'F');
    doc.setDrawColor(...bannerColor);
    doc.setLineWidth(1.2);
    doc.circle(margin + 42, y + 42, 28, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(...bannerColor);
    doc.text(asciiPdfText(String(result.score || 0)), margin + 29, y + 50);
    doc.setFontSize(22);
    doc.text(levelLabel, margin + 84, y + 42);
    const verdictEndY = drawWrappedText(summary, margin + 84, y + 63, contentWidth - 180, 14, [209, 213, 219], 'normal', 11);
    doc.setFillColor(31, 41, 55);
    doc.setDrawColor(55, 65, 81);
    doc.roundedRect(pageWidth - margin - 132, y + 30, 98, 32, 10, 10, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...dangerColor);
    doc.text(verdictLabel, pageWidth - margin - 103, y + 50);
    y += Math.max(126, verdictEndY - (y - 10)) + sectionGap;

    const cardGap = 12;
    const cardWidth = (contentWidth - (cardGap * 2)) / 3;
    ensureSpace(90);
    drawMetricCard(margin, cardWidth, 'RISK SEVIYESI', levelLabel, bannerColor, [11, 18, 32]);
    drawMetricCard(margin + cardWidth + cardGap, cardWidth, 'SKOR', `${result.score || 0}/100`, [248, 250, 252], [11, 18, 32]);
    drawMetricCard(margin + ((cardWidth + cardGap) * 2), cardWidth, 'SONUC', verdictLabel, dangerColor, risky ? [63, 20, 32] : [5, 46, 43]);
    y += 72 + sectionGap;

    ensureSpace(86);
    doc.setFillColor(11, 18, 32);
    doc.setDrawColor(38, 50, 68);
    doc.roundedRect(margin, y, contentWidth, 70, 14, 14, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('YONETICI OZETI', margin + 16, y + 20);
    y = drawWrappedText(summary, margin + 16, y + 40, contentWidth - 32, 15, [229, 231, 235], 'normal', 11) + sectionGap;

    drawSectionTitle('INCELENEN E-POSTA');
    const metaRows = [
        ['Gonderen', from],
        ['Alici', to],
        ['Konu', meta.subject || 'N/A'],
        ['Tarih', formatDate(meta.date || result.timestamp, true)],
        ['Baglanti', `${buildLinkSummary(result).total} adet`],
        ['Ekler', attachments.length ? attachments.map((item) => item.filename).join(', ') : 'Ek yok']
    ];
    metaRows.forEach(([label, value]) => {
        ensureSpace(18);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(148, 163, 184);
        doc.text(`${asciiPdfText(label)}:`, margin, y);
        y = drawWrappedText(String(value || '-'), margin + 92, y, contentWidth - 92, 13, [229, 231, 235], 'normal', 10) + 4;
    });
    y += 6;

    drawSectionTitle('KIMLIK DOGRULAMA VE GONDEREN ITIBARI');
    authRows.forEach((row) => {
        ensureSpace(18);
        const severityColor = row.severity === 'critical'
            ? [251, 113, 133]
            : row.severity === 'warning'
                ? [251, 191, 36]
                : [52, 211, 153];
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(148, 163, 184);
        doc.text(`${asciiPdfText(row.label)}:`, margin, y);
        doc.setTextColor(...severityColor);
        doc.text(asciiPdfText(row.value || '-'), margin + 110, y);
        if (row.note) {
            y = drawWrappedText(row.note, margin + 110, y + 13, contentWidth - 110, 12, [203, 213, 225], 'normal', 9) + 5;
        } else {
            y += 16;
        }
    });
    y += 6;

    drawSectionTitle('ANTIVIRUS VE EK TARAMA SONUCLARI');
    if (!attachments.length) {
        y = drawWrappedText('Ek bulunamadi.', margin, y, contentWidth, 13, [148, 163, 184], 'normal', 10) + sectionGap;
    } else {
        attachments.slice(0, 8).forEach((row) => {
            ensureSpace(30);
            const verdict = renderAttachmentVerdictText(row, result.vtStatus);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(229, 231, 235);
            doc.text(asciiPdfText(row.filename || 'Ek'), margin, y);
            y = drawWrappedText(`SHA-256: ${shortHash(row.hash || '')} | ${verdict}`, margin + 14, y + 13, contentWidth - 14, 12, [148, 163, 184], 'normal', 9) + 6;
        });
        y += 4;
    }

    drawSectionTitle('TESPIT EDILEN TEHDIT TIPLERI');
    if (!threatTags.length) {
        y = drawWrappedText('Belirgin tehdit tipi tespit edilmedi.', margin, y, contentWidth, 13, [148, 163, 184], 'normal', 10) + sectionGap;
    } else {
        y = drawWrappedText(threatTags.map((tag) => tag.label).join(' | '), margin, y, contentWidth, 14, [229, 231, 235], 'normal', 10) + sectionGap;
    }

    drawSectionTitle('DETAYLI BULGULAR');
    const findings = (result.findings || []).filter((finding) => finding.severity !== 'safe');
    if (!findings.length) {
        y = drawWrappedText('Detayli bulgu yok.', margin, y, contentWidth, 13, [148, 163, 184], 'normal', 10) + sectionGap;
    } else {
        findings.slice(0, 20).forEach((finding) => {
            ensureSpace(26);
            const severity = asciiPdfText((finding.severity || 'info').toUpperCase());
            const category = asciiPdfText(finding.category || 'genel');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(229, 231, 235);
            doc.text(`[${severity}] ${category}`, margin, y);
            y = drawWrappedText(finding.message || '', margin + 14, y + 13, contentWidth - 14, 12, [209, 213, 219], 'normal', 9) + 6;
        });
        y += 4;
    }

    drawSectionTitle('GUVENLIK ONERILERI');
    recommendations.forEach((item) => {
        ensureSpace(22);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(229, 231, 235);
        doc.text('-', margin, y);
        y = drawWrappedText(item, margin + 10, y, contentWidth - 10, 13, [229, 231, 235], 'normal', 10) + 4;
    });

    doc.save(`mailtrustai-report-${result.id || 'scan'}.pdf`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TARAMA GEÇMİŞİ SAYFASI
// ═══════════════════════════════════════════════════════════════════════════

const _slState = { page: 1, total: 0, totalPages: 1, loading: false, initialized: false };

function scanListInit() {
    if (!_slState.initialized) {
        _slState.initialized = true;
        // Kullanıcı rolüne göre "Hesap" sütununu gizle
        _scanListApplyRoleUI();
    }
    scanListLoad(1);
}

function _scanListApplyRoleUI() {
    try {
        const token = sessionStorage.getItem('msa_customer_token') || '';
        if (!token) return;
        const payloadB64 = token.split('.')[0];
        const payload = JSON.parse(atob(payloadB64.replace(/-/g,'+').replace(/_/g,'/')));
        if (payload.r === 'user') {
            // user rolü: Hesap sütununu gizle
            const col = document.getElementById('slColAccount');
            if (col) col.style.display = 'none';
        }
    } catch {}
}

function _scanListHeaders() {
    const token = sessionStorage.getItem('msa_customer_token') || '';
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function _scanListRole() {
    try {
        const token = sessionStorage.getItem('msa_customer_token') || '';
        if (!token) return 'admin';
        const p = JSON.parse(atob(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));
        return p.r || 'user';
    } catch { return 'user'; }
}

async function scanListLoad(page = 1) {
    if (_slState.loading) return;
    _slState.loading = true;
    _slState.page    = page;

    const body   = document.getElementById('scanListBody');
    const info   = document.getElementById('scanListInfo');
    const pager  = document.getElementById('scanListPager');
    if (body) body.innerHTML = `<tr><td colspan="8" style="padding:28px;text-align:center;color:var(--text-secondary)">⏳ Yükleniyor…</td></tr>`;
    if (info)  info.textContent  = '';
    if (pager) pager.innerHTML   = '';

    const params = new URLSearchParams({
        from_email: (document.getElementById('slFromEmail')?.value  || '').trim(),
        subject:    (document.getElementById('slSubject')?.value     || '').trim(),
        start:      document.getElementById('slDateStart')?.value    || '',
        end:        document.getElementById('slDateEnd')?.value      || '',
        level:      document.getElementById('slLevel')?.value        || '',
        page:       String(page),
        limit:      '50'
    });

    try {
        const res = await fetch('/api/scan-history/search?' + params.toString(), {
            headers: _scanListHeaders()
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (body) body.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:#f87171">Hata: ${_escHtml(err.error || res.statusText)}</td></tr>`;
            return;
        }
        const data = await res.json();
        _slState.total      = data.total || 0;
        _slState.totalPages = data.totalPages || 1;
        _scanListRender(data);
    } catch (e) {
        if (body) body.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:#f87171">Bağlantı hatası: ${_escHtml(e.message)}</td></tr>`;
    } finally {
        _slState.loading = false;
    }
}

function _scanListRender(data) {
    const rows  = data.rows || [];
    const body  = document.getElementById('scanListBody');
    const info  = document.getElementById('scanListInfo');
    const pager = document.getElementById('scanListPager');
    const isAdmin = (_scanListRole() === 'admin');

    // Bilgi satırı
    if (info) {
        const start = ((_slState.page - 1) * 50) + 1;
        const end   = Math.min(_slState.page * 50, _slState.total);
        info.textContent = _slState.total > 0
            ? `${_slState.total.toLocaleString('tr-TR')} kayıt bulundu — ${start}–${end} gösteriliyor`
            : 'Sonuç bulunamadı.';
    }

    // Tablo satırları
    if (!rows.length) {
        if (body) body.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-secondary)">Eşleşen tarama kaydı bulunamadı.</td></tr>`;
        return;
    }

    const levelMeta = {
        high:   { label:'Yüksek', color:'#ef4444', bg:'rgba(239,68,68,0.12)'   },
        medium: { label:'Orta',   color:'#f97316', bg:'rgba(249,115,22,0.12)'  },
        low:    { label:'Düşük',  color:'#eab308', bg:'rgba(234,179,8,0.12)'   },
        safe:   { label:'Güvenli',color:'#22c55e', bg:'rgba(34,197,94,0.12)'   },
    };

    const sourceLabel = s => {
        const map = { 'scan-mailbox':'📬 Otomatik', 'imap-manual':'📡 IMAP', 'upload':'📁 Dosya', 'paste':'📋 Yapıştır' };
        return map[s] || (s || '—');
    };

    body.innerHTML = rows.map((r, i) => {
        const lm    = levelMeta[r.level] || { label: r.level || '?', color:'#94a3b8', bg:'transparent' };
        const date  = r.timestamp ? new Date(r.timestamp).toLocaleString('tr-TR', { dateStyle:'short', timeStyle:'short' }) : '—';
        const score = r.score != null ? `<span style="color:${lm.color};font-weight:600">${r.score}</span>` : '—';
        const from  = _escHtml((r.from_email || '—').slice(0, 45));
        const subj  = _escHtml((r.subject   || '(Konu yok)').slice(0, 60));
        const acct  = _escHtml((r.imap_email || r.user_key || '—').slice(0, 40));
        const src   = _escHtml(sourceLabel(r.scan_source));
        const even  = i % 2 === 0 ? '' : 'background:rgba(255,255,255,0.02)';
        const acctCell = isAdmin
            ? `<td style="padding:9px 12px;color:var(--text-secondary);font-size:12px;${even}">${acct}</td>`
            : `<td style="display:none"></td>`;

        return `<tr style="${even}cursor:pointer" onclick="scanListOpenDetail('${_escHtml(r.scan_id || '')}')" title="Detayı görüntüle">
            <td style="padding:9px 12px;white-space:nowrap;color:var(--text-secondary);font-size:12px">${date}</td>
            <td style="padding:9px 12px;font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${from}">${from}</td>
            <td style="padding:9px 12px;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${subj}">${subj}</td>
            <td style="padding:9px 12px;text-align:center">
                <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:${lm.color};background:${lm.bg}">${lm.label}</span>
            </td>
            <td style="padding:9px 12px;text-align:center;font-size:13px">${score}</td>
            ${acctCell}
            <td style="padding:9px 12px;font-size:12px;color:var(--text-secondary)">${src}</td>
            <td style="padding:9px 4px;text-align:center">
                <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" onclick="event.stopPropagation();scanListOpenDetail('${_escHtml(r.scan_id || '')}')">Detay</button>
            </td>
        </tr>`;
    }).join('');

    // Sayfalama
    _scanListRenderPager(data.page, data.totalPages);
}

function _scanListRenderPager(page, totalPages) {
    const pager = document.getElementById('scanListPager');
    if (!pager || totalPages <= 1) return;

    const btnStyle = (active) =>
        `style="min-width:32px;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:${active ? 'var(--accent)' : 'var(--surface2)'};color:${active ? '#fff' : 'var(--text-primary)'};cursor:${active ? 'default' : 'pointer'};font-size:13px"`;

    let html = '';

    // Önceki
    html += `<button ${btnStyle(false)} ${page <= 1 ? 'disabled style="opacity:.4;cursor:default"' : `onclick="scanListLoad(${page-1})"`}>‹</button>`;

    // Sayfa numaraları (max 7 göster)
    const pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (page > 3) pages.push('…');
        for (let i = Math.max(2, page-1); i <= Math.min(totalPages-1, page+1); i++) pages.push(i);
        if (page < totalPages - 2) pages.push('…');
        pages.push(totalPages);
    }

    pages.forEach(p => {
        if (p === '…') {
            html += `<span style="padding:5px 4px;color:var(--text-secondary)">…</span>`;
        } else {
            const isActive = p === page;
            html += `<button ${btnStyle(isActive)} ${isActive ? 'disabled' : `onclick="scanListLoad(${p})"`}>${p}</button>`;
        }
    });

    // Sonraki
    html += `<button ${btnStyle(false)} ${page >= totalPages ? 'disabled style="opacity:.4;cursor:default"' : `onclick="scanListLoad(${page+1})"`}>›</button>`;

    // Toplam bilgisi
    html += `<span style="font-size:12px;color:var(--text-secondary);margin-left:6px">Sayfa ${page} / ${totalPages}</span>`;

    pager.innerHTML = html;
}

async function scanListOpenDetail(scanId) {
    if (!scanId) return;
    const headers = _scanListHeaders();
    try {
        const res = await fetch(`/api/scan/${encodeURIComponent(scanId)}`, { headers });
        if (!res.ok) {
            // scan_id ile bulunamazsa history'den bul
            showToast('Detay yüklenemedi.', 'warning');
            return;
        }
        const result = await res.json();
        if (result && result.level) {
            showPage('scan');
            showResults(result);
            _scanListInjectBackButton();
        } else {
            showToast('Tarama detayı bulunamadı.', 'warning');
        }
    } catch (e) {
        showToast('Detay yüklenirken hata: ' + e.message, 'error');
    }
}

function _scanListInjectBackButton() {
    // Mevcut butonu sil (tekrar girişlerde duplikasyon olmasın)
    document.getElementById('scanListBackBtn')?.remove();
    const panel = document.getElementById('resultsPanel');
    if (!panel) return;
    const bar = document.createElement('div');
    bar.id = 'scanListBackBtn';
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;margin:0 0 14px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px';
    bar.innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="scanListGoBack()" style="display:flex;align-items:center;gap:6px">
            <span>←</span><span>Tarama Geçmişine Dön</span>
        </button>
        <span style="font-size:12px;color:var(--text-secondary)">Geçmişten açılan tarama detayı görüntüleniyor.</span>
    `;
    panel.insertBefore(bar, panel.firstChild);
    // Sayfanın üstüne kaydır
    try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
}

function scanListGoBack() {
    document.getElementById('scanListBackBtn')?.remove();
    showPage('scan-list');
}

function scanListReset() {
    const ids = ['slFromEmail','slSubject','slDateStart','slDateEnd'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const lv = document.getElementById('slLevel'); if (lv) lv.value = '';
    scanListLoad(1);
}

async function scanListExportCsv() {
    const params = new URLSearchParams({
        from_email: (document.getElementById('slFromEmail')?.value  || '').trim(),
        subject:    (document.getElementById('slSubject')?.value     || '').trim(),
        start:      document.getElementById('slDateStart')?.value    || '',
        end:        document.getElementById('slDateEnd')?.value      || '',
        level:      document.getElementById('slLevel')?.value        || '',
        page:       '1',
        limit:      '1000'
    });

    try {
        const headers = _scanListHeaders();
        const res = await fetch('/api/scan-history/search?' + params.toString(), { headers });
        if (!res.ok) { showToast('Veri alınamadı.', 'error'); return; }
        const data = await res.json();
        const rows = data.rows || [];
        if (!rows.length) { showToast('Dışa aktarılacak kayıt yok.', 'warning'); return; }

        const csvLines = ['﻿Tarih,Gönderen,Konu,Risk,Skor,Kaynak,Hesap'];
        rows.forEach(r => {
            const date  = r.timestamp ? new Date(r.timestamp).toLocaleString('tr-TR') : '';
            const from  = (r.from_email || '').replace(/,/g,';');
            const subj  = (r.subject   || '').replace(/,/g,';').replace(/"/g,"'");
            const level = r.level || '';
            const score = r.score != null ? r.score : '';
            const src   = r.scan_source || '';
            const acct  = (r.imap_email || r.user_key || '').replace(/,/g,';');
            csvLines.push([date, from, `"${subj}"`, level, score, src, acct].join(','));
        });

        const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `tarama-gecmisi-${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showToast(`${rows.length} kayıt CSV olarak indirildi.`, 'success');
    } catch (e) {
        showToast('CSV oluşturma hatası: ' + e.message, 'error');
    }
}

async function exportExecutivePDF() {
    if (!window.jspdf) return alert('PDF kutuphanesi yuklenemedi.');
    if (!currentExecutiveDashboard) await loadExecutiveDashboard();
    const data = currentExecutiveDashboard;
    if (!data) return alert('Executive rapor verisi alinamadi.');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, H = 297, M = 14, CW = 182;

    const generated = data.generatedAt
        ? new Date(data.generatedAt).toLocaleString('tr-TR')
        : new Date().toLocaleString('tr-TR');
    const stats  = data.stats || {};
    const total  = Math.max(stats.total || 0, 1);
    const score  = data.score ?? 0;
    const grade  = data.grade || '-';
    const alerts = Array.isArray(data.commercialAlerts) ? data.commercialAlerts : [];
    const recs   = data.recommendations || [];

    // ── colour palette ──────────────────────────────────────────────────────
    const C = {
        bg:      [11, 18, 32],   bgCard:  [22, 33, 55],   bgCard2: [17, 26, 44],
        accent:  [99,102,241],   accent2: [129,140,248],
        high:    [239, 68, 68],  medium:  [249,115, 22],
        low:     [234,179,  8],  safe:    [ 34,197, 94],
        textLt:  [241,245,249],  textMd:  [203,213,225],  textDim: [148,163,184],
        border:  [ 51, 65, 85],  white:   [255,255,255],
        indigo:  [ 67, 56,202],
    };

    // ── primitives ──────────────────────────────────────────────────────────
    const fillR  = (x,y,w,h,c)  => { doc.setFillColor(c[0],c[1],c[2]); doc.rect(x,y,w,h,'F'); };
    const textC  = (c)           => doc.setTextColor(c[0],c[1],c[2]);
    const font   = (s,sz)        => { doc.setFont('helvetica',s); doc.setFontSize(sz); };
    const txt    = (s,x,y,o)    => doc.text(String(s||''),x,y,o||{});
    const wrapTxt = (s,x,y,maxW,c,style,sz,leading=5) => {
        font(style||'normal', sz||8); textC(c);
        const lines = doc.splitTextToSize(String(s||''), maxW);
        lines.forEach((l,i) => txt(l, x, y + i * leading));
        return y + lines.length * leading;
    };
    const scoreColor = score >= 75 ? C.safe : score >= 50 ? C.low : score >= 30 ? C.medium : C.high;
    const trendColor = (data.trend??0) > 3 ? C.safe : (data.trend??0) < -3 ? C.high : C.low;
    const trendIcon  = (data.trend??0) > 3 ? '+' : (data.trend??0) < -3 ? '-' : '=';

    // ── page footer helper ──────────────────────────────────────────────────
    const pageFooter = (num, total3) => {
        fillR(0, H-10, W, 10, C.bgCard);
        fillR(0, H-10, W, 0.5, C.border);
        font('normal',5.5); textC(C.textDim);
        txt('MailTrustAI | Gizli — Yalnizca yetkili kisi ve kurumlarla paylasilabilir.', M, H-4.5);
        txt(`Sayfa ${num} / ${total3}`, W-M, H-4.5, {align:'right'});
    };

    // ── section heading helper ──────────────────────────────────────────────
    const sectionHead = (label, y) => {
        fillR(M, y, CW, 7, C.bgCard);
        fillR(M, y, 2.5, 7, C.accent);
        font('bold',7.5); textC(C.accent2);
        txt(label, M+5, y+5);
        return y+10;
    };

    // =========================================================================
    // PAGE 1  –  Cover · Score · KPIs · Distribution bar
    // =========================================================================
    fillR(0,0,W,H, C.bg);

    // header band
    fillR(0,0,W,44, C.bgCard);
    fillR(0,0,W,2,  C.accent);

    // brand
    font('bold',22); textC(C.textLt); txt('MailTrustAI', M, 17);
    font('normal',8); textC(C.accent2); txt('EMAIL SECURITY PLATFORM', M, 23.5);

    // report title block (right-aligned)
    font('bold',14); textC(C.textLt); txt('EXECUTIVE SECURITY REPORT', M, 34);
    font('normal',7); textC(C.textDim);
    txt(`Olusturulma: ${generated}  |  Periyot: Son ${data.periodDays||30} gun`, M, 40);

    // confidential badge
    fillR(W-42,7,30,10,[79,70,229]);
    font('bold',6.5); textC(C.white); txt('KONFIDANSIYEL', W-41, 13.5);

    // ── SECURITY SCORE circle ──────────────────────────────────────────────
    const scX = M+26, scY = 74, scR = 23;
    doc.setFillColor(C.bgCard[0],C.bgCard[1],C.bgCard[2]);
    doc.setDrawColor(C.border[0],C.border[1],C.border[2]);
    doc.setLineWidth(0.4);
    doc.circle(scX, scY, scR+3, 'FD');
    doc.setDrawColor(scoreColor[0],scoreColor[1],scoreColor[2]);
    doc.setLineWidth(4);
    doc.circle(scX, scY, scR, 'S');
    font('bold',22); textC(scoreColor); txt(String(score), scX, scY+2, {align:'center'});
    font('bold',7);  textC(C.textDim); txt('/100', scX, scY+8.5, {align:'center'});
    font('bold',9);  textC(C.textLt);  txt(`NOT: ${grade}`, scX, scY+16, {align:'center'});
    font('normal',6.5); textC(C.textDim); txt('GUVENLIK SKORU', scX, scY+23, {align:'center'});

    // ── trend + license side panel ──────────────────────────────────────────
    const panX = M+60, panY = 52;
    fillR(panX, panY, 80, 14, C.bgCard);
    fillR(panX, panY, 80, 2, trendColor);
    font('bold',11); textC(trendColor);
    const trendTxt = (data.trend??0)>3 ? 'IYILESME' : (data.trend??0)<-3 ? 'BOZULMA' : 'STABIL';
    txt(`${trendIcon}  ${trendTxt}`, panX+4, panY+9.5);
    font('normal',6.5); textC(C.textDim);
    txt(`Onceki doneme gore: ${Math.abs(data.trend??0)} puan`, panX+4, panY+13.5);

    if (data.license) {
        fillR(panX, panY+16, 80, 20, C.bgCard);
        fillR(panX, panY+16, 80, 1.5, C.indigo);
        font('bold',6.5); textC(C.accent2); txt('LISANS BILGILERI', panX+4, panY+22);
        font('normal',7.5); textC(C.textMd);
        txt(`Plan: ${(data.license.plan||'free').toUpperCase()}`, panX+4, panY+29);
        if (data.license.daysLeft!=null) {
            const dc = data.license.daysLeft<=7?C.high:data.license.daysLeft<=30?C.medium:C.safe;
            textC(dc); txt(`Kalan: ${data.license.daysLeft} gun`, panX+4, panY+35);
        }
    }

    // ── 4 KPI boxes ────────────────────────────────────────────────────────
    const kpiY = 104, kpiW = 44, kpiH = 26;
    const kpis = [
        { l:'TOPLAM TARAMA',  v: stats.total||0,                      c: C.accent  },
        { l:'RISKLI MAIL',    v: stats.risky||0,                      c: C.medium  },
        { l:'YUKSEK RISK',    v: stats.high||0,                       c: C.high    },
        { l:'RISK ORANI',     v:`%${stats.riskRate||0}`,              c: (stats.riskRate||0)>30?C.high:(stats.riskRate||0)>10?C.medium:C.safe },
    ];
    kpis.forEach((k,i) => {
        const kx = M + i*(kpiW+2);
        fillR(kx, kpiY, kpiW, kpiH, C.bgCard);
        fillR(kx, kpiY, kpiW, 2.5, k.c);
        font('bold',18); textC(k.c); txt(String(k.v), kx+kpiW/2, kpiY+15, {align:'center'});
        font('normal',5.5); textC(C.textDim); txt(k.l, kx+kpiW/2, kpiY+22, {align:'center'});
    });

    // ── secondary KPI row ──────────────────────────────────────────────────
    const kpi2Y = kpiY+kpiH+3, kpi2H = 20;
    const kpi2 = [
        { l:'GUVENLI',     v: stats.safe||0,          c: C.safe   },
        { l:'ORTA RISK',   v: stats.medium||0,        c: C.medium },
        { l:'VT ISARETLI', v: stats.vtHits||0,        c: stats.vtHits>0?C.high:C.safe },
        { l:'DUSUK RISK',  v: stats.low||0,           c: C.low    },
    ];
    kpi2.forEach((k,i) => {
        const kx = M + i*(kpiW+2);
        fillR(kx, kpi2Y, kpiW, kpi2H, C.bgCard);
        fillR(kx, kpi2Y, kpiW, 2, k.c);
        font('bold',14); textC(k.c); txt(String(k.v), kx+kpiW/2, kpi2Y+11, {align:'center'});
        font('normal',5.5); textC(C.textDim); txt(k.l, kx+kpiW/2, kpi2Y+17.5, {align:'center'});
    });

    // ── stacked risk distribution bar ─────────────────────────────────────
    const distY = kpi2Y+kpi2H+6;
    font('bold',7.5); textC(C.accent2); txt('RISK DAGILIMI', M, distY);
    const barY2 = distY+4, barH2 = 10;
    fillR(M, barY2, CW, barH2, C.bgCard);
    const segs = [
        {c:C.high,  n:stats.high||0},
        {c:C.medium,n:stats.medium||0},
        {c:C.low,   n:stats.low||0},
        {c:C.safe,  n:stats.safe||0},
    ];
    let bx2 = M;
    segs.forEach(s => {
        const sw = (s.n/total)*CW;
        if (sw>0.2) { fillR(bx2, barY2, sw, barH2, s.c); bx2+=sw; }
    });
    // bar labels
    const barLabels = ['Yuksek','Orta','Dusuk','Guvenli'];
    const barCounts  = [stats.high||0, stats.medium||0, stats.low||0, stats.safe||0];
    const barColors  = [C.high, C.medium, C.low, C.safe];
    let legX2 = M;
    barLabels.forEach((l,i) => {
        fillR(legX2, barY2+barH2+3, 5, 4, barColors[i]);
        font('normal',6); textC(C.textDim);
        txt(`${l}: ${barCounts[i]}`, legX2+7, barY2+barH2+6.5);
        legX2 += 46;
    });

    // ── findings breakdown row ─────────────────────────────────────────────
    const fbY2 = barY2+barH2+14;
    font('bold',7.5); textC(C.accent2); txt('BULGU KATEGORILERI', M, fbY2);
    const fbW = 44, fbH = 18;
    const fbs = [
        { l:'Ek Dosya Bulgulari',  v: stats.attachmentFindings||0, c: C.medium },
        { l:'Link/URL Bulgulari',  v: stats.linkFindings||0,        c: C.high   },
        { l:'AI Tespiti',          v: stats.aiFindings||0,          c: C.accent },
        { l:'Ort. Tarama Skoru',   v:`${stats.averageScanScore||0}/100`, c: C.low },
    ];
    fbs.forEach((f,i) => {
        const fx2 = M + i*(fbW+2);
        fillR(fx2, fbY2+3, fbW, fbH, C.bgCard);
        fillR(fx2, fbY2+3, fbW, 2, f.c);
        font('bold',13); textC(f.c); txt(String(f.v), fx2+fbW/2, fbY2+12, {align:'center'});
        font('normal',5.5); textC(C.textDim); txt(f.l, fx2+fbW/2, fbY2+19, {align:'center'});
    });

    // ── top senders table ─────────────────────────────────────────────────
    const stY = fbY2+27;
    const senders = (data.topSenders||[]).slice(0,5);
    let curY = sectionHead('EN RISKLI GONDERENLER (TOP 5)', stY);
    // table header
    fillR(M, curY, CW, 7, C.indigo);
    font('bold',6.5); textC(C.white);
    txt('E-POSTA', M+2, curY+4.8);
    txt('RISKLI', M+CW-30, curY+4.8);
    txt('%', M+CW-8, curY+4.8);
    curY += 7;
    if (senders.length) {
        senders.forEach((s,i) => {
            fillR(M, curY, CW, 8, i%2===0?C.bgCard:C.bgCard2);
            font('normal',6.5); textC(C.textMd);
            txt(s.email.length>50?s.email.slice(0,47)+'...':s.email, M+2, curY+5.5);
            const pct = Math.round((s.count/total)*100);
            // mini bar
            const mbW = Math.round((pct/100)*28);
            fillR(M+CW-34, curY+2, mbW>0?mbW:1, 4, C.medium);
            font('bold',6.5); textC(C.medium); txt(String(s.count), M+CW-4, curY+5.5, {align:'right'});
            curY += 8;
        });
    } else {
        font('normal',7); textC(C.textDim); txt('Riskli gonderici yok.', M+2, curY+5); curY+=10;
    }

    pageFooter(1,3);

    // =========================================================================
    // PAGE 2  –  Attack types · Risky mailboxes · Score breakdown
    // =========================================================================
    doc.addPage();
    fillR(0,0,W,H, C.bg);
    // page header
    fillR(0,0,W,12, C.bgCard); fillR(0,0,W,1.5, C.accent);
    font('bold',9); textC(C.textLt); txt('MailTrustAI — Risk Analizi', M, 8.5);
    font('normal',6.5); textC(C.textDim); txt(generated, W-M, 8.5, {align:'right'});

    let y2 = 20;

    // ── horizontal bar chart: attack types ────────────────────────────────
    y2 = sectionHead('SALDIRI / TEHDIT TIPLERI', y2);
    const attacks = (data.attackTypes||[]).slice(0,8);
    const maxAtk  = Math.max(...attacks.map(a=>a.count), 1);
    const barMaxW = CW*0.55;
    const atkColors = { link:'[239,68,68]', attachment:C.medium, ai:C.accent, header:C.low };
    if (attacks.length) {
        attacks.forEach((atk,i) => {
            const rowY2 = y2 + i*11;
            const bw2 = (atk.count/maxAtk)*barMaxW;
            const aColor = atk.type==='link'?C.high:atk.type==='attachment'?C.medium:atk.type==='ai'?C.accent:C.low;
            fillR(M+42, rowY2, barMaxW, 7, C.bgCard);
            if (bw2>0) fillR(M+42, rowY2, bw2, 7, aColor);
            font('normal',7); textC(C.textMd);
            txt(String(atk.type||'genel').slice(0,16), M, rowY2+5.5);
            font('bold',7); textC(C.textDim);
            txt(String(atk.count), M+42+bw2+2, rowY2+5.5);
        });
        y2 += attacks.length*11 + 6;
    } else {
        font('normal',7.5); textC(C.textDim); txt('Veri yok.', M, y2+4); y2+=10;
    }

    // ── risky mailboxes ────────────────────────────────────────────────────
    y2 = sectionHead('RISKLI POSTA KUTULARI', y2);
    const mailboxes = (data.riskyMailboxes||[]).slice(0,6);
    const maxMb = Math.max(...mailboxes.map(m=>m.count),1);
    if (mailboxes.length) {
        // table header
        fillR(M, y2, CW, 7, C.indigo);
        font('bold',6.5); textC(C.white);
        txt('POSTA KUTUSU', M+2, y2+4.8); txt('RISKLI', M+CW-30, y2+4.8); txt('%', M+CW-8, y2+4.8);
        y2 += 7;
        mailboxes.forEach((mb,i) => {
            fillR(M, y2, CW, 8, i%2===0?C.bgCard:C.bgCard2);
            font('normal',6.5); textC(C.textMd);
            txt(mb.email.length>50?mb.email.slice(0,47)+'...':mb.email, M+2, y2+5.5);
            const mbPct = Math.round((mb.count/total)*100);
            const mbBW = Math.round((mb.count/maxMb)*28);
            fillR(M+CW-34, y2+2, mbBW>0?mbBW:1, 4, C.medium);
            font('bold',6.5); textC(C.medium); txt(String(mb.count), M+CW-4, y2+5.5, {align:'right'});
            y2 += 8;
        });
        y2 += 4;
    } else {
        font('normal',7); textC(C.textDim); txt('Riskli posta kutusu yok.', M+2, y2+5); y2+=12;
    }

    // ── donem karsilastirmasi ──────────────────────────────────────────────
    y2 = sectionHead('DONEM KARSILASTIRMASI', y2);
    fillR(M, y2, CW, 18, C.bgCard);
    font('bold',16); textC(trendColor);
    const trendLabel2 = (data.trend??0)>3?'▲ IYILESME':(data.trend??0)<-3?'▼ BOZULMA':'= STABIL';
    txt(trendLabel2, M+CW/2, y2+10, {align:'center'});
    font('normal',6.5); textC(C.textDim);
    txt(`Guvenlik skoru onceki doneme gore ${Math.abs(data.trend??0)} puan ${(data.trend??0)>=0?'yukseldi':'dustu'}.`, M+CW/2, y2+16, {align:'center'});
    y2 += 22;

    // ── score distribution % boxes ─────────────────────────────────────────
    y2 = sectionHead('TARAMA SKORU DAGILIMI (%)', y2);
    const sdSegs = [
        { l:`Yuksek (${stats.high||0})`,  p:Math.round(((stats.high||0)/total)*100),  c:C.high   },
        { l:`Orta (${stats.medium||0})`,  p:Math.round(((stats.medium||0)/total)*100),c:C.medium },
        { l:`Dusuk (${stats.low||0})`,    p:Math.round(((stats.low||0)/total)*100),   c:C.low    },
        { l:`Guvenli (${stats.safe||0})`, p:Math.round(((stats.safe||0)/total)*100),  c:C.safe   },
    ];
    const sdW = CW/4-1.5;
    sdSegs.forEach((s,i) => {
        const sx2 = M + i*(sdW+2);
        fillR(sx2, y2, sdW, 20, C.bgCard);
        // fill bar from bottom based on percentage
        const fillH = Math.round((s.p/100)*18);
        if (fillH>0) fillR(sx2, y2+20-fillH, sdW, fillH, s.c.map(v=>Math.round(v*0.35)));
        fillR(sx2, y2, sdW, 2, s.c);
        font('bold',14); textC(s.c); txt(`%${s.p}`, sx2+sdW/2, y2+12, {align:'center'});
        font('normal',5.5); textC(C.textDim); txt(s.l, sx2+sdW/2, y2+18, {align:'center'});
    });
    y2 += 24;

    // ── weighted risk meter ────────────────────────────────────────────────
    y2 = sectionHead('AGIRLIKLI RISK ENDEKSI', y2);
    const wr = stats.weightedRisk||0;
    const wrColor = wr>=50?C.high:wr>=25?C.medium:wr>=10?C.low:C.safe;
    fillR(M, y2, CW, 12, C.bgCard);
    const wrBarW = Math.round((wr/100)*CW);
    if (wrBarW>0) fillR(M, y2, wrBarW, 12, wrColor.map(v=>Math.round(v*0.6)));
    fillR(M, y2, wrBarW>0?wrBarW:1, 12, wrColor);
    font('bold',9); textC(C.white); txt(`${wr} / 100`, M+4, y2+8);
    font('normal',6.5); textC(C.textDim);
    txt(`Agirlikli ortalama risk endeksi (yuksek=daha riskli)`, M+CW-2, y2+8, {align:'right'});
    y2 += 16;

    pageFooter(2,3);

    // =========================================================================
    // PAGE 3  –  Summary · Alerts · Recommendations · Stats table
    // =========================================================================
    doc.addPage();
    fillR(0,0,W,H, C.bg);
    fillR(0,0,W,12, C.bgCard); fillR(0,0,W,1.5, C.accent);
    font('bold',9); textC(C.textLt); txt('MailTrustAI — Oneriler & Eylem Plani', M, 8.5);
    font('normal',6.5); textC(C.textDim); txt(generated, W-M, 8.5, {align:'right'});

    let y3 = 20;

    // ── executive summary box ─────────────────────────────────────────────
    y3 = sectionHead('YONETICI OZETI', y3);
    const summaryTxt = `Bu donemde toplam ${stats.total||0} e-posta taranmistir. Risk orani %${stats.riskRate||0} olup guvenlik skoru ${score}/100 (${grade} notu) duzeyindedir. ${stats.high>0?`${stats.high} adet yuksek riskli e-posta tespit edilmistir.`:'Yuksek riskli e-posta tespit edilmemistir.'} ${stats.vtHits>0?`${stats.vtHits} ekte VirusTotal uyarisi alinmistir.`:''} Donem trendi: ${data.trendLabel||'stabil'}.`;
    fillR(M, y3, CW, 26, C.bgCard);
    fillR(M, y3, 3, 26, C.accent);
    const sumLines = doc.splitTextToSize(summaryTxt, CW-8);
    font('normal',7.5); textC(C.textMd);
    sumLines.slice(0,4).forEach((l,i) => txt(l, M+5, y3+6+i*5.5));
    y3 += 30;

    // ── commercial alerts ─────────────────────────────────────────────────
    y3 = sectionHead('TICARI / OPERASYONEL UYARILAR', y3);
    if (alerts.length) {
        alerts.slice(0,5).forEach((al) => {
            const alC = al.type==='critical'?C.high:al.type==='warning'?C.medium:C.low;
            fillR(M, y3, CW, 14, C.bgCard);
            fillR(M, y3, 3, 14, alC);
            font('bold',7); textC(alC); txt(String(al.title||'Uyari'), M+5, y3+5.5);
            font('normal',6.5); textC(C.textMd);
            const alLines = doc.splitTextToSize(String(al.message||''), CW-8);
            alLines.slice(0,2).forEach((l,i) => txt(l, M+5, y3+10+i*4.5));
            y3 += 16;
        });
    } else {
        fillR(M, y3, CW, 10, C.bgCard);
        fillR(M, y3, 3, 10, C.safe);
        font('normal',7); textC(C.safe);
        txt('Kritik ticari uyari yok. Mevcut kontroller etkin durumda.', M+5, y3+6.5);
        y3 += 13;
    }
    y3 += 3;

    // ── numbered recommendations ──────────────────────────────────────────
    y3 = sectionHead('ONERILEN AKSIYONLAR', y3);
    const numColors = [C.high, C.medium, C.low, C.safe, C.accent];
    if (recs.length) {
        recs.forEach((rec,i) => {
            const rc = numColors[i%numColors.length];
            fillR(M, y3, CW, 14, C.bgCard);
            fillR(M, y3, 10, 14, rc);
            font('bold',8); textC(C.white); txt(String(i+1), M+5, y3+9.5, {align:'center'});
            font('normal',7); textC(C.textMd);
            const rl = doc.splitTextToSize(rec, CW-15);
            rl.slice(0,2).forEach((l,li) => txt(l, M+13, y3+5+li*5.5));
            y3 += 16;
        });
    } else {
        font('normal',7); textC(C.textDim); txt('Oneri listesi bos.', M+4, y3+5); y3+=10;
    }
    y3 += 4;

    // ── summary stats 2-column table ──────────────────────────────────────
    y3 = sectionHead('DETAYLI ISTATISTIK TABLOSU', y3);
    const statRows = [
        ['Toplam Tarama',        stats.total||0,                  C.textMd],
        ['Guvenli Mail',         stats.safe||0,                   C.safe  ],
        ['Dusuk Riskli',         stats.low||0,                    C.low   ],
        ['Orta Riskli',          stats.medium||0,                 C.medium],
        ['Yuksek Riskli',        stats.high||0,                   C.high  ],
        ['Risk Orani',           `%${stats.riskRate||0}`,         (stats.riskRate||0)>30?C.high:(stats.riskRate||0)>10?C.medium:C.safe],
        ['Ort. Tarama Skoru',    `${stats.averageScanScore||0}/100`, C.textMd],
        ['Agirlikli Risk',       `${stats.weightedRisk||0}/100`,  C.textMd],
        ['VirusTotal Uyarisi',   stats.vtHits||0,                 stats.vtHits>0?C.high:C.safe],
        ['Ek Dosya Bulgusu',     stats.attachmentFindings||0,     stats.attachmentFindings>0?C.medium:C.textDim],
        ['Link/URL Bulgusu',     stats.linkFindings||0,           stats.linkFindings>0?C.high:C.textDim],
        ['AI Tespiti',           stats.aiFindings||0,             stats.aiFindings>0?C.accent:C.textDim],
    ];
    const colW3 = CW/2-1;
    statRows.forEach((row,i) => {
        const col = i%2, rowI = Math.floor(i/2);
        const rx3 = M + col*(colW3+2);
        const ry3 = y3 + rowI*9;
        fillR(rx3, ry3, colW3, 8, col===0?C.bgCard:C.bgCard2);
        font('normal',7); textC(C.textDim); txt(row[0], rx3+3, ry3+5.5);
        font('bold',7); textC(row[2]); txt(String(row[1]), rx3+colW3-3, ry3+5.5, {align:'right'});
    });
    y3 += Math.ceil(statRows.length/2)*9 + 6;

    // ── closing brand footer ──────────────────────────────────────────────
    fillR(0, H-16, W, 16, C.bgCard);
    fillR(0, H-16, W, 1, C.border);
    font('bold',7.5); textC(C.accent2); txt('MailTrustAI Email Security Platform', M, H-9);
    font('normal',6); textC(C.textDim);
    txt('Bu rapor sirket gizlidir. Yetkisiz dagitim ve kopyalama yasaktir.', M, H-5);
    txt(`Olusturulma: ${generated}  |  Sayfa 3 / 3`, W-M, H-5, {align:'right'});

    doc.save(`mailtrustai-executive-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// ============================================================
// HISTORY
// ============================================================
async function loadHistory() {
    try {
        const res = await fetch('/api/history');
        const historyItems = await res.json();
        currentHistoryResults = historyItems;

        const list = document.getElementById('historyList');
        if (!historyItems.length) {
            list.innerHTML = `<p class="text-muted">${t('no_history')}</p>`;
            return;
        }

        list.innerHTML = historyItems.slice(0, 10).map((item) => `
            <div class="history-item" onclick='openHistoryResult(${JSON.stringify(item.id)})'>
                <div class="history-score" style="background:${item.color}20;color:${item.color}">${item.score}</div>
                <div class="meta">
                    <div class="subject">${esc(item.emailMeta?.subject || 'Bilinmeyen')}</div>
                    <div class="time">${esc(item.emailMeta?.from?.[0]?.address || '')} - ${timeAgo(item.timestamp)}</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.warn('Failed to load history', error);
    }
}

function openHistoryResult(id) {
    const item = currentHistoryResults.find((result) => result.id === id);
    if (item) {
        showResults(item);
    }
}

// ============================================================
// HELPERS
// ============================================================
function showProgress() {
    document.getElementById('scanProgress').classList.remove('hidden');
    document.getElementById('panelUpload').classList.add('hidden');
    document.getElementById('panelPaste').classList.add('hidden');
    document.getElementById('panelImap').classList.add('hidden');
    document.getElementById('scanModes').classList.add('hidden');
}

function hideProgress() {
    document.getElementById('scanProgress').classList.add('hidden');
}

function findingIcon(severity) {
    return {
        critical: '!!',
        warning: '!',
        info: 'i',
        safe: 'OK'
    }[severity] || '.';
}

function formatCategory(category) {
    const map = {
        virusTotal:  'TESPİT EDİLEN TEHDİT TİPLERİ',
        header:      'BAŞLIK',
        content:     'İÇERİK',
        link:        'BAĞLANTI',
        abuse:       'LİNK TARAMA MOTORU',
        attachment:  'EK DOSYA',
        ai:          'YAPAY ZEKA',
        general:     'GENEL'
    };
    return map[category] || (category || 'genel').toUpperCase();
}

function severityFromThreatLevel(threatLevel) {
    if (threatLevel === 'critical' || threatLevel === 'high') return 'critical';
    if (threatLevel === 'medium' || threatLevel === 'low') return 'warning';
    return 'safe';
}

function buildExecutiveSummaryText(data) {
    const vtBad = (data?.virusTotal || []).find((entry) =>
        (entry.stats?.malicious || 0) > 0 || (entry.stats?.suspicious || 0) > 0
    );
    if (vtBad) {
        const malicious = entryCount(vtBad.stats?.malicious) + entryCount(vtBad.stats?.suspicious);
        const total = entryCount(vtBad.stats?.total);
        return `${vtBad.filename || 'Ek dosya'} virus kontrolunde ${malicious}/${total} motor tarafindan zararli veya supheli olarak isaretlendi. Bu nedenle e-posta riskli kabul edilmelidir.`;
    }

    const critical = (data?.findings || []).find((finding) => finding.severity === 'critical');
    if (critical?.message) return critical.message;

    return 'E-posta basliklari, icerigi, baglantilari ve ekleri otomatik guvenlik kontrollerinden gecirildi.';
}

function entryCount(value) {
    return Number(value) || 0;
}

function riskDescriptionFor(data) {
    return t(`risk_${data.level}_desc`);
}

function pdfHexToRgb(hex) {
    const normalized = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return [148, 163, 184];
    return [
        parseInt(normalized.slice(0, 2), 16),
        parseInt(normalized.slice(2, 4), 16),
        parseInt(normalized.slice(4, 6), 16)
    ];
}

function asciiPdfText(value) {
    return String(value ?? '')
        .replace(/İ/g, 'I')
        .replace(/I/g, 'I')
        .replace(/ı/g, 'i')
        .replace(/Ş/g, 'S')
        .replace(/ş/g, 's')
        .replace(/Ğ/g, 'G')
        .replace(/ğ/g, 'g')
        .replace(/Ü/g, 'U')
        .replace(/ü/g, 'u')
        .replace(/Ö/g, 'O')
        .replace(/ö/g, 'o')
        .replace(/Ç/g, 'C')
        .replace(/ç/g, 'c')
        .replace(/â€¦/g, '...')
        .replace(/[^\x20-\x7E\n]/g, '?');
}

function renderAttachmentVerdictText(row, vtStatus) {
    const status = row.vt || resolveAttachmentVtStatus(row, vtStatus) || {};
    const stats = status.stats || {};
    const malicious = entryCount(stats.malicious);
    const suspicious = entryCount(stats.suspicious);
    const total = entryCount(stats.total);

    if (row.quarantined || malicious > 0) {
        return malicious > 0
            ? `Tehlikeli - ${malicious}/${total} motor`
            : `Tehlikeli - ${row.gatewayDetection || 'gateway malware detection'}`;
    }
    if (suspicious > 0) return `Supheli - ${suspicious}/${total} motor`;
    if (status.checked === false && status.reason) return `Taranamadi - ${status.reason}`;
    return total > 0 ? `Temiz - 0/${total} motor` : 'Yerel kontrol temiz';
}

function mergeAttachmentScanData(data) {
    const attachmentDetails = Array.isArray(data?.attachmentDetails) ? data.attachmentDetails : [];
    const vtEntries = Array.isArray(data?.virusTotal) ? data.virusTotal : [];

    return attachmentDetails.map((item) => {
        const vt = vtEntries.find((entry) => entry.hash && item.hash && entry.hash === item.hash)
            || vtEntries.find((entry) => entry.filename === item.filename);
        return {
            ...item,
            vt,
            severity: attachmentSeverity(item, vt)
        };
    });
}

function attachmentSeverity(item, vt) {
    const issues = item?.issues || [];
    if (item?.quarantined) return 'critical';
    if (vt?.stats?.malicious > 0) return 'critical';
    if (vt?.stats?.suspicious > 0) return 'warning';
    if (issues.some((issue) => issue !== 'clean' && issue !== 'large-file')) return 'critical';
    if (issues.some((issue) => issue === 'large-file' || issue === 'suspicious-extension' || issue === 'macro-enabled')) return 'warning';
    return 'safe';
}

function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value, withTime) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return withTime
        ? date.toLocaleString(currentLang)
        : date.toLocaleDateString(currentLang);
}

function esc(value) {
    const el = document.createElement('span');
    el.textContent = value || '';
    return el.innerHTML;
}

function timeAgo(dateStr) {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return 'N/A';

    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);

    if (mins < 1) return _tLit('az once', 'just now');
    if (mins < 60) return `${mins} ${_tLit('dk once', 'min ago')}`;

    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${_tLit('sa once', 'hr ago')}`;

    const days = Math.floor(hours / 24);
    return `${days} ${_tLit('gun once', 'days ago')}`;
}

// ============================================================
// LICENSE USAGE
// ============================================================
async function loadLicenseUsage() {
    try {
        const res = await fetch('/api/license/usage');
        if (!res.ok) return;
        const data = await res.json();
        const counter = document.getElementById('usageCounter');
        if (!counter) return;
        const limit = licenseInfo?.monthlyLimit;
        const limitLabel = !limit || limit === Infinity ? '∞' : limit.toLocaleString();
        counter.textContent = `${data.monthlyCount} / ${limitLabel}`;
        counter.classList.remove('hidden');
    } catch {}
}

// ============================================================
// SCAN MAILBOX
// ============================================================
async function loadScanMailboxes() {
    try {
        const list = document.getElementById('scanMailboxList');
        const realtimeList = document.getElementById('scanMailboxRealtimeList');
        if (!list) return;

        // Auto-monitor listesini çek — alt bölüm için sakla, üst bölümde filtrele
        let autoMonitorSet = new Set();
        try {
            const amRes = await fetch('/api/auto-monitors');
            const monitors = await amRes.json();
            window.__currentAutoMonitors = monitors;
            autoMonitorSet = new Set(monitors.map(m => String(m.email || '').toLowerCase()));
        } catch (e) {
            console.error('loadAutoMonitors error:', e);
            window.__currentAutoMonitors = [];
        }

        // Üst bölüm: auto-monitor'da olanları gizle (sadece manuel ekleme görünür)
        const headers = {};
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const smRes = await fetch('/api/scan-mailboxes', { headers });
        const allItems = await smRes.json();
        const items = allItems.filter(smb => !autoMonitorSet.has(String(smb.imapEmail || '').toLowerCase()));

        // Auto-monitor entry'leri için rapor alıcısı haritası
        const reportToMap = new Map(
            allItems.map(smb => [String(smb.imapEmail || '').toLowerCase(), smb])
        );

        // Limit dolunca "Ekle" butonunu devre dışı bırak (tüm lisans tipleri için 1 adet sınırı)
        const addBtn = document.querySelector('#panelScanMailbox .btn-primary[onclick*="showScanMailboxModal"]');
        if (addBtn) {
            if (items.length >= 1) {
                addBtn.disabled = true;
                addBtn.title = 'Yalnızca 1 merkezi raporlama mail hesabı tanımlanabilir';
                addBtn.style.opacity = '0.4';
            } else {
                addBtn.disabled = false;
                addBtn.title = '';
                addBtn.style.opacity = '';
            }
        }

        list.innerHTML = items.length
            ? items.map(smb => {
                const recipientLabel = smb.reportToForwarder
                    ? '📤 İletilen adrese'
                    : `📨 ${esc(smb.reportTo || smb.imapEmail)}`;
                const centralBadge = '<span style="font-size:10px;background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);border-radius:4px;padding:1px 6px;margin-left:6px">Merkezi Raporlama</span>';
                const domains = Array.isArray(smb.allowedDomains) ? smb.allowedDomains : [];
                const domainBadge = domains.length
                    ? `<div style="font-size:11px;margin-top:3px;color:#a78bfa">🛡️ Yalnızca: ${esc(domains.join(', '))}</div>`
                    : '<div style="font-size:11px;margin-top:3px;opacity:0.55">🌐 Tüm domain\'lere açık</div>';
                return `
                <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px">
                    <div class="u-flex1">
                        <div style="font-weight:500">${esc(smb.imapEmail)}${centralBadge}</div>
                        <div class="text-muted" class="u-xs">
                            ${smb.enabled ? '<span style="color:var(--green)">● Aktif</span>' : '<span style="color:#94a3b8">● Pasif</span>'}
                            &nbsp;·&nbsp; ${esc(scanMailboxReportModeLabel(smb.reportMode))}
                            &nbsp;·&nbsp; ${(smb.reportLang || 'tr').toUpperCase()}
                        </div>
                        <div style="font-size:11px;margin-top:3px;color:var(--blue,#60a5fa)">${recipientLabel}</div>
                        ${domainBadge}
                    </div>
                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px">
                        <input type="checkbox" ${smb.enabled ? 'checked' : ''} onchange="toggleScanMailboxEnabled('${esc(smb.imapEmail)}', this.checked)">
                        ${t('scanmailbox_enabled')}
                    </label>
                    <button class="btn btn-ghost btn-sm" onclick="editScanMailbox('${esc(smb.imapEmail)}')" title="Düzenle">✏️</button>
                    <button class="btn btn-ghost btn-sm" onclick="deleteScanMailbox('${esc(smb.imapEmail)}')">🗑️</button>
                </div>
            `}).join('')
            : `<p class="text-muted">${t('scanmailbox_no_items')}</p>`;

        // Alt bölüm: WebSocket "İzlemeyi Başlat" ile aktif edilmiş izleyiciler
        if (realtimeList) {
            try {
                const monitors = window.__currentAutoMonitors || [];
                realtimeList.innerHTML = monitors.length
                    ? monitors.map(m => {
                        const isActive = activeMonitorEmails.has(m.email);
                        const updated = m.updatedAt ? new Date(m.updatedAt).toLocaleString(_tLit('tr-TR', 'en-US')) : '-';
                        const smbEntry = reportToMap.get(String(m.email || '').toLowerCase());
                        const recipientLabel = smbEntry?.reportToForwarder
                            ? '📤 İletilen adrese'
                            : (smbEntry?.reportTo || m.email);
                        return `
                        <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px">
                            <div class="u-flex1">
                                <div style="font-weight:500">${esc(m.email)}</div>
                                <div class="text-muted" class="u-sm">📡 IMAP otomatik izleme &nbsp;·&nbsp; ${isActive ? '<span style="color:var(--green)">● Aktif</span>' : '<span style="color:#f59e0b">● Bekliyor</span>'}</div>
                                <div style="font-size:11px;margin-top:3px;color:var(--blue,#60a5fa)">Rapor: ${esc(recipientLabel)}</div>
                                <div class="text-muted" class="u-xs">Eklendi: ${esc(updated)}</div>
                            </div>
                            <button class="btn btn-ghost btn-sm" onclick="stopAutoMonitorFromList('${esc(m.email)}')">⏹️ Durdur</button>
                        </div>
                    `;
                    }).join('')
                    : '<p class="text-muted">Henüz IMAP otomatik izleme yok. IMAP Tarama → hesap seç → <b>İzlemeyi Başlat</b> ile ekleyin.</p>';
            } catch (e) {
                console.error('loadAutoMonitors error:', e);
            }
        }
    } catch (e) {
        console.error('loadScanMailboxes error:', e);
    }
}

function stopAutoMonitorFromList(email) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop-monitor', email }));
    }
    fetch(`/api/auto-monitors/${encodeURIComponent(email)}`, { method: 'DELETE' })
        .then(() => loadScanMailboxes())
        .catch(() => loadScanMailboxes());
}

let editingScanMailboxEmail = null;

async function showScanMailboxModal() {
    if (_denyIfCustomerUser('Tarama Posta Kutusu Ekle')) return;
    editingScanMailboxEmail = null;
    const modal       = document.getElementById('scanMailboxModal');
    const limitBanner = document.getElementById('smProLimitBanner');
    const formBody    = document.getElementById('smFormBody');
    const saveBtn     = document.getElementById('smSaveBtn');

    // Limit kontrolü — tüm lisans tiplerinde max 1
    // Auto-monitor'da da olan adresleri filtrele (UI ile aynı mantık)
    let limitReached = false;
    try {
        const headers = {};
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const [smRes, amRes] = await Promise.all([
            fetch('/api/scan-mailboxes', { headers }),
            fetch('/api/auto-monitors')
        ]);
        const existing = await smRes.json();
        let autoMonitorEmails = new Set();
        try {
            const monitors = await amRes.json();
            autoMonitorEmails = new Set(monitors.map(m => String(m.email || '').toLowerCase()));
        } catch {}
        // Yalnızca auto-monitor listesinde OLMAYAN scan mailboxları say
        const visibleCount = existing.filter(
            smb => !autoMonitorEmails.has(String(smb.imapEmail || '').toLowerCase())
        ).length;
        limitReached = visibleCount >= 1;
    } catch {}

    if (limitBanner) limitBanner.classList.toggle('hidden', !limitReached);
    if (formBody) formBody.classList.toggle('hidden', limitReached);
    if (saveBtn)  saveBtn.disabled = limitReached;

    // Limit doluysa modal 3 saniye sonra otomatik kapansın
    if (limitReached) {
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 3000);
    }

    // "Tüm mailler" seçeneği: yalnızca Enterprise'da etkin
    const allOpt = document.querySelector('#smReportMode option[value="all"]');
    if (allOpt) {
        const isEnterprise = licenseInfo?.plan === 'enterprise';
        allOpt.disabled = !isEnterprise;
        allOpt.textContent = isEnterprise
            ? '📬 Tüm mailler için rapor al'
            : '📬 Tüm mailler için rapor al [Enterprise — devre dışı]';
    }

    if (!limitReached) {
        // Form sıfırla — tüm alanlar boş
        ['smImapHost','smImapEmail','smImapPassword','smSmtpHost','smSmtpPassword','smReportTo','smAllowedDomains'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; if (el.dataset) el.dataset.userEdited = 'false'; }
        });
        const imapEmailEl = document.getElementById('smImapEmail');
        if (imapEmailEl) { imapEmailEl.readOnly = false; imapEmailEl.style.opacity = ''; }
        const imapPort = document.getElementById('smImapPort');
        if (imapPort) imapPort.value = '993';
        const smtpPort = document.getElementById('smSmtpPort');
        if (smtpPort) smtpPort.value = '587';
        const imapTls = document.getElementById('smImapTls');
        if (imapTls) imapTls.checked = true;
        const smtpSamePass = document.getElementById('smSmtpSamePass');
        if (smtpSamePass) { smtpSamePass.checked = true; onSmSmtpSamePassChange(); }
        const reportMode = document.getElementById('smReportMode');
        if (reportMode) reportMode.value = 'risky';
        const reportModeWarning = document.getElementById('smReportModeWarning');
        if (reportModeWarning) reportModeWarning.style.display = 'none';
        const enabled = document.getElementById('smEnabled');
        if (enabled) enabled.checked = true;
        const forwarderRadio = document.getElementById('smReportTargetForwarder');
        if (forwarderRadio) { forwarderRadio.checked = true; onSmReportTargetChange(); }
        const smTestResult = document.getElementById('smTestResult');
        if (smTestResult) smTestResult.innerHTML = '';
    }

    modal.classList.remove('hidden');
}

async function editScanMailbox(imapEmail) {
    editingScanMailboxEmail = imapEmail;
    const modal       = document.getElementById('scanMailboxModal');
    const limitBanner = document.getElementById('smProLimitBanner');
    const formBody    = document.getElementById('smFormBody');
    const saveBtn     = document.getElementById('smSaveBtn');

    // Edit modunda limit/banner göster<a></a>me; formu aç
    if (limitBanner) limitBanner.classList.add('hidden');
    if (formBody)    formBody.classList.remove('hidden');
    if (saveBtn)     saveBtn.disabled = false;

    // "Tüm mailler" seçeneğinin Enterprise gating'i (showScanMailboxModal ile aynı)
    const allOpt = document.querySelector('#smReportMode option[value="all"]');
    if (allOpt) {
        const isEnterprise = licenseInfo?.plan === 'enterprise';
        allOpt.disabled = !isEnterprise;
        allOpt.textContent = isEnterprise
            ? '📬 Tüm mailler için rapor al'
            : '📬 Tüm mailler için rapor al [Enterprise — devre dışı]';
    }

    try {
        const headers = {};
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const res = await fetch('/api/scan-mailboxes', { headers });
        const list = await res.json();
        const smb  = list.find(s => s.imapEmail === imapEmail);
        if (!smb) {
            alert('Hesap bulunamadı.');
            return;
        }

        // IMAP / SMTP bağlantı alanları
        document.getElementById('smImapHost').value     = smb.imapHost || '';
        document.getElementById('smImapPort').value     = smb.imapPort || 993;
        document.getElementById('smImapEmail').value    = smb.imapEmail || '';
        document.getElementById('smImapEmail').readOnly = true;
        document.getElementById('smImapEmail').style.opacity = '0.65';
        document.getElementById('smImapPassword').value = '';   // boş = mevcut kullanılır
        document.getElementById('smImapPassword').placeholder = '•••••••• (değiştirmek için doldurun)';
        document.getElementById('smImapTls').checked    = smb.imapTls !== false;

        document.getElementById('smSmtpHost').value     = smb.smtpHost || smb.imapHost || '';
        document.getElementById('smSmtpPort').value     = smb.smtpPort || 587;
        document.getElementById('smSmtpHost').dataset.userEdited = 'true'; // edit modunda otomatik eşitleme yapma
        // SMTP şifresi: edit'te varsayılan olarak "IMAP ile aynı" işaretliyiz; kullanıcı değiştirebilir
        document.getElementById('smSmtpSamePass').checked = true;
        onSmSmtpSamePassChange();
        document.getElementById('smSmtpPassword').value = '';
        document.getElementById('smSmtpPassword').placeholder = '•••••••• (değiştirmek için doldurun)';

        // Domain filtresi
        const domains = Array.isArray(smb.allowedDomains) ? smb.allowedDomains : [];
        document.getElementById('smAllowedDomains').value = domains.join(', ');

        // Rapor hedefi
        const isForwarder = smb.reportToForwarder === true;
        document.getElementById('smReportTargetForwarder').checked = isForwarder;
        document.getElementById('smReportTargetFixed').checked     = !isForwarder;
        document.getElementById('smReportTo').value = isForwarder ? '' : (smb.reportTo || '');
        onSmReportTargetChange();

        // Dil / Mod / Aktif
        document.getElementById('smReportLang').value = smb.reportLang || 'tr';
        document.getElementById('smReportMode').value = smb.reportMode === 'all' ? 'all' : 'risky';
        onScanMailboxReportModeChange(document.getElementById('smReportMode'));
        document.getElementById('smEnabled').checked  = smb.enabled !== false;

        document.getElementById('smTestResult').innerHTML = '';
        modal.classList.remove('hidden');
    } catch (e) {
        alert('Düzenleme açılırken hata: ' + e.message);
    }
}

function onSmReportTargetChange() {
    const isForwarder = document.getElementById('smReportTargetForwarder')?.checked;
    const wrap = document.getElementById('smReportToWrap');
    if (wrap) wrap.classList.toggle('hidden', !!isForwarder);
}

function closeScanMailboxModal() {
    document.getElementById('scanMailboxModal').classList.add('hidden');
    document.getElementById('smTestResult').innerHTML = '';
    editingScanMailboxEmail = null;
    // Şifre alanı placeholder'larını ilk haline döndür
    const imapPwd = document.getElementById('smImapPassword');
    if (imapPwd) imapPwd.placeholder = '••••••••';
    const smtpPwd = document.getElementById('smSmtpPassword');
    if (smtpPwd) smtpPwd.placeholder = '••••••••';
    const smtpHost = document.getElementById('smSmtpHost');
    if (smtpHost && smtpHost.dataset) smtpHost.dataset.userEdited = 'false';
}

function showSmError(msg) {
    const el = document.getElementById('smTestResult');
    if (el) el.innerHTML = `<div style="color:#f87171;padding:8px 10px;border-radius:6px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);font-size:13px;margin-bottom:8px">${msg}</div>`;
}

function showSmSuccess(msg) {
    const el = document.getElementById('smTestResult');
    if (el) el.innerHTML = `<div style="color:#4ade80;padding:8px 10px;border-radius:6px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);font-size:13px;margin-bottom:8px">${msg}</div>`;
}

function onSmImapHostChange(val) {
    // SMTP sunucusunu otomatik olarak IMAP sunucusuyla eşitle (henüz değiştirilmediyse)
    const smtpHost = document.getElementById('smSmtpHost');
    if (smtpHost && (!smtpHost.dataset.userEdited || smtpHost.dataset.userEdited === 'false')) {
        smtpHost.value = val;
    }
}

function onSmSmtpSamePassChange() {
    const same = document.getElementById('smSmtpSamePass')?.checked;
    const wrap = document.getElementById('smSmtpPassWrap');
    if (wrap) wrap.classList.toggle('hidden', !!same);
}

async function testScanMailboxImap() {
    const host     = (document.getElementById('smImapHost')?.value || '').trim();
    const port     = Number(document.getElementById('smImapPort')?.value) || 993;
    const email    = (document.getElementById('smImapEmail')?.value || '').trim();
    const password = document.getElementById('smImapPassword')?.value || '';
    const secure   = document.getElementById('smImapTls')?.checked !== false;

    if (!host || !email || !password) {
        showSmError('⚠️ Sunucu, e-posta ve şifre alanları doldurulmalıdır.');
        return;
    }

    const el = document.getElementById('smTestResult');
    if (el) el.innerHTML = '<span style="color:#94a3b8;font-size:13px">⏳ Test ediliyor…</span>';

    try {
        const res = await fetch('/api/imap/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, email, password, secure, rejectUnauthorized: false })
        });
        const data = await res.json();
        if (data.success) {
            if (el) el.innerHTML = '<div style="color:#4ade80;padding:8px 10px;border-radius:6px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);font-size:13px">✅ IMAP bağlantısı başarılı</div>';
        } else {
            showSmError(`❌ Bağlantı hatası: ${data.message || 'Bilinmeyen hata'}`);
        }
    } catch (e) {
        showSmError(`❌ ${e.message}`);
    }
}

// "ornek.com, alt.ornek.com\npartner.org" → ['ornek.com', 'alt.ornek.com', 'partner.org']
// Lowercase, '@' ve boşluklar temizlenir, dup atılır.
function parseAllowedDomains(raw) {
    if (!raw) return [];
    return [...new Set(
        String(raw)
            .split(/[\s,;]+/)
            .map(s => s.trim().toLowerCase().replace(/^@/, ''))
            .filter(s => s && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s))
    )];
}

function getScanMailboxFormData() {
    const reportToForwarder = document.getElementById('smReportTargetForwarder')?.checked ?? true;
    const imapPassword      = document.getElementById('smImapPassword')?.value || '';
    const smtpSamePass      = document.getElementById('smSmtpSamePass')?.checked !== false;
    const smtpPassword      = smtpSamePass
        ? imapPassword
        : (document.getElementById('smSmtpPassword')?.value || '');
    return {
        imapHost:          (document.getElementById('smImapHost')?.value || '').trim(),
        imapPort:          Number(document.getElementById('smImapPort')?.value) || 993,
        imapEmail:         (document.getElementById('smImapEmail')?.value || '').trim(),
        imapPassword,
        imapTls:           document.getElementById('smImapTls')?.checked !== false,
        smtpHost:          (document.getElementById('smSmtpHost')?.value || '').trim(),
        smtpPort:          Number(document.getElementById('smSmtpPort')?.value) || 587,
        smtpPassword,
        reportToForwarder,
        reportTo:          reportToForwarder ? '' : (document.getElementById('smReportTo')?.value || '').trim(),
        allowedDomains:    parseAllowedDomains(document.getElementById('smAllowedDomains')?.value || ''),
        reportLang:        document.getElementById('smReportLang')?.value || 'tr',
        reportMode:        document.getElementById('smReportMode')?.value === 'all' ? 'all' : 'risky',
        enabled:           document.getElementById('smEnabled')?.checked !== false
    };
}

function onScanMailboxReportModeChange(select) {
    const warning = document.getElementById('smReportModeWarning');
    if (!warning) return;
    warning.style.display = (select.value === 'all' && licenseInfo?.plan !== 'enterprise') ? 'block' : 'none';
}

function scanMailboxReportModeLabel(reportMode) {
    if (reportMode === 'all') {
        return _tLit('tum mailler', 'all emails');
    }
    return _tLit('yalniz riskli', 'risky only');
}

async function saveScanMailbox() {
    // Önceki mesajı temizle
    const smTestResult = document.getElementById('smTestResult');
    if (smTestResult) smTestResult.innerHTML = '';

    const data = getScanMailboxFormData();
    if (!data.imapHost) {
        showSmError('⚠️ IMAP sunucu adresi zorunludur.');
        return;
    }
    if (!data.imapEmail) {
        showSmError('⚠️ E-posta / kullanıcı adı zorunludur.');
        return;
    }
    // Edit modunda şifre boş bırakılabilir — server mevcut kayıttaki şifreyi yeniden kullanır.
    if (!data.imapPassword && !editingScanMailboxEmail) {
        showSmError('⚠️ IMAP şifresi zorunludur.');
        return;
    }
    if (!data.smtpHost) {
        showSmError('⚠️ SMTP sunucu adresi zorunludur.');
        return;
    }
    if (!data.reportToForwarder && !data.reportTo) {
        showSmError(_tLit('⚠️ "Belirli adrese gönder" seçildiğinde bir e-posta adresi girilmesi zorunludur.', '⚠️ Please enter a recipient email address.'));
        return;
    }
    if (data.reportMode === 'all' && licenseInfo?.plan !== 'enterprise') {
        showSmError(_tLit('❌ "Tüm mailler" modu yalnızca Enterprise lisansında kullanılabilir. Lütfen "Sadece riskli mailler" seçeneğini kullanın.', '❌ "All emails" report mode requires an Enterprise license. Please use "Risky only".'));
        // Seçimi risky'ye döndür
        const rm = document.getElementById('smReportMode');
        if (rm) rm.value = 'risky';
        return;
    }

    // Kaydet butonu — yükleniyor durumu
    const saveBtn = document.getElementById('smSaveBtn');
    const origText = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '⏳ Kaydediliyor…'; }

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const res = await fetch('/api/scan-mailboxes', {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            closeScanMailboxModal();
            loadScanMailboxes();
        } else {
            showSmError(`❌ ${result.error || (_tLit('Kayıt başarısız', 'Save failed'))}`);
        }
    } catch (e) {
        showSmError(`❌ ${e.message}`);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
    }
}

async function deleteScanMailbox(imapEmail) {
    const ok = await showConfirm({
        title: _tLit('Tarama Posta Kutusu Sil', 'Delete Scan Mailbox'),
        message: _tLit(`${imapEmail} silinsin mi?`, `Delete ${imapEmail}?`),
        confirmText: _tLit('Sil', 'Delete'),
        cancelText: _tLit('Vazgeç', 'Cancel'),
        danger: true
    });
    if (!ok) return;
    try {
        await fetch(`/api/scan-mailboxes/${encodeURIComponent(imapEmail)}`, { method: 'DELETE' });
        loadScanMailboxes();
    } catch (e) {
        alert(e.message);
    }
}

async function toggleScanMailboxEnabled(imapEmail, enabled) {
    try {
        await fetch(`/api/scan-mailboxes/${encodeURIComponent(imapEmail)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        loadScanMailboxes();
    } catch (e) {
        console.error('toggle scan mailbox error:', e);
    }
}

// ============================================================
// SERVİS YÖNETİMİ
// ============================================================
let _serviceStatusInterval = null;

async function loadServiceStatus() {
    try {
        // Eski /api/admin/status (monolith) silindi → /api/system/status (meta.routes)
        const res = await fetch('/api/system/status');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const el = document.getElementById('serviceStatusInfo');
        if (!el) return;
        el.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:13px">
                <div><span class="text-muted">Durum:</span> <span style="color:var(--green,#00e676);font-weight:600">● Çalışıyor</span></div>
                <div><span class="text-muted">Çalışma süresi:</span> <strong>${esc(data.uptimeLabel)}</strong></div>
                <div><span class="text-muted">Başlangıç:</span> ${formatDate(data.startedAt, true)}</div>
                <div><span class="text-muted">RAM:</span> ${esc(String(data.memoryMB))} MB</div>
                <div><span class="text-muted">Node:</span> ${esc(data.nodeVersion)}</div>
                <div><span class="text-muted">Platform:</span> ${esc(data.platform)}</div>
            </div>
        `;
    } catch (e) {
        const el = document.getElementById('serviceStatusInfo');
        if (el) el.innerHTML = '<span class="text-muted">Servis durumu alınamadı.</span>';
    }
}

async function serviceAction(action) {
    const labels = { restart: 'Yeniden başlatılıyor', stop: 'Durduruluyor' };
    const statusEl = document.getElementById('serviceActionStatus');
    if (statusEl) statusEl.textContent = `${labels[action] || action}...`;

    try {
        const hdrs = { 'Content-Type': 'application/json' };
        if (licenseKey) hdrs['x-license-key'] = licenseKey;
        // Admin oturum token'ı — keygen.html'den sessionStorage'a kaydedilir
        const adminTok = (function(){ try { return sessionStorage.getItem('msa_admin_token') || ''; } catch { return ''; } })();
        if (adminTok) hdrs['Authorization'] = 'Bearer ' + adminTok;
        const res = await fetch(`/api/admin/${action}`, {
            method: 'POST',
            headers: hdrs
        });

        // Sunucu bazen yanıt göndermeden çıkabilir (restart); JSON parse hatasına karşı güvenli
        let data = {};
        try { data = await res.json(); } catch (_) { /* yanıt kesintili — devam et */ }

        if (!res.ok) {
            if (statusEl) statusEl.textContent = `Hata: ${data.error || res.status}`;
            return;
        }
        if (statusEl) statusEl.innerHTML = `<span class="u-ok">${esc(data.message || 'İşlem gönderildi.')}</span>`;
        if (action === 'restart') {
            // 7 sn sonra sayfayı yenile (parent kapanma 0.5s + child wait 2s + node startup ~3-4s)
            if (statusEl) statusEl.innerHTML += '<br><span class="text-muted" class="u-xs">Sayfa 7 saniye içinde yeniden yüklenecek...</span>';
            setTimeout(() => location.reload(), 7000);
        }
    } catch (e) {
        // Ağ hatası (sunucu kapalı) bile olsa restart başarılı sayılabilir
        if (action === 'restart') {
            if (statusEl) statusEl.innerHTML = '<span class="u-ok">🔄 Servis yeniden başlatılıyor...</span><br><span class="text-muted" class="u-xs">Sayfa 7 saniye içinde yeniden yüklenecek...</span>';
            setTimeout(() => location.reload(), 7000);
        } else {
            if (statusEl) statusEl.textContent = `Bağlantı hatası: ${e.message}`;
        }
    }
}

async function updateScanMailboxReportMode(imapEmail, reportMode) {
    if (reportMode === 'all' && licenseInfo?.plan !== 'enterprise') {
        alert(_tLit('❌ "Tüm mailler" modu yalnızca Enterprise lisansında kullanılabilir.', '❌ "All emails" report mode requires an Enterprise license.'));
        loadScanMailboxes(); // listeyi sıfırla (select'i geri al)
        return;
    }
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;
        await fetch(`/api/scan-mailboxes/${encodeURIComponent(imapEmail)}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ reportMode })
        });
        loadScanMailboxes();
    } catch (e) {
        console.error('update scan mailbox report mode error:', e);
    }
}

// ============================================================
// ANA SAYFA (HOME PAGE)
// ============================================================
function showPage(page) {
    const homePanel     = document.getElementById('homePanel');
    const statsPanel    = document.getElementById('statsPanel');
    const otxPanel      = document.getElementById('otxApprovalPanel');
    const scanListPanel = document.getElementById('scanListPanel');
    const mainPanels    = ['connectionBar','scanModes','panelUpload','panelPaste',
                           'panelImap','panelScanMailbox','scanProgress','resultsPanel',
                           'historyPanel','listsPanel'];

    const tabHome     = document.getElementById('navTabHome');
    const tabScan     = document.getElementById('navTabScan');
    const tabStats    = document.getElementById('navTabStats');
    const tabOtx      = document.getElementById('navTabOtxApproval');
    const tabScanList = document.getElementById('navTabScanList');

    // Önce her şeyi gizle
    if (homePanel)     homePanel.style.display     = 'none';
    if (statsPanel)    statsPanel.style.display    = 'none';
    if (otxPanel)      otxPanel.style.display      = 'none';
    if (scanListPanel) scanListPanel.style.display = 'none';
    [tabHome, tabScan, tabStats, tabOtx, tabScanList].forEach(t => t && t.classList.remove('active'));
    ['mNavTabHome','mNavTabScan','mNavTabStats','mNavTabOtx','mNavTabScanList'].forEach(id => {
        const el = document.getElementById(id); if (el) el.classList.remove('active');
    });

    if (page === 'home') {
        if (homePanel) homePanel.style.display = '';
        mainPanels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (tabHome) tabHome.classList.add('active');
        const mh = document.getElementById('mNavTabHome'); if (mh) mh.classList.add('active');
        loadHomePage();
    } else if (page === 'stats') {
        if (statsPanel) statsPanel.style.display = '';
        mainPanels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (tabStats) tabStats.classList.add('active');
        const ms = document.getElementById('mNavTabStats'); if (ms) ms.classList.add('active');
        loadStatsPage();
    } else if (page === 'scan-list') {
        if (scanListPanel) scanListPanel.style.display = '';
        mainPanels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (tabScanList) tabScanList.classList.add('active');
        const msl = document.getElementById('mNavTabScanList'); if (msl) msl.classList.add('active');
        scanListInit();
    } else if (page === 'otx-approval') {
        if (otxPanel) otxPanel.style.display = '';
        mainPanels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (tabOtx) tabOtx.classList.add('active');
        const mo = document.getElementById('mNavTabOtx'); if (mo) mo.classList.add('active');
        loadUserFpSuggestions();
    } else {
        mainPanels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
        if (tabScan) tabScan.classList.add('active');
        const ms2 = document.getElementById('mNavTabScan'); if (ms2) ms2.classList.add('active');
    }
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobileNavMenu');
    const btn  = document.getElementById('navHamburger');
    const open = menu.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
}

function closeMobileMenu() {
    const menu = document.getElementById('mobileNavMenu');
    const btn  = document.getElementById('navHamburger');
    menu.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
}

// ─── İSTATİSTİK SAYFASI ───────────────────────────────────
async function loadStatsPage() {
    await Promise.all([_cuLoadStats(), loadDetailedStatsCustomer(), loadLlmUsage()]);
}

// ─── LLM Çağrı İstatistikleri (provider × model bazlı) ──────
async function loadLlmUsage(days = 30) {
    const host = document.getElementById('llmUsageContent');
    if (!host) return;
    try {
        const res = await fetch('/api/stats/llm-usage?days=' + encodeURIComponent(days));
        if (!res.ok) {
            host.innerHTML = '<div style="color:#f87171;font-size:13px">Yüklenemedi</div>';
            return;
        }
        const data = await res.json();
        const lifetime = data.lifetime || [];
        const recent   = data.recent?.byModel || [];
        const trend    = data.recent?.trend || [];

        const recentTotal = recent.reduce((n, r) => n + (r.calls || 0), 0);
        const lifetimeTotal = lifetime.reduce((n, r) => n + (r.calls || 0), 0);

        if (!lifetime.length) {
            host.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px 0">Henüz LLM çağrısı yapılmadı.</div>';
            return;
        }

        // Renk kodu — provider'a göre
        const providerColor = (p) => p === 'openai' ? '#10a37f' : (p === 'anthropic' ? '#d97757' : '#94a3b8');
        const providerLabel = (p) => p === 'openai' ? 'OpenAI' : (p === 'anthropic' ? 'Anthropic' : p);

        // Son 30 gün modeli özet tablosu
        const recentRowsHtml = recent.length
            ? recent.map(r => `
                <tr>
                    <td style="padding:6px 8px;font-size:13px">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${providerColor(r.provider)};margin-right:6px;vertical-align:middle"></span>
                        ${esc(providerLabel(r.provider))}
                    </td>
                    <td style="padding:6px 8px;font-size:13px;color:var(--text-primary);font-family:monospace">${esc(r.model)}</td>
                    <td style="padding:6px 8px;font-size:13px;text-align:right;font-weight:700;color:#e5e7eb">${r.calls}</td>
                    <td style="padding:6px 8px;font-size:13px;text-align:right;color:${r.errors > 0 ? '#f87171' : 'var(--text-secondary)'}">${r.errors}</td>
                </tr>`).join('')
            : '<tr><td colspan="4" style="padding:8px;color:var(--text-secondary);font-size:13px">Bu aralıkta çağrı yok</td></tr>';

        // Lifetime amaç dağılımı
        const purposeStats = {};
        for (const r of lifetime) {
            for (const [p, c] of Object.entries(r.byPurpose || {})) {
                purposeStats[p] = (purposeStats[p] || 0) + c;
            }
        }
        const purposeLabels = { analysis: 'Klasik Analiz', adjudicate: 'AI Hâkim', other: 'Diğer' };
        const purposeChips = Object.entries(purposeStats)
            .sort((a, b) => b[1] - a[1])
            .map(([p, c]) => `<span style="display:inline-block;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.35);color:#c7d2fe;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;margin-right:4px">${esc(purposeLabels[p] || p)}: ${c}</span>`)
            .join('');

        // Trend mini-bar
        const maxDaily = Math.max(1, ...trend.map(t => t.calls));
        const trendBars = trend.map(t => {
            const h = Math.max(2, Math.round((t.calls / maxDaily) * 28));
            return `<div title="${esc(t.date)}: ${t.calls}" style="display:inline-block;width:6px;height:30px;margin-right:1px;vertical-align:bottom;position:relative"><div style="position:absolute;bottom:0;left:0;right:0;height:${h}px;background:linear-gradient(180deg,#6366f1,#4f46e5);border-radius:1px"></div></div>`;
        }).join('');

        host.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px">
                <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px 12px">
                    <div style="font-size:11px;color:#6ee7b7;font-weight:700;letter-spacing:1px">SON ${days} GÜN</div>
                    <div style="font-size:24px;font-weight:900;color:#34d399">${recentTotal} çağrı</div>
                </div>
                <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:10px 12px">
                    <div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1px">TÜM ZAMANLAR</div>
                    <div style="font-size:24px;font-weight:900;color:#818cf8">${lifetimeTotal} çağrı</div>
                </div>
            </div>

            <div style="margin-bottom:12px;font-size:12px;color:var(--text-secondary)">
                <b style="color:var(--text-primary)">Amaç dağılımı:</b> ${purposeChips || '-'}
            </div>

            ${trend.length ? `
            <div class="u-mb14">
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">Günlük çağrı trendi (son ${days} gün)</div>
                <div style="background:#0b1220;border:1px solid var(--border);border-radius:6px;padding:10px;line-height:0">${trendBars}</div>
            </div>
            ` : ''}

            <div style="overflow:auto">
                <table style="width:100%;border-collapse:collapse">
                    <thead>
                        <tr style="background:rgba(99,102,241,0.06);color:#a5b4fc;font-size:11px;letter-spacing:1px;text-transform:uppercase">
                            <th style="padding:8px;text-align:left">Sağlayıcı</th>
                            <th style="padding:8px;text-align:left">Model</th>
                            <th style="padding:8px;text-align:right">Çağrı</th>
                            <th style="padding:8px;text-align:right">Hata</th>
                        </tr>
                    </thead>
                    <tbody>${recentRowsHtml}</tbody>
                </table>
            </div>
        `;
    } catch (e) {
        host.innerHTML = `<div style="color:#f87171;font-size:13px">Hata: ${esc(e.message)}</div>`;
    }
}

// Hızlı preset hesaplayıcı — hem üst butonlar (setStatsRange) hem alt dropdown (onCuStatsRangeChange) kullanır
function _statsQuickPreset(key) {
    const fmt = d => d.toISOString().slice(0, 10);
    switch (key) {
        case 'today': {
            const t = new Date();
            return { start: fmt(t), end: fmt(t), btnId: 'rangeBtnToday' };
        }
        case 'yesterday': {
            const y = new Date(Date.now() - 86400000);
            return { start: fmt(y), end: fmt(y), btnId: 'rangeBtnYesterday' };
        }
        case 'thisWeek': {
            // Pazartesi → bugün (TR alışkanlığı: hafta Pzt başlar)
            const today = new Date();
            const day   = today.getDay();              // 0=Paz, 1=Pzt
            const diff  = day === 0 ? 6 : day - 1;
            const monday = new Date(Date.now() - diff * 86400000);
            return { start: fmt(monday), end: fmt(today), btnId: 'rangeBtnThisWeek' };
        }
        case 'thisMonth': {
            const now = new Date();
            const first = new Date(now.getFullYear(), now.getMonth(), 1);
            return { start: fmt(first), end: fmt(now), btnId: 'rangeBtnThisMonth' };
        }
        case 'lastMonth': {
            const now = new Date();
            const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const last  = new Date(now.getFullYear(), now.getMonth(), 0);
            return { start: fmt(first), end: fmt(last), btnId: 'rangeBtnLastMonth' };
        }
        default:
            return null;
    }
}

// Üst tarih aralığı butonları — hem özet hem ayrıntılı raporu aynı aralıkla yükler
function setStatsRange(value) {
    // Aktif buton stil güncelleme — tüm range butonları
    const allKeys = ['Today','Yesterday','ThisWeek','ThisMonth','LastMonth','7','30','90','365','Custom'];
    allKeys.forEach(k => {
        const btn = document.getElementById('rangeBtn' + k);
        if (btn) btn.style.borderColor = '';
    });
    const wrap = document.getElementById('topRangeWrap');
    const fmt = d => d.toISOString().slice(0, 10);

    const preset = _statsQuickPreset(value);
    if (preset) {
        const btn = document.getElementById(preset.btnId);
        if (btn) btn.style.borderColor = 'var(--accent)';
        if (wrap) wrap.style.display = 'none';
        // Alt bölüm dropdown'unu custom + tarihlerle senkronla
        const sel = document.getElementById('cuStatsDays');
        if (sel) sel.value = 'custom';
        const subWrap = document.getElementById('cuCustomRangeWrap');
        if (subWrap) subWrap.style.display = 'inline-flex';
        const sIn = document.getElementById('cuStatsStart');
        const eIn = document.getElementById('cuStatsEnd');
        if (sIn) sIn.value = preset.start;
        if (eIn) eIn.value = preset.end;
        // Hem üst kartlar hem ayrıntılı rapor aynı aralıkla
        _cuLoadStatsRanged(preset.start, preset.end);
        loadDetailedStatsCustomer();
        return;
    }

    if (value === 'custom') {
        const btn = document.getElementById('rangeBtnCustom');
        if (btn) btn.style.borderColor = 'var(--accent)';
        // Default 30 gün önce → bugün
        const sIn = document.getElementById('topStatsStart');
        const eIn = document.getElementById('topStatsEnd');
        if (sIn && !sIn.value) sIn.value = fmt(new Date(Date.now() - 30 * 86400000));
        if (eIn && !eIn.value) eIn.value = fmt(new Date());
        if (wrap) wrap.style.display = '';
        return;
    }

    // Preset gün sayısı (7/30/90/365)
    if (wrap) wrap.style.display = 'none';
    const days = String(value);
    const btn  = document.getElementById('rangeBtn' + days);
    if (btn) btn.style.borderColor = 'var(--accent)';

    // Alttaki dropdown'u senkronla
    const sel = document.getElementById('cuStatsDays');
    if (sel) {
        const has = Array.from(sel.options).some(o => o.value === days);
        sel.value = has ? days : '30';
        const subWrap = document.getElementById('cuCustomRangeWrap');
        if (subWrap) subWrap.style.display = 'none';
    }
    loadStatsPage();
}

function applyTopCustomRange() {
    const start = document.getElementById('topStatsStart')?.value;
    const end   = document.getElementById('topStatsEnd')?.value;
    const status = document.getElementById('topRangeStatus');
    if (!start || !end) { if (status) status.textContent = '⚠ Başlangıç ve bitiş tarihini girin.'; return; }
    if (start > end)    { if (status) status.textContent = '⚠ Başlangıç bitişten sonra olamaz.'; return; }
    if (status) status.textContent = '';

    // Alttaki Ayrıntılı Rapor seçicisini "Özel aralık" + aynı tarihlerle senkronla
    const sel = document.getElementById('cuStatsDays');
    if (sel) sel.value = 'custom';
    const subWrap = document.getElementById('cuCustomRangeWrap');
    if (subWrap) subWrap.style.display = 'inline-flex';
    const sIn = document.getElementById('cuStatsStart');
    const eIn = document.getElementById('cuStatsEnd');
    if (sIn) sIn.value = start;
    if (eIn) eIn.value = end;

    // Hem özet (üst) hem ayrıntılı (alt) custom range'i kullansın
    _cuLoadStatsRanged(start, end);
    loadDetailedStatsCustomer();
}

async function _cuLoadStatsRanged(start, end) {
    // /api/stats yalnızca toplamları döndürür (range desteği yok); şimdilik
    // /api/stats/detailed sonuçlarından özet kartlar için tekrar render yap.
    try {
        const res = await fetch(`/api/stats/detailed?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
        if (!res.ok) return;
        const d = await res.json();
        // detailed'dan üst kartlara minimal projeksiyon
        _cuRenderStatsCards({
            totalScans: d.totalScans, todayScans: '-', monthlyScans: d.totalScans,
            threats: d.byLevel?.high || 0, accounts: '-'
        });
        _cuRenderLevelBars(d.byLevel || {});
        _cuRenderSourceBars((d.bySource || []).reduce((acc, x) => { acc[x.source] = x.count; return acc; }, {}));
        // 7-gün trend ile haftalık dağılımı korumak için tüm range'i hourly'den türetmek pahalı —
        // şimdilik trend'i yenilemiyoruz (alt blokta detaylı zaten var)
    } catch {}
}

async function _cuLoadStats() {
    try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const d = await res.json();
        _cuRenderStatsCards(d);
        _cuRenderLevelBars(d.byLevel || {});
        _cuRenderSourceBars(d.bySource || {});
        _cuRenderTrend(d.trend7 || []);
        _cuRenderIntegrations(d);
        _cuRenderCategories(d.topCategories || []);
    } catch (e) { console.error('stats load:', e); }
}

function _cuRenderStatsCards(d) {
    const threatColor = d.threats > 0 ? '#f87171' : 'var(--green)';
    document.getElementById('cuStatsCards').innerHTML = `
        <div class="stat-card"><div class="stat-value">${d.totalScans ?? 0}</div><div class="stat-label">Toplam Tarama</div></div>
        <div class="stat-card"><div class="stat-value">${d.todayScans ?? 0}</div><div class="stat-label">Bugün</div></div>
        <div class="stat-card"><div class="stat-value">${d.monthlyScans ?? 0}</div><div class="stat-label">Bu Ay</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${threatColor}">${d.threats ?? 0}</div><div class="stat-label">Yüksek Riskli</div></div>
        <div class="stat-card"><div class="stat-value">${d.accounts ?? 0}</div><div class="stat-label">IMAP Hesabı</div></div>
    `;
}

function _cuBar(label, count, total, color) {
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span>${esc(label)}</span>
            <span style="font-weight:600">${count} <span style="color:var(--text-secondary);font-weight:400">(${pct}%)</span></span>
        </div>
        <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .4s"></div>
        </div>
    </div>`;
}

function _cuRenderLevelBars(byLevel) {
    const total = Object.values(byLevel).reduce((a, b) => a + b, 0);
    const items = [
        { key: 'high',   label: '🔴 Yüksek Risk', color: '#f87171' },
        { key: 'medium', label: '🟠 Orta Risk',   color: '#fb923c' },
        { key: 'low',    label: '🟡 Düşük Risk',  color: '#fbbf24' },
        { key: 'safe',   label: '🟢 Güvenli',     color: '#34d399' }
    ];
    document.getElementById('cuStatsLevelBars').innerHTML =
        items.map(i => _cuBar(i.label, byLevel[i.key] || 0, total, i.color)).join('') ||
        '<p class="text-muted">Henüz tarama yok.</p>';
}

function _cuRenderSourceBars(bySource) {
    const labels = {
        'upload':       '📤 Yükleme (EML/Dosya)',
        'imap-manual':  '🔍 IMAP Manuel',
        'scan-mailbox': '📬 Tarama Posta Kutusu',
        'unknown':      '❓ Bilinmiyor'
    };
    const total   = Object.values(bySource).reduce((a, b) => a + b, 0);
    const entries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        document.getElementById('cuStatsSourceBars').innerHTML = '<p class="text-muted">Henüz tarama yok.</p>';
        return;
    }
    document.getElementById('cuStatsSourceBars').innerHTML =
        entries.map(([src, cnt]) => _cuBar(labels[src] || src, cnt, total, 'var(--accent)')).join('');
}

function _cuRenderTrend(trend7) {
    if (!trend7.length) {
        document.getElementById('cuStatsTrend').innerHTML = '<p class="text-muted">Veri yok.</p>';
        return;
    }
    const max = Math.max(...trend7.map(t => t.count), 1);
    const bars = trend7.map(t => {
        const h = Math.max(4, Math.round(t.count / max * 80));
        const dateLabel = new Date(t.date).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
            <span style="font-size:11px;font-weight:600;color:${t.count > 0 ? 'var(--accent)' : 'var(--text-secondary)'}">${t.count}</span>
            <div style="width:100%;background:var(--surface2);border-radius:3px;height:80px;display:flex;align-items:flex-end">
                <div style="width:100%;height:${h}px;background:var(--accent);border-radius:3px;opacity:${t.count > 0 ? 1 : 0.2}"></div>
            </div>
            <span style="font-size:10px;color:var(--text-secondary);white-space:nowrap">${dateLabel}</span>
        </div>`;
    }).join('');
    document.getElementById('cuStatsTrend').innerHTML =
        `<div style="display:flex;gap:6px;align-items:flex-end;padding:4px 0">${bars}</div>`;
}

function _cuRenderIntegrations(d) {
    const total  = d.totalScans || 0;
    const vtPct  = total > 0 ? (d.vtHits  / total * 100).toFixed(1) : '0.0';
    const otxPct = total > 0 ? (d.otxHits / total * 100).toFixed(1) : '0.0';
    const abusePct = total > 0 ? (d.abuseHits / total * 100).toFixed(1) : '0.0';
    document.getElementById('cuStatsIntegrations').innerHTML = `
        <div class="u-mb14">
            <div style="cursor:pointer;user-select:none" onclick="showVtDetections()" title="Tespit edilen dosya ve antivirüsleri görüntüle">
                ${_cuBar('🔍 Tespit Edilen Tehdit Tipleri  ↗', d.vtHits || 0, total || 1, '#f87171')}
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:-6px">
                İsabet oranı: ${vtPct}%
                ${d.vtHits > 0 ? `<span style="margin-left:8px;color:#f87171;cursor:pointer;text-decoration:underline" onclick="showVtDetections()">tespit listesi →</span>` : ''}
            </div>
        </div>
        <div>
            <div style="cursor:pointer;user-select:none" onclick="showOtxDomainList()" title="Tespit edilen domainleri görüntüle">
                ${_cuBar('🌐 AlienVault OTX Tespiti  ↗', d.otxHits || 0, total || 1, '#fb923c')}
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:-6px">
                İsabet oranı: ${otxPct}%
                ${d.otxHits > 0 ? `<span style="margin-left:8px;color:#fb923c;cursor:pointer;text-decoration:underline" onclick="showOtxDomainList()">domain listesi →</span>` : ''}
            </div>
        </div>
        <div>
            ${_cuBar('🔗 Link Tarama Motoru Tespiti', d.abuseHits || 0, total || 1, '#f59e0b')}
            <div style="font-size:11px;color:var(--text-secondary);margin-top:-6px">
                İsabet oranı: ${abusePct}%
            </div>
        </div>
    `;
}

// ─── LİSTE DETAY MODALİ ──────────────────────────────────
let _listDetailEscHandler = null;
function _openListDetailModal(title) {
    const overlay = document.getElementById('listDetailModal');
    const titleEl = document.getElementById('listDetailModalTitle');
    const body    = document.getElementById('listDetailModalBody');
    if (!overlay || !titleEl || !body) return null;
    titleEl.textContent = title;
    body.innerHTML = '<p style="color:var(--text-secondary);padding:20px 0">⏳ Yükleniyor…</p>';
    overlay.classList.remove('hidden');
    if (_listDetailEscHandler) document.removeEventListener('keydown', _listDetailEscHandler);
    _listDetailEscHandler = (e) => { if (e.key === 'Escape') closeListDetailModal(); };
    document.addEventListener('keydown', _listDetailEscHandler);
    return body;
}
function closeListDetailModal() {
    const overlay = document.getElementById('listDetailModal');
    if (overlay) overlay.classList.add('hidden');
    if (_listDetailEscHandler) {
        document.removeEventListener('keydown', _listDetailEscHandler);
        _listDetailEscHandler = null;
    }
}

// ─── VIRUSTOTAl TESPİT LİSTESİ ───────────────────────────
async function showVtDetections() {
    const body = _openListDetailModal('🔍 Tespit Edilen Tehdit Tipleri');
    if (!body) return;
    try {
        const headers = licenseKey ? { 'x-license-key': licenseKey } : {};
        const res = await fetch('/api/stats/vt-detections', { headers });
        if (!res.ok) { body.innerHTML = '<p class="u-err">Veriler yüklenemedi.</p>'; return; }
        const list = await res.json();
        _cuRenderVtDetections(body, list);
    } catch (e) {
        body.innerHTML = `<p class="u-err">Hata: ${esc(e.message)}</p>`;
    }
}

function _cuRenderVtDetections(panel, list) {
    if (!list.length) {
        panel.innerHTML = '<p style="font-size:12px;color:var(--text-secondary);padding:8px 0">AntiVirüs tespiti bulunamadı.</p>';
        return;
    }

    const cards = list.map(item => {
        const scanDate = item.timestamp ? new Date(item.timestamp).toLocaleString('tr-TR', { dateStyle:'short', timeStyle:'short' }) : '—';
        const emailDate = item.email.date ? new Date(item.email.date).toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'2-digit' }) : '—';
        const ratio = item.total > 0 ? `${item.malicious + item.suspicious}/${item.total}` : '—';
        const ratioColor = item.malicious > 0 ? '#f87171' : '#fb923c';

        // Engine satırları: motor adı + virus/tespit adı
        const engineRows = item.engines.slice(0, 12).map(e => {
            const dot = e.type === 'malicious' ? '🔴' : '🟠';
            return `<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px">
                <span style="min-width:14px">${dot}</span>
                <span style="min-width:120px;color:var(--text-secondary);flex-shrink:0">${esc(e.engine)}</span>
                <span style="color:#fde68a;word-break:break-all">${esc(e.result)}</span>
            </div>`;
        }).join('');
        const moreEngines = item.engines.length > 12
            ? `<div style="font-size:11px;color:var(--text-secondary);padding:4px 0">… ve ${item.engines.length - 12} motor daha</div>`
            : '';

        const vtLink = item.link
            ? `<a href="${esc(item.link)}" target="_blank" style="font-size:11px;color:#60a5fa;text-decoration:none" title="Antivirüs raporunu aç">🔗 Rapor</a>`
            : '';

        const scanLink = item.scanId
            ? `<span style="font-size:11px;color:#60a5fa;cursor:pointer;text-decoration:underline" onclick="openHistoryResult('${esc(item.scanId)}');showPage('scan')" title="Taramayı aç">📋 Taramayı aç</span>`
            : '';

        return `
        <div style="background:var(--surface2);border:1px solid rgba(248,113,113,0.2);border-radius:10px;padding:12px;margin-bottom:10px">

            <!-- Dosya başlığı -->
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
                <div style="font-size:22px;line-height:1">📎</div>
                <div class="u-flex1-0">
                    <div style="font-weight:700;font-size:13px;color:#f8fafc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.filename)}">${esc(item.filename)}</div>
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${esc(item.fileType || '—')}</div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                    <div style="font-size:18px;font-weight:800;color:${ratioColor}">${ratio}</div>
                    <div style="font-size:10px;color:var(--text-secondary)">motordan</div>
                </div>
            </div>

            <!-- E-posta bilgisi -->
            <div style="background:rgba(0,0,0,0.2);border-radius:7px;padding:8px 10px;margin-bottom:10px;font-size:12px">
                <div style="display:flex;gap:6px;align-items:baseline;margin-bottom:3px">
                    <span style="color:var(--text-secondary);min-width:50px">📧 Kimden:</span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.email.fromName ? `${item.email.fromName} <${item.email.from}>` : item.email.from)}</span>
                </div>
                <div style="display:flex;gap:6px;align-items:baseline;margin-bottom:3px">
                    <span style="color:var(--text-secondary);min-width:50px">📌 Konu:</span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic">${esc(item.email.subject)}</span>
                </div>
                <div style="display:flex;gap:6px;align-items:baseline">
                    <span style="color:var(--text-secondary);min-width:50px">📅 Tarih:</span>
                    <span>${emailDate}</span>
                    <span style="color:var(--text-secondary);margin-left:auto">${vtLink} &nbsp; ${scanLink}</span>
                </div>
            </div>

            <!-- Antivirüs motorları -->
            <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">
                🛡️ Antivirüs Tespitleri (${item.engines.length} motor)
            </div>
            <div style="background:rgba(0,0,0,0.15);border-radius:6px;padding:6px 8px;max-height:220px;overflow-y:auto">
                ${engineRows}${moreEngines}
            </div>
        </div>`;
    }).join('');

    panel.innerHTML = `
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">
            ${list.length} zararlı/şüpheli ek tespiti — en fazla motor tespitinden sıralı
        </div>
        ${cards}
    `;
}

async function showOtxDomainList() {
    const body = _openListDetailModal('🌐 AlienVault OTX — Tespit Edilen Domain / Hostname Listesi');
    if (!body) return;
    try {
        const headers = licenseKey ? { 'x-license-key': licenseKey } : {};
        const res = await fetch('/api/stats/otx-domains', { headers });
        if (!res.ok) { body.innerHTML = '<p class="u-err">Veriler yüklenemedi.</p>'; return; }
        const list = await res.json();
        _cuRenderOtxDomainList(body, list);
    } catch (e) {
        body.innerHTML = `<p class="u-err">Hata: ${esc(e.message)}</p>`;
    }
}

function _cuRenderOtxDomainList(panel, list) {
    if (!list.length) {
        panel.innerHTML = '<p style="font-size:12px;color:var(--text-secondary);padding:8px 0">OTX tespit kaydı bulunamadı.</p>';
        return;
    }
    const sevColor = { critical: '#f87171', warning: '#fb923c' };
    const sevIcon  = { critical: '🔴', warning: '🟠' };
    const rows = list.map(item => {
        const color   = sevColor[item.severity] || '#94a3b8';
        const icon    = sevIcon[item.severity]  || '⚠️';
        const lastDate = item.lastSeen ? new Date(item.lastSeen).toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'2-digit' }) : '—';
        const countBadge = item.count > 1
            ? `<span style="font-size:10px;background:rgba(251,146,60,0.15);color:#fb923c;border-radius:4px;padding:2px 6px;margin-left:6px">${item.count}×</span>`
            : '';
        return `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-radius:8px;background:var(--surface2);margin-bottom:6px;font-size:12px">
            <span style="font-size:15px;padding-top:1px">${icon}</span>
            <div class="u-flex1-0">
                <div style="font-weight:700;color:${color};margin-bottom:2px">
                    ${esc(item.domain)}${countBadge}
                </div>
                <div style="font-size:11px;color:var(--text-secondary);line-height:1.5;word-break:break-word">${esc(item.message)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
                <span style="font-size:10px;color:var(--text-secondary);white-space:nowrap">${lastDate}</span>
                <button onclick="reportFpFromStats('${esc(item.domain)}','${esc(item.severity)}','${esc(item.message)}')" title="Yanlış pozitif olarak bildir" style="background:transparent;border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#94a3b8;font-size:10px;padding:3px 7px;cursor:pointer;white-space:nowrap">⚠️ Yanlış pozitif</button>
            </div>
        </div>`;
    }).join('');
    panel.innerHTML = `
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">
            ${list.length} benzersiz domain/hostname tespit edildi — en çok tekrarlananlar üstte
        </div>
        ${rows}
    `;
}

async function reportFpFromStats(domain, severity, message) {
    if (!domain) return;
    const ok = await showConfirm({
        title: 'Yanlış Pozitif Raporu',
        message: `"${domain}" için yanlış pozitif raporu gönderilsin mi?\nAdmin onayından sonra güvenilir listeye eklenir.`,
        confirmText: 'Gönder', cancelText: 'Vazgeç'
    });
    if (!ok) return;
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const res = await fetch('/api/fp-suggestions', {
            method: 'POST',
            headers,
            body: JSON.stringify({ domain, message, severity, category: 'otx' })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(`⚠️ ${data.error || 'Gönderilemedi.'}`);
            return;
        }
        if (data.alreadyDecided) {
            if (data.status === 'approved') {
                alert(`✅ "${domain}" zaten güvenilir listede (onaylı). Tekrar eklenmesi gerekmiyor.`);
            } else {
                alert(`ℹ️ "${domain}" daha önce reddedilmiş. Lütfen yöneticinize danışın.`);
            }
        } else if (data.incremented) {
            alert(`✅ "${domain}" için rapor güncellendi (bildirim sayısı artırıldı). Admin onayını bekliyor.`);
        } else {
            alert(`✅ "${domain}" yanlış pozitif olarak raporlandı. Admin onayını bekliyor.`);
        }
    } catch (e) {
        alert(`Hata: ${e.message}`);
    }
}

// ══════════════════════════════════════════════════════════
// KULLANICI — OTX GÜVENİLİR DOMAİN EXPORT / IMPORT
// ══════════════════════════════════════════════════════════
async function loadUserFpSuggestions() {
    const listEl = document.getElementById('userFpApprovalList');
    const statusEl = document.getElementById('userFpApprovalStatus');
    if (!listEl) return;

    if (statusEl) statusEl.textContent = 'Yükleniyor...';
    listEl.innerHTML = '';

    try {
        const headers = licenseKey ? { 'x-license-key': licenseKey } : {};
        const res = await fetch('/api/fp-suggestions', { headers });
        const data = await res.json();
        if (!res.ok) {
            listEl.innerHTML = `<div class="imap-report-empty error">${esc(data.error || 'OTX onay listesi alınamadı.')}</div>`;
            if (statusEl) statusEl.textContent = '';
            return;
        }
        renderUserFpSuggestions(Array.isArray(data) ? data : []);
    } catch (e) {
        listEl.innerHTML = `<div class="imap-report-empty error">${esc(e.message)}</div>`;
        if (statusEl) statusEl.textContent = '';
    }
}

function renderUserFpSuggestions(items) {
    const listEl = document.getElementById('userFpApprovalList');
    const statusEl = document.getElementById('userFpApprovalStatus');
    if (!listEl) return;

    if (!items.length) {
        if (statusEl) statusEl.textContent = 'Bekleyen OTX yanlış pozitif önerisi yok.';
        listEl.innerHTML = '<div class="imap-report-empty">Onay bekleyen domain bulunmuyor.</div>';
        return;
    }

    if (statusEl) statusEl.textContent = `${items.length} domain onay bekliyor.`;
    listEl.innerHTML = items.map((item) => {
        const count = Number(item.report_count || 1);
        const lastSeen = item.last_seen_at
            ? new Date(item.last_seen_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
            : '-';
        const severity = item.finding_severity || 'warning';
        const severityColor = severity === 'critical' ? '#f87171' : '#fb923c';
        return `
            <div style="display:flex;align-items:flex-start;gap:12px;padding:14px;border:1px solid rgba(255,255,255,0.08);background:var(--surface2);border-radius:8px;margin-bottom:10px">
                <div class="finding-icon ${esc(severity)}" style="flex-shrink:0">${findingIcon(severity)}</div>
                <div class="u-flex1-0">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
                        <strong style="color:${severityColor};word-break:break-all">${esc(item.domain)}</strong>
                        <span style="font-size:10px;background:rgba(251,146,60,0.15);color:#fb923c;border-radius:4px;padding:2px 6px">${count} bildirim</span>
                    </div>
                    <div class="finding-category">${esc(formatCategory(item.finding_category || 'otx'))} · ${esc(severity)} · Son: ${esc(lastSeen)}</div>
                    <div class="finding-text" style="margin-top:6px">${esc(item.finding_message || 'OTX yanlış pozitif olarak bildirildi.')}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
                    <button class="btn btn-primary btn-sm" onclick='userApproveFp(${jsString(item.domain)})'>Onayla</button>
                    <button class="btn btn-ghost btn-sm" onclick='userRejectFp(${jsString(item.domain)})'>Reddet</button>
                </div>
            </div>
        `;
    }).join('');
}

async function userApproveFp(domain) {
    if (!domain) return;
    const ok = await showConfirm({
        title: 'OTX Domain Onayı',
        message: `"${domain}" güvenilir domain listesine eklensin mi?\n\nOnaydan sonra bu domain OTX tehdidi olarak değerlendirilmez.`,
        confirmText: 'Onayla',
        cancelText: 'İptal',
        icon: '🛡️'
    });
    if (!ok) return;

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const res = await fetch(`/api/fp-suggestions/${encodeURIComponent(domain)}/approve`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ category: 'custom', note: 'Kullanıcı OTX onayı' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        showToast(`"${domain}" güvenilir listeye eklendi.`, 'success', { title: 'OTX onaylandı' });
        loadUserFpSuggestions();
    } catch (e) {
        showToast(e.message, 'error', { title: 'OTX onayı başarısız' });
    }
}

async function userRejectFp(domain) {
    if (!domain) return;
    const ok = await showConfirm({
        title: 'OTX Önerisini Reddet',
        message: `"${domain}" için yanlış pozitif önerisi reddedilsin mi?`,
        confirmText: 'Reddet',
        cancelText: 'İptal',
        icon: '⚠️'
    });
    if (!ok) return;

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const res = await fetch(`/api/fp-suggestions/${encodeURIComponent(domain)}/reject`, {
            method: 'POST',
            headers
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
        showToast(`"${domain}" önerisi reddedildi.`, 'info', { title: 'OTX önerisi kapatıldı' });
        loadUserFpSuggestions();
    } catch (e) {
        showToast(e.message, 'error', { title: 'Reddetme başarısız' });
    }
}

let _userTdBackup = null; // sıfırlama öncesi otomatik yedek (bellek)

/** Ayarlar açıldığında domain sayısını göster */
async function loadUserTdCount() {
    const countEl = document.getElementById('userTdExportCount');
    if (!countEl) return;
    try {
        const headers = licenseKey ? { 'x-license-key': licenseKey } : {};
        const res = await fetch('/api/trusted-domains/export', { headers });
        if (!res.ok) return;
        const data = await res.json();
        countEl.textContent = `(${data.count || 0} domain)`;
    } catch { /* sessiz */ }
}

/** Mevcut listeyi JSON dosyası olarak indirir */
async function userTdExport() {
    const statusEl = document.getElementById('userTdExportStatus');
    try {
        if (statusEl) { statusEl.style.display = ''; statusEl.textContent = '⏳ İndiriliyor…'; }
        const headers = licenseKey ? { 'x-license-key': licenseKey } : {};
        const res = await fetch('/api/trusted-domains/export', { headers });
        if (!res.ok) {
            if (statusEl) { statusEl.textContent = '❌ Hata: ' + res.status; setTimeout(() => { statusEl.style.display = 'none'; }, 4000); }
            else alert('Dışa aktarma başarısız: ' + res.status);
            return;
        }
        const blob = await res.blob();
        const cd   = res.headers.get('Content-Disposition') || '';
        const fnMatch = cd.match(/filename="([^"]+)"/);
        const filename = fnMatch ? fnMatch[1] : 'trusted-domains.json';
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 150);
        if (statusEl) { statusEl.textContent = '✅ İndirildi'; setTimeout(() => { statusEl.style.display = 'none'; }, 3000); }
    } catch (e) {
        if (statusEl) { statusEl.textContent = '❌ ' + e.message; setTimeout(() => { statusEl.style.display = 'none'; }, 4000); }
        else alert('Hata: ' + e.message);
    }
}

/** Dosya seçildiğinde ya da butonla tetiklendiğinde import başlatır */
async function userTdImport(inputEl) {
    const input   = inputEl || document.getElementById('userTdImportFile');
    const resetCk = document.getElementById('userTdResetCheck');
    const resEl   = document.getElementById('userTdImportResult');
    const restoreBtn = document.getElementById('btnUserTdRestore');
    const file    = input?.files[0];
    if (!file) { _userTdShowResult(resEl, false, '❌ Lütfen önce bir dosya seçin.'); return; }

    const doReset = resetCk?.checked || false;
    _userTdShowResult(resEl, null, '⏳ İşleniyor…');

    try {
        // Dosyayı oku ve parse et
        const text    = await file.text();
        const payload = JSON.parse(text);
        const domains = Array.isArray(payload) ? payload
            : (Array.isArray(payload.domains) ? payload.domains : null);
        if (!domains || !domains.length) {
            _userTdShowResult(resEl, false, '❌ Geçerli domain listesi bulunamadı.'); return;
        }

        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;

        if (doReset) {
            // — Adım 1: Mevcut listeyi yedekle (otomatik indir + bellekte sakla) —
            _userTdShowResult(resEl, null, '⏳ Mevcut liste yedekleniyor…');
            const backupRes = await fetch('/api/trusted-domains/export', {
                headers: licenseKey ? { 'x-license-key': licenseKey } : {}
            });
            if (backupRes.ok) {
                const backupData = await backupRes.json();
                _userTdBackup = backupData.domains || [];
                // Dosyayı otomatik indir
                const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
                const bkFilename = `mailtrustai-trusted-domains-onceki-yedek-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
                const bkUrl = URL.createObjectURL(blob);
                const bkA   = document.createElement('a');
                bkA.href = bkUrl; bkA.download = bkFilename;
                document.body.appendChild(bkA);
                bkA.click();
                bkA.remove();
                setTimeout(() => URL.revokeObjectURL(bkUrl), 150);
                if (restoreBtn) restoreBtn.style.display = '';
            }
            _userTdShowResult(resEl, null, '⏳ Liste sıfırlanıyor ve yeni domainler ekleniyor…');
        }

        // — Adım 2: Import (merge=false → sıfırla, merge=true → sadece ekle) —
        const res = await fetch('/api/trusted-domains/import', {
            method: 'POST', headers,
            body: JSON.stringify({ domains, merge: !doReset })
        });
        const data = await res.json();
        if (!res.ok) { _userTdShowResult(resEl, false, '❌ ' + (data.error || res.status)); return; }

        const added   = data.accepted?.length || 0;
        const skipped = data.rejected?.length || 0;
        const msg = doReset
            ? `✅ Liste sıfırlandı. ${added} domain yüklendi${skipped ? `, ${skipped} geçersiz atlandı` : ''}. Önceki yedeğiniz otomatik indirildi.`
            : `✅ ${added} domain eklendi${skipped ? `, ${skipped} geçersiz atlandı` : ''}. Mevcut domainlerinize dokunulmadı.`;
        _userTdShowResult(resEl, true, msg);
        loadUserTdCount();

        // Input'u temizle
        input.value = '';
        const nameEl = document.getElementById('userTdFileName');
        if (nameEl) nameEl.textContent = 'Dosya seçilmedi';
        if (resetCk) resetCk.checked = false;

    } catch (e) {
        _userTdShowResult(resEl, false, '❌ ' + e.message);
    }
}

/** Son otomatik yedekten geri yükle */
async function userTdRestoreBackup() {
    if (!_userTdBackup || !_userTdBackup.length) {
        alert('Geri dönülecek yedek bulunamadı. Sayfayı yenilediyseniz yedek kaybolmuş olabilir.\nDosya olarak indirdiğiniz yedeği "İçe Aktar" ile yükleyin.'); return;
    }
    const ok = await showConfirm({
        title: 'Yedeği Geri Yükle',
        message: `${_userTdBackup.length} domainlik önceki listeye dönmek istiyor musunuz?\n\nBu işlem mevcut listeyi temizleyip yedeği geri yükleyecek.`,
        confirmText: 'Geri Yükle', cancelText: 'Vazgeç', danger: true
    });
    if (!ok) return;

    const resEl  = document.getElementById('userTdImportResult');
    _userTdShowResult(resEl, null, '⏳ Önceki listeye dönülüyor…');

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const res = await fetch('/api/trusted-domains/import', {
            method: 'POST', headers,
            body: JSON.stringify({ domains: _userTdBackup, merge: false })
        });
        const data = await res.json();
        if (!res.ok) { _userTdShowResult(resEl, false, '❌ ' + (data.error || res.status)); return; }
        _userTdBackup = null;
        const restoreBtn = document.getElementById('btnUserTdRestore');
        if (restoreBtn) restoreBtn.style.display = 'none';
        _userTdShowResult(resEl, true, `✅ Önceki listeye geri dönüldü. ${data.accepted?.length || 0} domain yüklendi.`);
        loadUserTdCount();
    } catch (e) {
        _userTdShowResult(resEl, false, '❌ ' + e.message);
    }
}

function _userTdShowResult(el, ok, msg) {
    if (!el) return;
    el.style.display = '';
    if (ok === null) { // loading
        el.style.background = 'rgba(99,102,241,0.1)';
        el.style.color = '#a5b4fc';
    } else if (ok) {
        el.style.background = 'rgba(16,185,129,0.12)';
        el.style.color = '#34d399';
    } else {
        el.style.background = 'rgba(239,68,68,0.12)';
        el.style.color = '#f87171';
    }
    el.textContent = msg;
}

function _cuRenderCategories(cats) {
    if (!cats.length) {
        document.getElementById('cuStatsCategories').innerHTML = '<p class="text-muted">Henüz tehdit kaydı yok.</p>';
        return;
    }
    const catLabels = {
        virusTotal:  '🔍 Tespit Edilen Tehdit Tipleri', otx: '🌐 OTX',
        abuse: '🔗 Link Tarama Motoru',
        spf: '📋 SPF', dkim: '🔏 DKIM', dmarc: '🛡️ DMARC',
        phishing: '🎣 Phishing', attachment: '📎 Şüpheli Ek',
        link: '🔗 Şüpheli Link', spoofing: '🎭 Sahtecilik',
        unicode: '🔤 Unicode', threatIntel: '🌍 Tehdit İstihbaratı',
        reputation: '📊 İtibar', content: '📝 İçerik', header: '📨 Header'
    };
    const maxCnt = cats[0]?.count || 1;
    document.getElementById('cuStatsCategories').innerHTML =
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">` +
        cats.map(({ category, count }) =>
            _cuBar(catLabels[category] || category, count, maxCnt, 'var(--accent)')
        ).join('') + `</div>`;
}

// ─── AYRINTILI RAPOR ──────────────────────────────────────
let _cuLastDetailed = null;

function onCuStatsRangeChange() {
    const sel  = document.getElementById('cuStatsDays');
    const wrap = document.getElementById('cuCustomRangeWrap');
    if (!sel || !wrap) return;

    // Hızlı preset (today/yesterday/thisWeek/thisMonth/lastMonth)
    const preset = _statsQuickPreset(sel.value);
    if (preset) {
        // Dropdown 'custom' moduna alınıp tarihler doldurulur — loadDetailedStatsCustomer custom'tan tarih okuyor
        sel.value = 'custom';
        const sIn = document.getElementById('cuStatsStart');
        const eIn = document.getElementById('cuStatsEnd');
        if (sIn) sIn.value = preset.start;
        if (eIn) eIn.value = preset.end;
        wrap.style.display = 'inline-flex';
        loadDetailedStatsCustomer();
        return;
    }

    if (sel.value === 'custom') {
        // Default: son 30 gün
        const end   = new Date();
        const start = new Date(Date.now() - 30 * 86400000);
        const fmt   = d => d.toISOString().slice(0, 10);
        const eIn   = document.getElementById('cuStatsEnd');
        const sIn   = document.getElementById('cuStatsStart');
        if (eIn && !eIn.value) eIn.value = fmt(end);
        if (sIn && !sIn.value) sIn.value = fmt(start);
        wrap.style.display = 'inline-flex';
        // Custom seçildi — kullanıcı "Uygula"ya basana kadar yükleme yapma
        return;
    }
    wrap.style.display = 'none';
    loadDetailedStatsCustomer();
}

async function loadDetailedStatsCustomer() {
    const daysEl = document.getElementById('cuStatsDays');
    const mode   = daysEl ? daysEl.value : '30';
    let url;
    if (mode === 'custom') {
        const start = document.getElementById('cuStatsStart')?.value;
        const end   = document.getElementById('cuStatsEnd')?.value;
        if (!start || !end) { alert('Başlangıç ve bitiş tarihini girin.'); return; }
        if (start > end)    { alert('Başlangıç tarihi bitişten sonra olamaz.'); return; }
        url = `/api/stats/detailed?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    } else {
        const days = Number(mode) || 30;
        url = '/api/stats/detailed?days=' + days;
    }
    try {
        const res = await fetch(url);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('detailed stats:', res.status, err);
            return;
        }
        const d = await res.json();
        _cuLastDetailed = d;
        _cuRenderDetailedSummary(d);
        _cuRenderDetailedByUser(d);
        _cuRenderDetailedHourly(d.hourly || []);
        _cuRenderDetailedWeekday(d.weekday || []);
        _cuRenderDetailedTopSenders(d.topSenders || []);
        _cuRenderDetailedRiskySenders(d.topRiskySenders || []);
    } catch (e) { console.error('detailed load:', e); }
}

function _cuRenderDetailedSummary(d) {
    const el = document.getElementById('cuDetailedSummary');
    const riskyPct = d.totalScans > 0 ? Math.round(d.riskyTotal / d.totalScans * 100) : 0;
    el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
            <div class="stat-card"><div class="stat-value">${d.totalScans}</div><div class="stat-label">Toplam (${d.days}g)</div></div>
            <div class="stat-card"><div class="stat-value" class="u-err">${d.riskyTotal}</div><div class="stat-label">Riskli</div></div>
            <div class="stat-card"><div class="stat-value">${d.avgScore || 0}</div><div class="stat-label">Ortalama Skor</div></div>
            <div class="stat-card"><div class="stat-value">%${riskyPct}</div><div class="stat-label">Risk Oranı</div></div>
        </div>
    `;
}

function _cuRenderDetailedByUser(d) {
    const wrap  = document.getElementById('cuDetailedByUserWrap');
    const users = d.byUser || [];
    if (!users.length) { wrap.innerHTML = '<p class="text-muted" style="padding:12px">Bu dönemde tarama yapılmamış.</p>'; return; }
    const totalAll = users.reduce((s, u) => s + u.scanCount, 0);
    const rows = users.map(u => {
        const pct = totalAll > 0 ? Math.round(u.scanCount / totalAll * 100) : 0;
        const lastDate = u.lastScanAt ? new Date(u.lastScanAt).toLocaleString('tr-TR', {dateStyle:'short', timeStyle:'short'}) : '-';
        const riskyCount = u.highCount + u.mediumCount;
        const riskyColor = riskyCount > 0 ? '#f87171' : 'var(--text-secondary)';
        return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:8px;font-size:13px">${esc(u.label)}</td>
            <td style="padding:8px;text-align:right;font-weight:700">${u.scanCount} <span style="color:var(--text-secondary);font-weight:400;font-size:11px">(%${pct})</span></td>
            <td style="padding:8px;text-align:center;color:#f87171;font-weight:600">${u.highCount}</td>
            <td style="padding:8px;text-align:center;color:#fb923c;font-weight:600">${u.mediumCount}</td>
            <td style="padding:8px;text-align:center;color:#fbbf24">${u.lowCount}</td>
            <td style="padding:8px;text-align:center;color:#34d399">${u.safeCount}</td>
            <td style="padding:8px;text-align:center;color:${riskyColor};font-weight:600">${riskyCount}</td>
            <td style="padding:8px;text-align:right">${u.avgScore || '-'}</td>
            <td style="padding:8px;color:var(--text-secondary);font-size:12px">${esc(lastDate)}</td>
        </tr>`;
    }).join('');
    wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="color:var(--text-secondary);font-size:12px;background:var(--surface2)">
            <th style="text-align:left;padding:10px">Kullanıcı / Kaynak</th>
            <th style="text-align:right;padding:10px">Tarama</th>
            <th class="u-center u-p10" title="Yüksek Risk">🔴</th>
            <th class="u-center u-p10" title="Orta Risk">🟠</th>
            <th class="u-center u-p10" title="Düşük Risk">🟡</th>
            <th class="u-center u-p10" title="Güvenli">🟢</th>
            <th class="u-center u-p10">Riskli</th>
            <th style="text-align:right;padding:10px">Ort. Skor</th>
            <th style="text-align:left;padding:10px">Son Tarama</th>
        </tr></thead><tbody>${rows}</tbody></table>`;
}

function _cuRenderDetailedHourly(hourly) {
    const max = Math.max(...hourly.map(h => h.count), 1);
    const bars = hourly.map(h => {
        const height = Math.max(2, Math.round(h.count / max * 70));
        const opacity = h.count > 0 ? 1 : 0.15;
        return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0">
            <div style="font-size:9px;color:var(--text-secondary);margin-bottom:2px;height:12px">${h.count > 0 ? h.count : ''}</div>
            <div style="width:100%;height:70px;display:flex;align-items:flex-end;background:var(--surface2);border-radius:2px">
                <div style="width:100%;height:${height}px;background:var(--accent);opacity:${opacity};border-radius:2px"></div>
            </div>
            <div style="font-size:9px;color:var(--text-secondary);margin-top:3px">${String(h.hour).padStart(2,'0')}</div>
        </div>`;
    }).join('');
    document.getElementById('cuDetailedHourly').innerHTML =
        `<div style="display:flex;gap:2px;align-items:flex-end;padding:4px 0">${bars}</div>`;
}

function _cuRenderDetailedWeekday(weekday) {
    const max = Math.max(...weekday.map(w => w.count), 1);
    const bars = weekday.map(w => {
        const height = Math.max(2, Math.round(w.count / max * 80));
        return `<div style="display:flex;flex-direction:column;align-items:center;flex:1">
            <div style="font-size:11px;font-weight:600;color:${w.count > 0 ? 'var(--accent)' : 'var(--text-secondary)'};margin-bottom:4px">${w.count}</div>
            <div style="width:100%;background:var(--surface2);border-radius:3px;height:80px;display:flex;align-items:flex-end">
                <div style="width:100%;height:${height}px;background:var(--accent);border-radius:3px;opacity:${w.count > 0 ? 1 : 0.2}"></div>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">${esc(w.weekday)}</div>
        </div>`;
    }).join('');
    document.getElementById('cuDetailedWeekday').innerHTML =
        `<div style="display:flex;gap:6px;align-items:flex-end;padding:4px 0">${bars}</div>`;
}

function _cuRenderDetailedTopSenders(senders) {
    const el = document.getElementById('cuDetailedTopSenders');
    if (!senders.length) { el.innerHTML = '<p class="text-muted" style="padding:8px">Veri yok.</p>'; return; }
    const max = senders[0].count || 1;
    el.innerHTML = senders.map(s => {
        const pct = Math.round(s.count / max * 100);
        return `<div class="u-mb8">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(s.email)}</span>
                <span style="font-weight:600;margin-left:8px">${s.count}</span>
            </div>
            <div style="height:5px;background:var(--surface2);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px"></div>
            </div>
        </div>`;
    }).join('');
}

function _cuRenderDetailedRiskySenders(senders) {
    const el = document.getElementById('cuDetailedRiskySenders');
    if (!senders.length) { el.innerHTML = '<p class="text-muted" style="padding:8px">Riskli gönderici tespit edilmedi.</p>'; return; }
    el.innerHTML = senders.map(s =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
            <div style="flex:1;overflow:hidden">
                <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.email)}</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">Ortalama skor: ${s.avgScore}</div>
            </div>
            <div style="display:flex;gap:6px;font-size:11px;font-weight:700">
                ${s.high   ? `<span style="background:rgba(248,113,113,0.15);color:#f87171;padding:3px 8px;border-radius:6px">🔴 ${s.high}</span>` : ''}
                ${s.medium ? `<span style="background:rgba(251,146,60,0.15);color:#fb923c;padding:3px 8px;border-radius:6px">🟠 ${s.medium}</span>` : ''}
            </div>
        </div>`
    ).join('');
}

function exportDetailedCsvCustomer() {
    if (!_cuLastDetailed) { alert('Önce raporu yükleyin.'); return; }
    const d = _cuLastDetailed;
    const lines = [];
    lines.push('# MailTrustAI Ayrintili Istatistik Raporu');
    lines.push(`# Donem: Son ${d.days} gun`);
    lines.push(`# Toplam: ${d.totalScans} tarama, ${d.riskyTotal} riskli, ortalama skor ${d.avgScore}`);
    lines.push('');
    lines.push('Kullanici/Kaynak,Tarama,Yuksek,Orta,Dusuk,Guvenli,Ortalama Skor,Son Tarama');
    for (const u of (d.byUser || [])) {
        const row = [u.label, u.scanCount, u.highCount, u.mediumCount, u.lowCount, u.safeCount, u.avgScore, u.lastScanAt || '']
            .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',');
        lines.push(row);
    }
    const csv  = '﻿' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `mailtrustai-rapor-${d.days}gun-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadHomePage() {
    await Promise.all([
        loadHomeStats(), loadHomeRecentScans(), loadHomeThreatIntel(),
        loadExecutiveDashboard(), renderOnboardingChecklist(),
        loadFingerprintCard()
    ]);
}

// ============================================================
// CİHAZ PARMAK İZİ KARTI
// ============================================================
async function loadFingerprintCard() {
    const body = document.getElementById('fpCardBody');
    if (!body) return;

    try {
        const res = await fetch('/api/license/fingerprint');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const fp = await res.json();
        const sig = fp.signals || {};

        function shortHash(h) {
            if (!h) return '<span style="color:var(--text-muted);font-style:italic">—</span>';
            // "sha256:abcdef..." → ilk 12 + son 4 karakter göster
            const hex = h.replace('sha256:', '');
            return `<span style="font-family:monospace;font-size:11px;color:#a5b4fc">${hex.slice(0,12)}…${hex.slice(-4)}</span>`;
        }

        const platformIcon = fp.platform === 'windows' ? '🪟' : '🐧';
        const rows = [
            { label: 'install_id',    hash: sig.install_id_hash,    required: true },
            { label: 'os_machine_id', hash: sig.os_machine_id_hash, required: true },
            { label: 'system_uuid',   hash: sig.system_uuid_hash,   required: false },
        ];

        const rowsHtml = rows.map(r => {
            const ok = !!r.hash;
            const badge = r.required
                ? (ok ? '<span style="font-size:10px;color:var(--green)">✓ zorunlu</span>' : '<span style="font-size:10px;color:var(--red)">✗ eksik</span>')
                : (ok ? '<span style="font-size:10px;color:var(--text-muted)">✓ opsiyonel</span>' : '<span style="font-size:10px;color:var(--text-muted)">— opsiyonel</span>');
            return `<tr>
                <td style="padding:5px 0;font-size:12px;color:var(--text-secondary);white-space:nowrap;padding-right:10px">${r.label}</td>
                <td style="padding:5px 0">${shortHash(r.hash)}</td>
                <td style="padding:5px 8px;text-align:right">${badge}</td>
            </tr>`;
        }).join('');

        const fpJson = JSON.stringify(fp, null, 2);

        body.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
                <span>${platformIcon}</span>
                <span style="font-size:12px;color:var(--text-secondary)">${fp.platform || '—'} • v${fp.fingerprint_version || 1}</span>
                <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${fp.type || ''}</span>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:12px">${rowsHtml}</table>
            <div style="font-size:11px;color:var(--text-secondary);background:rgba(99,102,241,0.07);border:1px solid rgba(99,102,241,0.18);border-radius:6px;padding:8px 10px;margin-bottom:10px;line-height:1.5">
                💡 Bayinize bu parmak izini gönderin — lisans bu cihaza kilitlenecek.
            </div>
            <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center" onclick="copyFingerprintJson()">
                📋 Parmak İzini Kopyala (JSON)
            </button>
            <textarea id="fpJsonHidden" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" aria-hidden="true">${fpJson.replace(/</g,'&lt;')}</textarea>
        `;
        // JSON'ı script-erişilebilir yerde sakla
        window._lastFingerprintJson = fpJson;

    } catch (e) {
        body.innerHTML = `<p class="text-muted" style="font-size:13px">❌ Parmak izi alınamadı: ${e.message}</p>`;
    }
}

function copyFingerprintJson() {
    const json = window._lastFingerprintJson;
    if (!json) return;

    function onSuccess() {
        showToast('Parmak izi JSON panoya kopyalandı.', 'success', { title: 'Kopyalandı' });
    }
    function onFail() {
        // Fallback: geçici textarea ile execCommand
        const ta = document.createElement('textarea');
        ta.value = json;
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        try { document.execCommand('copy'); onSuccess(); } catch {}
        document.body.removeChild(ta);
    }

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(json).then(onSuccess).catch(onFail);
    } else {
        onFail();
    }
}

// ============================================================
// ONBOARDING CHECKLIST — yeni kurulumda 5 adımlık rehber
// ============================================================
async function renderOnboardingChecklist() {
    const card = document.getElementById('onboardingCard');
    if (!card) return;
    if (localStorage.getItem('msa_onboarding_dismissed') === '1') {
        card.style.display = 'none';
        return;
    }

    // Durumları topla
    const state = {
        license: false,
        apiKey: false,
        firstScan: false,
        imapOrScanMailbox: false,
        periodicReport: false
    };

    // 1) Lisans aktif mi?
    state.license = !!(licenseInfo && licenseInfo.valid);

    // 2) En az bir AI/VT/OTX anahtarı kayıtlı mı?
    try {
        const res = await fetch('/api/settings/status');
        if (res.ok) {
            const s = await res.json();
            state.apiKey = !!(s.openaiConfigured || s.claudeConfigured || s.vtConfigured || s.otxConfigured);
        }
    } catch {}

    // 3) İlk tarama yapıldı mı? (en az 1 history kaydı)
    try {
        const r = await fetch('/api/history');
        const items = await r.json();
        state.firstScan = Array.isArray(items) && items.length > 0;
    } catch {}

    // 4) IMAP veya Tarama Posta Kutusu kurulu mu?
    // Doğru endpoint adları: /api/imap/accounts ve /api/scan-mailboxes
    // (Önceki sürümde /api/imap/credentials ve /api/scan-mailbox/list yanlış
    //  isimler kullanılıyordu → her zaman 404 → checklist üzeri çizilmiyordu.)
    try {
        const r = await fetch('/api/imap/accounts');
        if (r.ok) {
            const list = await r.json();
            state.imapOrScanMailbox = Array.isArray(list) && list.length > 0;
        }
    } catch {}
    if (!state.imapOrScanMailbox) {
        try {
            const r = await fetch('/api/scan-mailboxes');
            if (r.ok) {
                const list = await r.json();
                state.imapOrScanMailbox = Array.isArray(list) && list.length > 0;
            }
        } catch {}
    }

    // 5) Periyodik rapor açık mı?
    try {
        const r = await fetch('/api/reports/settings');
        if (r.ok) {
            const s = await r.json();
            state.periodicReport = !!(s && (s.daily || s.weekly || s.monthly));
        }
    } catch {}

    const steps = [
        { id: 'license',          done: state.license,          label: '✅ Lisans aktif',
          action: () => { document.getElementById('licenseBtn')?.click() || openLicenseModal?.(); },
          desc: 'Bayinizden aldığınız lisans kodunu girin' },
        { id: 'apiKey',           done: state.apiKey,           label: '🔑 En az bir AI/VT/OTX anahtarı ekle',
          action: () => openSettings?.(),
          desc: 'OpenAI veya AntiVirüs entegrasyonu güç katar' },
        { id: 'firstScan',        done: state.firstScan,        label: '🔍 İlk taramanı yap',
          action: () => { switchPage?.('scan') || selectMode('upload'); },
          desc: 'Bir EML dosyası yükleyip test et' },
        { id: 'imapOrScanMailbox',done: state.imapOrScanMailbox,label: '📨 IMAP veya Tarama Posta Kutusu kur',
          action: () => { switchPage?.('scan'); selectMode('imap'); },
          desc: 'Otomatik canlı izleme için' },
        { id: 'periodicReport',   done: state.periodicReport,   label: '📅 Periyodik rapor aç',
          action: () => openSettings?.(),
          desc: 'Yöneticiye günlük/haftalık özet maili' }
    ];

    const doneCount = steps.filter(s => s.done).length;
    const allDone = doneCount === steps.length;

    document.getElementById('onboardingProgressLabel').textContent = `${doneCount} / ${steps.length} tamamlandı`;
    document.getElementById('onboardingProgressFill').style.width = `${Math.round((doneCount / steps.length) * 100)}%`;

    document.getElementById('onboardingSteps').innerHTML = steps.map((s, i) => `
        <div class="onboarding-step ${s.done ? 'done' : ''}"
             onclick="${s.done ? '' : `_onboardingStep(${i})`}"
             title="${esc(s.desc)}">
            <div class="onboarding-step-check">${s.done ? '✓' : (i + 1)}</div>
            <div class="onboarding-step-text">${esc(s.label)}</div>
            <div class="onboarding-step-arrow">→</div>
        </div>
    `).join('');

    // Geçici globaller (onclick için)
    window._onboardingSteps = steps;

    // Tüm adımlar tamamlandıysa: 5 saniye göster + dismiss et
    if (allDone) {
        card.setAttribute('data-complete', 'false');
        card.style.display = '';
        setTimeout(() => {
            localStorage.setItem('msa_onboarding_dismissed', '1');
            card.setAttribute('data-complete', 'true');
        }, 6000);
    } else {
        card.style.display = '';
    }
}

window._onboardingStep = function(idx) {
    const steps = window._onboardingSteps || [];
    if (steps[idx] && typeof steps[idx].action === 'function') steps[idx].action();
};

window.dismissOnboarding = function() {
    localStorage.setItem('msa_onboarding_dismissed', '1');
    const card = document.getElementById('onboardingCard');
    if (card) card.style.display = 'none';
};

async function loadHomeStats() {
    try {
        const res = await fetch('/api/history');
        const items = await res.json();
        const total  = items.length;
        const high   = items.filter(i => i.level === 'high').length;
        const medium = items.filter(i => i.level === 'medium').length;
        const safe   = items.filter(i => i.level === 'safe' || i.level === 'low').length;
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setVal('hsTotalScans', total);
        setVal('hsHighRisk',   high);
        setVal('hsMediumRisk', medium);
        setVal('hsSafe',       safe);
    } catch (e) {
        console.error('loadHomeStats error:', e);
    }
}

async function loadExecutiveDashboard() {
    const scoreEl = document.getElementById('homeRiskScore');
    const gradeEl = document.getElementById('homeRiskGrade');
    const trendEl = document.getElementById('homeRiskTrend');
    const alertsEl = document.getElementById('homeRiskAlerts');
    try {
        const headers = licenseKey ? { 'x-license-key': licenseKey } : {};
        const res = await fetch('/api/reports/executive/summary?days=30', { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Executive dashboard yuklenemedi');
        currentExecutiveDashboard = data;
        if (scoreEl) scoreEl.textContent = data.score ?? '--';
        if (gradeEl) gradeEl.textContent = data.grade || '-';
        if (trendEl) {
            const trend = Number(data.trend || 0);
            const sign = trend > 0 ? '+' : '';
            trendEl.textContent = `${data.trendLabel || 'stabil'} (${sign}${trend} puan)`;
            trendEl.style.color = trend < -3 ? '#f87171' : (trend > 3 ? '#34d399' : 'var(--text-secondary)');
        }
        if (alertsEl) {
            const alerts = Array.isArray(data.commercialAlerts) ? data.commercialAlerts : [];
            if (!alerts.length) {
                alertsEl.innerHTML = '<div class="home-risk-alert"><span>Risk seviyesi dusuk. Executive rapor hazir.</span></div>';
            } else {
                alertsEl.innerHTML = alerts.slice(0, 3).map(alert => `
                    <div class="home-risk-alert">
                        <span><strong>${esc(alert.title || 'Uyari')}</strong><br><span style="color:var(--text-secondary)">${esc(alert.message || '')}</span></span>
                        <span style="font-weight:800;color:${alert.type === 'critical' || alert.type === 'risk' ? '#f87171' : '#f59e0b'}">${esc(alert.type || '')}</span>
                    </div>
                `).join('');
            }
        }
    } catch (e) {
        currentExecutiveDashboard = null;
        if (scoreEl) scoreEl.textContent = '--';
        if (gradeEl) gradeEl.textContent = '-';
        if (trendEl) trendEl.textContent = 'Risk dashboard alinamadi';
        if (alertsEl) alertsEl.innerHTML = `<div class="home-risk-alert"><span>${esc(e.message)}</span></div>`;
    }
}

async function loadHomeRecentScans() {
    const container = document.getElementById('homeRecentList');
    if (!container) return;
    try {
        const res   = await fetch('/api/history');
        const items = await res.json();
        const recent = items.slice(0, 6);
        if (!recent.length) {
            container.innerHTML = '<p class="text-muted" style="font-size:13px">Henüz tarama yapılmadı.</p>';
            return;
        }
        const levelColor = { high: '#ff1744', medium: '#ff9100', low: '#ffea00', safe: '#00e676' };
        container.innerHTML = recent.map(item => `
            <div class="home-recent-item" onclick='openHistoryResult(${JSON.stringify(item.id)});showPage("scan")'>
                <div class="home-recent-score" style="background:${(item.color || '#666')}20;color:${item.color || '#666'}">${item.score}</div>
                <div class="u-flex1-0">
                    <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.emailMeta?.subject || 'Konu yok')}</div>
                    <div class="u-xs-m">${esc(item.emailMeta?.from?.[0]?.address || '')} &nbsp;·&nbsp; ${timeAgo(item.timestamp)}</div>
                </div>
                <span style="font-size:11px;font-weight:600;color:${levelColor[item.level] || '#888'}">${esc(item.labelTR || item.level || '')}</span>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<p class="text-muted" style="font-size:13px">Yüklenemedi.</p>';
    }
}

async function loadHomeThreatIntel() {
    const el = document.getElementById('homeThreatIntelStatus');
    if (!el) return;
    try {
        const res  = await fetch('/api/threat-intel/stats');
        const data = await res.json();
        if (!data.available) {
            el.innerHTML = '<span style="color:var(--text-secondary);font-size:13px">⏳ Tehdit beslemesi yükleniyor veya ağ erişimi yok.</span>';
            return;
        }
        const updated = data.updatedAt ? new Date(data.updatedAt).toLocaleString('tr-TR') : '—';
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="color:var(--green)">● Aktif</span>
                <span class="u-xs-m">${updated}</span>
            </div>
            <div style="display:flex;gap:16px;margin-top:4px">
                <div><span style="font-size:20px;font-weight:700;color:var(--red)">${(data.domainCount||0).toLocaleString()}</span><div class="u-xs-m">Tehdit Domain</div></div>
                <div><span style="font-size:20px;font-weight:700;color:var(--orange)">${(data.urlCount||0).toLocaleString()}</span><div class="u-xs-m">Tehdit URL</div></div>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">Kaynak: URLhaus + OpenPhish — 24 saatte bir güncellenir</div>
        `;
    } catch (e) {
        el.innerHTML = '<span style="color:var(--text-secondary);font-size:13px">Durum alınamadı.</span>';
    }
}

// ============================================================
// CSV EXPORT
// ============================================================
function exportHistoryCsv() {
    const link = document.createElement('a');
    link.href = '/api/history/export.csv';
    link.download = `mailtrustai-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

// ============================================================
// ALLOWLIST / BLOCKLIST
// ============================================================
function openListsPanel() {
    // Sadece müşteri admin açabilir. Müşteri user için 'sınırlı erişim' uyarısı.
    if (getCustomerRole() === 'user') {
        alert(_tLit('Allowlist / Blocklist yönetimi yalnız müşteri yönetici hesabıyla yapılabilir.', 'Allowlist / Blocklist management is admin-only.'));
        return;
    }
    const panel = document.getElementById('listsPanel');
    if (!panel) return;
    panel.style.display = '';
    loadListsPanel();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeListsPanel() {
    const panel = document.getElementById('listsPanel');
    if (panel) panel.style.display = 'none';
}

async function loadListsPanel() {
    try {
        const res = await fetch('/api/lists');
        const data = await res.json();
        renderListItems('allowlist', data.allowlist || []);
        renderListItems('blocklist', data.blocklist || []);
    } catch (e) {
        console.error('loadListsPanel error:', e);
    }
}

function renderListItems(type, items) {
    const containerId = type === 'allowlist' ? 'allowlistItems' : 'blocklistItems';
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!items.length) {
        container.innerHTML = '<span class="text-muted" class="u-sm">Henüz kayıt yok.</span>';
        return;
    }
    container.innerHTML = items.map(domain => `
        <div style="display:inline-flex;align-items:center;gap:4px;background:var(--surface2);border-radius:6px;padding:3px 8px;margin:2px;font-size:12px">
            <span>${esc(domain)}</span>
            <button onclick="removeListEntry('${type}','${esc(domain)}')" style="background:none;border:none;cursor:pointer;color:#f87171;font-size:14px;line-height:1;padding:0 2px" title="Kaldır">×</button>
        </div>
    `).join('');
}

async function addListEntry(type) {
    const inputId = type === 'allowlist' ? 'allowlistInput' : 'blocklistInput';
    const statusId = type === 'allowlist' ? 'allowlistStatus' : 'blocklistStatus';
    const input = document.getElementById(inputId);
    const statusEl = document.getElementById(statusId);
    const domain = (input?.value || '').trim();
    if (!domain) return;

    try {
        const res = await fetch(`/api/lists/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain })
        });
        const data = await res.json();
        if (!res.ok) {
            if (statusEl) statusEl.innerHTML = `<span class="u-err">${esc(data.error || 'Hata')}</span>`;
            return;
        }
        if (input) input.value = '';
        if (statusEl) {
            statusEl.innerHTML = `<span class="u-ok">✅ Eklendi</span>`;
            setTimeout(() => { statusEl.textContent = ''; }, 2000);
        }
        loadListsPanel();
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span class="u-err">${esc(e.message)}</span>`;
    }
}

async function removeListEntry(type, domain) {
    try {
        await fetch(`/api/lists/${type}/${encodeURIComponent(domain)}`, { method: 'DELETE' });
        loadListsPanel();
    } catch (e) {
        console.error('removeListEntry error:', e);
    }
}

// ─── Allow/Blocklist Export ───────────────────────────────────────────────
function _listsAuthHeaders(extra) {
    const h = { ...(extra || {}) };
    if (licenseKey) h['x-license-key'] = licenseKey;
    return h;
}

async function exportLists() {
    try {
        const res = await fetch('/api/lists/export', { headers: _listsAuthHeaders() });
        if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `mailtrustai-lists-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        _listsShowStatus('❌ Dışa aktarma hatası: ' + e.message, '#f87171');
    }
}

// ─── Allow/Blocklist Import ───────────────────────────────────────────────
let _listsBackup = null;

async function importListsFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;

    let parsed;
    try {
        const text = await file.text();
        parsed = JSON.parse(text);
    } catch {
        return _listsShowStatus('❌ Geçersiz JSON dosyası', '#f87171');
    }

    if (!Array.isArray(parsed.allowlist) && !Array.isArray(parsed.blocklist)) {
        return _listsShowStatus('❌ Dosyada allowlist veya blocklist alanı bulunamadı', '#f87171');
    }

    const reset = document.getElementById('listsResetCheck')?.checked;

    // Sıfırlama seçiliyse önce yedeği al
    if (reset) {
        try {
            const backupRes = await fetch('/api/lists/export', { headers: _listsAuthHeaders() });
            if (backupRes.ok) {
                const backupBlob = await backupRes.blob();
                const bUrl = URL.createObjectURL(backupBlob);
                const a   = document.createElement('a');
                a.href    = bUrl;
                a.download = `mailtrustai-lists-backup-${new Date().toISOString().slice(0,10)}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(bUrl);
                // Bellek yedeği
                const backupData = await fetch('/api/lists', { headers: _listsAuthHeaders() }).then(r => r.json());
                _listsBackup = backupData;
                const btn = document.getElementById('btnListsRestore');
                if (btn) btn.style.display = '';
            }
        } catch {/* yedek alınamazsa devam et */}
    }

    try {
        const res = await fetch('/api/lists/import', {
            method:  'POST',
            headers: _listsAuthHeaders({ 'Content-Type': 'application/json' }),
            body:    JSON.stringify({
                allowlist: parsed.allowlist || [],
                blocklist: parsed.blocklist || [],
                merge:     !reset
            })
        });
        const data = await res.json();
        if (!res.ok) return _listsShowStatus('❌ ' + (data.error || 'İçe aktarma başarısız'), '#f87171');

        const msg = reset
            ? `✅ Liste sıfırlandı ve içe aktarıldı — Allowlist: +${data.allowlistAdded}, Blocklist: +${data.blocklistAdded}`
            : `✅ İçe aktarıldı — Allowlist: +${data.allowlistAdded}, Blocklist: +${data.blocklistAdded}`;
        _listsShowStatus(msg, '#2ee59d');
        loadListsPanel();
    } catch (e) {
        _listsShowStatus('❌ İçe aktarma hatası: ' + e.message, '#f87171');
    }
}

async function listsRestoreBackup() {
    if (!_listsBackup) return _listsShowStatus('❌ Belleğe alınmış yedek yok', '#f87171');
    try {
        const res = await fetch('/api/lists/import', {
            method:  'POST',
            headers: _listsAuthHeaders({ 'Content-Type': 'application/json' }),
            body:    JSON.stringify({
                allowlist: _listsBackup.allowlist || [],
                blocklist: _listsBackup.blocklist || [],
                merge:     false
            })
        });
        const data = await res.json();
        if (!res.ok) return _listsShowStatus('❌ ' + (data.error || 'Geri yükleme başarısız'), '#f87171');
        _listsShowStatus('✅ Yedek başarıyla geri yüklendi', '#2ee59d');
        _listsBackup = null;
        const btn = document.getElementById('btnListsRestore');
        if (btn) btn.style.display = 'none';
        loadListsPanel();
    } catch (e) {
        _listsShowStatus('❌ Geri yükleme hatası: ' + e.message, '#f87171');
    }
}

function _listsShowStatus(msg, color) {
    const el = document.getElementById('listsImportStatus');
    if (!el) return;
    el.style.display   = '';
    el.style.color     = color || '#ccc';
    el.textContent     = msg;
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ============================================================
// WEBHOOK AYARLARI
// ============================================================
function toggleWebhookSection(checked) {
    const section = document.getElementById('webhookSection');
    if (section) section.style.display = checked ? '' : 'none';
}

async function loadWebhookSettings() {
    try {
        const res = await fetch('/api/settings/webhook');
        if (!res.ok) return;
        const data = await res.json();
        const enabledEl = document.getElementById('webhookEnabled');
        const urlEl = document.getElementById('webhookUrl');
        const levelEl = document.getElementById('webhookMinLevel');
        if (enabledEl) { enabledEl.checked = !!data.webhookEnabled; toggleWebhookSection(!!data.webhookEnabled); }
        if (urlEl) urlEl.value = data.webhookUrl || '';
        if (levelEl) levelEl.value = data.webhookMinLevel || 'low';
    } catch (e) {
        console.error('loadWebhookSettings error:', e);
    }
}

// ─── SİSTEM SMTP ─────────────────────────────────────────────
async function loadSystemSmtp() {
    try {
        const res  = await fetch('/api/settings/system-smtp');
        if (!res.ok) return;
        const data = await res.json();
        const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
        f('sysSmtpHost',     data.host);
        f('sysSmtpPort',     data.port || 587);
        f('sysSmtpUser',     data.user);
        f('sysSmtpFromName', data.fromName || 'MailTrustAI');
        const secEl = document.getElementById('sysSmtpSecure');
        if (secEl) secEl.checked = !!data.secure;
        const pwdEl = document.getElementById('sysSmtpPassword');
        if (pwdEl) pwdEl.placeholder = data.hasPassword
            ? '••••••••  (boş bırakılırsa mevcut şifre korunur)'
            : 'Şifre giriniz';
    } catch(e) { console.error('loadSystemSmtp:', e); }
}

async function saveSystemSmtp() {
    const statusEl = document.getElementById('sysSmtpStatus');
    if (statusEl) statusEl.textContent = '⏳ Kaydediliyor…';
    try {
        const body = {
            host:     document.getElementById('sysSmtpHost')?.value.trim()     || '',
            port:     Number(document.getElementById('sysSmtpPort')?.value)     || 587,
            secure:   document.getElementById('sysSmtpSecure')?.checked        || false,
            user:     document.getElementById('sysSmtpUser')?.value.trim()     || '',
            fromName: document.getElementById('sysSmtpFromName')?.value.trim() || 'MailTrustAI',
            password: document.getElementById('sysSmtpPassword')?.value        || ''
        };
        const res  = await fetch('/api/settings/system-smtp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Hata');
        if (statusEl) statusEl.innerHTML = '<span class="u-ok2">✅ Kaydedildi.</span>';
        const pwdEl = document.getElementById('sysSmtpPassword');
        if (pwdEl) { pwdEl.value = ''; pwdEl.placeholder = '••••••••  (boş bırakılırsa mevcut şifre korunur)'; }
    } catch(e) {
        if (statusEl) statusEl.innerHTML = `<span class="u-err">❌ ${e.message}</span>`;
    }
}

async function testSystemSmtp() {
    const statusEl = document.getElementById('sysSmtpStatus');
    if (statusEl) statusEl.textContent = '⏳ Test ediliyor…';
    try {
        const res  = await fetch('/api/settings/system-smtp/test', { method: 'POST' });
        const data = await res.json();
        if (statusEl) {
            statusEl.innerHTML = data.success
                ? '<span class="u-ok2">✅ Bağlantı başarılı.</span>'
                : `<span class="u-err">❌ ${esc(data.message || 'Bağlantı hatası')}</span>`;
        }
    } catch(e) {
        if (statusEl) statusEl.innerHTML = `<span class="u-err">❌ ${esc(e.message)}</span>`;
    }
}

async function saveWebhookSettings(options = {}) {
    const silent = options?.silent === true;
    const throwOnError = options?.throwOnError === true;
    const enabledEl = document.getElementById('webhookEnabled');
    const urlEl = document.getElementById('webhookUrl');
    const levelEl = document.getElementById('webhookMinLevel');
    const statusEl = document.getElementById('webhookTestStatus');

    const payload = {
        webhookEnabled: enabledEl?.checked || false,
        webhookUrl: (urlEl?.value || '').trim(),
        webhookMinLevel: levelEl?.value || 'low'
    };

    try {
        const res = await fetch('/api/settings/webhook', {
            method: 'POST',
            headers: settingsAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            if (statusEl && !silent) statusEl.innerHTML = `<span class="u-err">${esc(data.error || 'Hata')}</span>`;
            if (throwOnError) throw new Error(data.error || 'Webhook ayarlari kaydedilemedi');
            return data;
        }
        if (statusEl && !silent) {
            statusEl.innerHTML = '<span class="u-ok">Webhook ayarlari kaydedildi.</span>';
            setTimeout(() => { statusEl.textContent = ''; }, 2500);
        }
        return data;
    } catch (e) {
        if (statusEl && !silent) statusEl.innerHTML = `<span class="u-err">${esc(e.message)}</span>`;
        if (throwOnError) {
            const settingsStatus = document.getElementById('settingsStatus');
            if (settingsStatus) settingsStatus.innerHTML = `<span class="u-err-b">Kaydedilemedi: ${esc(e.message)}</span>`;
            throw e;
        }
        return null;
    }

    try {
        const res = await fetch('/api/settings/webhook', {
            method: 'POST',
            headers: settingsAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            if (statusEl) statusEl.innerHTML = `<span class="u-err">${esc(data.error || 'Hata')}</span>`;
            return;
        }
        if (statusEl) {
            statusEl.innerHTML = '<span class="u-ok">✅ Webhook ayarları kaydedildi.</span>';
            setTimeout(() => { statusEl.textContent = ''; }, 2500);
        }
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span class="u-err">${esc(e.message)}</span>`;
    }
}

async function testWebhookConnection() {
    const urlEl = document.getElementById('webhookUrl');
    const statusEl = document.getElementById('webhookTestStatus');
    const url = (urlEl?.value || '').trim();

    if (!url) {
        if (statusEl) statusEl.innerHTML = '<span class="u-err">Webhook URL giriniz.</span>';
        return;
    }

    if (statusEl) statusEl.textContent = '⏳ Test ediliyor...';

    try {
        const res = await fetch('/api/settings/webhook/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.success) {
            if (statusEl) statusEl.innerHTML = `<span class="u-ok">✅ Bağlantı başarılı (HTTP ${data.status})</span>`;
        } else {
            if (statusEl) statusEl.innerHTML = `<span class="u-err">❌ Bağlantı başarısız: ${esc(data.error || String(data.status || ''))}</span>`;
        }
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span class="u-err">Bağlantı hatası: ${esc(e.message)}</span>`;
    }
}

// ============================================================
// MÜŞTERİ ROLÜ / KULLANICI YÖNETİMİ
// ============================================================

function getCustomerRole() {
    try { return sessionStorage.getItem('msa_customer_role') || 'admin'; } catch { return 'admin'; }
}
function getCustomerEmail() {
    try { return sessionStorage.getItem('msa_customer_email') || ''; } catch { return ''; }
}
function getCustomerImapEmail() {
    try { return sessionStorage.getItem('msa_customer_imap') || ''; } catch { return ''; }
}

function applyCustomerRoleUI() {
    const role  = getCustomerRole();
    const email = getCustomerEmail();
    const isUser = role === 'user';

    // Rol rozeti — uzun e-postada @ öncesi kısa kullanıcı adı, tam adres title'da
    const badge = document.getElementById('roleBadge');
    if (badge) {
        badge.style.display = '';
        const shortName = (email || '').split('@')[0] || (isUser ? 'user' : 'admin');
        const icon = isUser ? '👤' : '🛡️';
        badge.textContent = `${icon} ${shortName}`;
        badge.title = (isUser ? 'Müşteri kullanıcı — sınırlı erişim' : 'Müşteri admin')
            + (email ? `  (${email})` : '');
        if (isUser) {
            badge.style.background = 'rgba(245,158,11,0.15)';
            badge.style.borderColor = 'rgba(245,158,11,0.35)';
            badge.style.color = '#fcd34d';
        } else {
            badge.style.background = 'rgba(99,102,241,0.15)';
            badge.style.borderColor = 'rgba(99,102,241,0.35)';
            badge.style.color = '#c7d2fe';
        }
    }

    // Admin-only butonları yönet
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isUser ? 'none' : '';
    });

    // User rolünde sekmeleri sınırla: sadece "Tarama" (IMAP) bırak
    if (isUser) {
        const hideTabs = ['navTabHome', 'navTabStats', 'navTabOtxApproval'];
        hideTabs.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        // Açılırken Tarama sekmesini göster
        if (typeof showPage === 'function') {
            try { showPage('scan'); } catch {}
        }
    }
}

// ─── Müşteri Kullanıcıları Modal ─────────────────────────────────────────────

function showCustomerUsersModal() {
    const m = document.getElementById('customerUsersModal');
    if (!m) return;
    m.classList.remove('hidden');
    document.getElementById('cuCreateStatus').textContent = '';
    onCuRoleChange();
    loadCustomerUsersList();
}
window.showCustomerUsersModal = showCustomerUsersModal;

function closeCustomerUsersModal() {
    const m = document.getElementById('customerUsersModal');
    if (m) m.classList.add('hidden');
}
window.closeCustomerUsersModal = closeCustomerUsersModal;

function onCuRoleChange() {
    const roleSel = document.getElementById('cuRole');
    const wrap    = document.getElementById('cuImapEmailWrap');
    if (!roleSel || !wrap) return;
    wrap.style.display = roleSel.value === 'user' ? '' : 'none';
}
window.onCuRoleChange = onCuRoleChange;

async function _cuFetch(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = window.__msaCustomerToken || (function(){ try { return sessionStorage.getItem('msa_customer_token') || ''; } catch { return ''; } })();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

// Network hatalarında UI'ın "loading" stuck kalmaması için güvenli fetch sarmalayıcı.
// Her zaman { ok, status, data, networkError } döner — asla throw etmez.
async function _safeFetch(path, opts = {}) {
    try {
        const headers = Object.assign({}, opts.headers || {});
        if (licenseKey) headers['x-license-key'] = licenseKey;
        const res = await fetch(path, Object.assign({}, opts, { headers }));
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data, networkError: false };
    } catch (e) {
        return { ok: false, status: 0, data: {}, networkError: true, error: e.message };
    }
}

async function loadCustomerUsersList() {
    const cont = document.getElementById('cuListContainer');
    if (!cont) return;
    cont.innerHTML = '<div class="text-muted" style="padding:14px">Yükleniyor...</div>';
    const r = await _cuFetch('/api/customer-users');
    if (!r.ok) {
        cont.innerHTML = `<div style="color:#f87171;padding:12px">Yüklenemedi: ${esc(r.data.error || r.status)}</div>`;
        return;
    }
    const users = r.data.users || [];
    if (!users.length) {
        cont.innerHTML = '<div class="text-muted" style="padding:12px">Henüz kullanıcı yok.</div>';
        return;
    }
    const meEmail = getCustomerEmail();
    const rows = users.map(u => {
        const isMe   = u.email === meEmail;
        const roleColor = u.role === 'admin' ? '#c7d2fe' : '#fcd34d';
        const roleBg   = u.role === 'admin' ? 'rgba(99,102,241,0.15)' : 'rgba(245,158,11,0.15)';
        const statusBadge = u.active ? '<span style="color:#86efac">● aktif</span>' : '<span style="color:#fda4af">● pasif</span>';
        const created = u.createdAt ? new Date(u.createdAt).toLocaleString('tr-TR') : '—';
        const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString('tr-TR') : '—';
        return `
        <div style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:240px">
                <div style="font-weight:600">${esc(u.email)} ${isMe ? '<span style="font-size:11px;color:#86efac;margin-left:6px">(siz)</span>' : ''}</div>
                <div style="font-size:11px;opacity:0.7;margin-top:2px">
                    <span style="background:${roleBg};color:${roleColor};padding:1px 6px;border-radius:3px">${u.role}</span>
                    ${u.imapEmail ? ' · IMAP: <code>' + esc(u.imapEmail) + '</code>' : ''}
                    · ${statusBadge}
                </div>
                <div style="font-size:10px;opacity:0.5;margin-top:2px">oluşturuldu: ${esc(created)} · son giriş: ${esc(lastLogin)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" onclick="cuResetPassword('${esc(u.email)}')" title="Şifre sıfırla">🔑</button>
                ${u.role === 'user' ? '<button class="btn btn-ghost btn-sm" onclick="cuEditImap(\'' + esc(u.email) + '\', \'' + esc(u.imapEmail || '') + '\')" title="IMAP düzenle">📧</button>' : ''}
                <button class="btn btn-ghost btn-sm" onclick="cuToggleActive('${esc(u.email)}', ${u.active ? 'false' : 'true'})" ${isMe ? 'disabled title="Kendinizi pasifleştiremezsiniz"' : ''}>${u.active ? '⏸️' : '▶️'}</button>
                <button class="btn btn-ghost btn-sm" style="color:#fca5a5" onclick="cuDelete('${esc(u.email)}')" ${isMe ? 'disabled title="Kendinizi silemezsiniz"' : ''}>🗑️</button>
            </div>
        </div>`;
    }).join('');
    cont.innerHTML = rows;
}
window.loadCustomerUsersList = loadCustomerUsersList;

async function createCustomerUser() {
    const email     = (document.getElementById('cuEmail').value || '').trim().toLowerCase();
    const password  = document.getElementById('cuPassword').value;
    const role      = document.getElementById('cuRole').value;
    const imapEmail = (document.getElementById('cuImapEmail').value || '').trim().toLowerCase();
    const statusEl  = document.getElementById('cuCreateStatus');
    statusEl.textContent = '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { statusEl.innerHTML = '<span class="u-err">Geçerli bir e-posta gerekli</span>'; return; }
    if (!password || password.length < 6) { statusEl.innerHTML = '<span class="u-err">Şifre en az 6 karakter</span>'; return; }
    if (role === 'user' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(imapEmail)) {
        statusEl.innerHTML = '<span class="u-err">user rolü için IMAP e-postası zorunlu</span>'; return;
    }

    const r = await _cuFetch('/api/customer-users', {
        method: 'POST',
        body: JSON.stringify({ email, password, role, imapEmail: role === 'user' ? imapEmail : null })
    });
    if (!r.ok) { statusEl.innerHTML = `<span class="u-err">${esc(r.data.error || 'Hata')}</span>`; return; }

    statusEl.innerHTML = '<span style="color:#86efac">✓ Kullanıcı oluşturuldu</span>';
    document.getElementById('cuEmail').value = '';
    document.getElementById('cuPassword').value = '';
    document.getElementById('cuImapEmail').value = '';
    loadCustomerUsersList();
}
window.createCustomerUser = createCustomerUser;

async function cuResetPassword(email) {
    const pwd = prompt(`${email} için yeni şifre (en az 6 karakter):`);
    if (!pwd) return;
    if (pwd.length < 6) return alert('Şifre en az 6 karakter olmalı.');
    const r = await _cuFetch('/api/customer-users/' + encodeURIComponent(email), {
        method: 'PATCH', body: JSON.stringify({ password: pwd })
    });
    if (!r.ok) return alert('Hata: ' + (r.data.error || r.status));
    alert('Şifre güncellendi.');
}
window.cuResetPassword = cuResetPassword;

async function cuEditImap(email, current) {
    const imap = prompt(`${email} için IMAP e-postası:`, current || '');
    if (imap === null) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(imap)) return alert('Geçerli bir e-posta girin.');
    const r = await _cuFetch('/api/customer-users/' + encodeURIComponent(email), {
        method: 'PATCH', body: JSON.stringify({ imapEmail: imap })
    });
    if (!r.ok) return alert('Hata: ' + (r.data.error || r.status));
    loadCustomerUsersList();
}
window.cuEditImap = cuEditImap;

async function cuToggleActive(email, makeActive) {
    const r = await _cuFetch('/api/customer-users/' + encodeURIComponent(email), {
        method: 'PATCH', body: JSON.stringify({ active: makeActive === true || makeActive === 'true' })
    });
    if (!r.ok) return alert('Hata: ' + (r.data.error || r.status));
    loadCustomerUsersList();
}
window.cuToggleActive = cuToggleActive;

async function cuDelete(email) {
    const ok = await showConfirm({
        title: 'Kullanıcıyı Sil',
        message: `${email} kullanıcısı silinsin mi?`,
        confirmText: 'Sil', cancelText: 'Vazgeç', danger: true
    });
    if (!ok) return;
    const r = await _cuFetch('/api/customer-users/' + encodeURIComponent(email), { method: 'DELETE' });
    if (!r.ok) return alert('Hata: ' + (r.data.error || r.status));
    loadCustomerUsersList();
}
window.cuDelete = cuDelete;
