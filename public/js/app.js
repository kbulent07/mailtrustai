// ============================================================
// MAILTRUSTAI - Frontend Application
// ============================================================

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
const imapReportCache = new Map();
const inFlightImapScans = new Set();

document.addEventListener('DOMContentLoaded', () => {
    applyLang();
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
    // Lisans gate'leri — yetersizse güvenli mode'a düş, kullanıcı tetiklediyse uyar
    if (mode === 'imap' && !licenseInfo?.features?.imapConnection) {
        if (updateState) {
            alert(currentLang === 'tr'
                ? 'IMAP Tarama yalnızca Enterprise lisansında kullanılabilir.'
                : 'IMAP Scan is available only with an Enterprise license.');
        }
        mode = 'upload';
    }
    if (mode === 'scan-mailbox' && !licenseInfo?.features?.scanMailbox) {
        if (updateState) {
            alert(currentLang === 'tr'
                ? 'Tarama Posta Kutusu Pro veya Enterprise lisansı gerektirir.'
                : 'Scan Mailbox requires a Pro or Enterprise license.');
        }
        mode = 'upload';
    }

    currentMode = mode;

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
        alert(`Error: ${error.message}`);
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
        alert(`Error: ${error.message}`);
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
    renderStructuredReport(data);
    renderFindings(data.findings || []);
    renderAttachmentDetails(data);
    renderOpenAIAnalysis(data.openaiAnalysis);
    renderVirusTotal(data.virusTotal || [], data.vtStatus, data);
    renderClaudeAnalysis(data.claudeAnalysis);

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
    riskLevel.textContent = currentLang === 'tr' ? data.labelTR : data.labelEN;
    riskLevel.style.color = data.color;

    document.getElementById('riskDescription').textContent = riskDescriptionFor(data);
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
    const levelText = (currentLang === 'tr' ? data.labelTR : data.labelEN) || data.level || '';
    const verdictColor = data.color || '#94a3b8';
    const isRisky = data.level === 'high' || data.level === 'medium';
    const topTagsHtml = threatTags.slice(0, 4).map(tag =>
        `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,0.12);color:#fff;font-size:11px;font-weight:700;margin:0 4px 4px 0">${esc(tag.label)}</span>`
    ).join('');
    const verdictBanner = `
        <div style="position:relative;margin-bottom:14px;border-radius:10px;overflow:hidden;border:2px solid ${verdictColor};background:linear-gradient(90deg,${verdictColor}28,${verdictColor}10)">
            <div style="display:flex;align-items:center;gap:12px;padding:12px 16px">
                <div style="font-size:28px;line-height:1">${levelIcon}</div>
                <div style="flex:1;min-width:0">
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

function renderFindings(findings, filter = 'all') {
    const list = document.getElementById('findingsList');
    // 'ai' kategorisi ayrı ChatGPT kartında gösterildiği için burada tekrarlanmaz
    const filtered = filter === 'all'
        ? findings.filter(f => f.category !== 'ai')
        : findings.filter((finding) => finding.category === filter);

    list.innerHTML = filtered.map((finding) => `
        <div class="finding-item">
            <div class="finding-icon ${finding.severity}">${findingIcon(finding.severity)}</div>
            <div>
                <div class="finding-text">${esc(finding.message)}</div>
                <div class="finding-category">${esc(formatCategory(finding.category))}</div>
            </div>
        </div>
    `).join('');
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
                    <div class="finding-text"><strong>Virüs tarama API anahtarı tanımlı değil</strong></div>
                    <div class="finding-category">Ek dosyalar virüs taramasına gönderilmedi. Yalnızca yerel ek kontrolleri çalıştırıldı.</div>
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
                    <div class="text-red" style="margin-top:8px;">Bu nedenle ek, posta kutusuna orijinal hâliyle ulaşmadı ve virüs taramasına gönderilemedi.</div>
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
                    ? `<a href="${entry.link}" target="_blank" class="text-accent" style="font-size:12px">Virüs Tarama Raporunu Görüntüle →</a>`
                    : ''}
            </div>
        </div>
    `).join('');
}

function renderVirusTotalDetails(entry) {
    if (entry.error) {
        return `<div class="text-orange">Virüs tarama hatası: ${esc(entry.error)}</div>`;
    }

    if (!entry.checked) {
        return '<div class="text-orange">Virüs tarama sorgusu tamamlanamadı.</div>';
    }

    if (!entry.found) {
        return '<div class="text-muted">Virüs tarama veritabanında kayıt bulunamadı.</div>';
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
        : `<span style="color:#f87171">⚠️ Zararlı: <strong>${malicious}</strong></span> / Şüpheli: <strong>${suspicious}</strong> / Toplam: <strong>${total}</strong> motor`;

    return `
        <div class="finding-text">${summaryLine}</div>
        ${!isClean ? `<div class="finding-text" style="margin-top:4px;font-size:12px;color:#94a3b8;">
            Temiz: ${harmless + undetected} &nbsp;|&nbsp; Zararsız: ${harmless} &nbsp;|&nbsp; Tespit edilmedi: ${undetected}
        </div>` : ''}
        ${entry.typeDescription ? `<div class="finding-text">Tür: ${esc(entry.typeDescription)}</div>` : ''}
        ${typeof entry.reputation === 'number' ? `<div class="finding-text">İtibar skoru: ${esc(String(entry.reputation))}</div>` : ''}
        ${entry.maliciousEngines?.length ? `
            <div class="finding-category" style="margin-top:8px;">Zararlı bulan motorlar</div>
            <div class="finding-text">${entry.maliciousEngines.map((engine) => `${esc(engine.engine)} (${esc(engine.result)})`).join(', ')}</div>
        ` : ''}
        ${entry.suspiciousEngines?.length ? `
            <div class="finding-category" style="margin-top:8px;">Şüpheli bulan motorlar</div>
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
            return '<div class="text-red" style="margin-top:8px;">Bu ek, kurum mail güvenlik geçidi tarafından karantinaya alındığı için virüs taramasına gönderilemedi.</div>';
        }

        if (vtStatus?.reason === 'image-local-scan') {
            return '<div class="text-muted" style="margin-top:8px;">Virüs taraması yerine yerel görüntü bütünlüğü kontrolü kullanıldı.</div>';
        }

        if (vtStatus?.reason === 'imap-part-unavailable') {
            return '<div class="text-orange" style="margin-top:8px;">IMAP sunucusu bu ekin dosya içeriğini indirmeye izin vermedi veya boş döndürdü. Dosya adı görünüyor, ancak içerik alınamadığı için virüs taramasına yüklenemedi.</div>';
        }

        if (vtStatus?.available && !vtStatus?.configured) {
            return '<div class="text-orange" style="margin-top:8px;">Virüs tarama API anahtarı tanımlı değil. Bu dosya için yalnızca yerel ek kontrolleri çalıştırıldı.</div>';
        }

        return '<div class="text-muted" style="margin-top:8px;">Virüs tarama sonucu yok.</div>';
    }

    if (vt.error) {
        return `<div class="text-orange" style="margin-top:8px;">Virüs tarama hatası: ${esc(vt.error)}</div>`;
    }

    if (!vt.checked) {
        return '<div class="text-orange" style="margin-top:8px;">Virüs tarama sorgusu tamamlanamadı.</div>';
    }

    if (!vt.found) {
        return '<div class="text-muted" style="margin-top:8px;">Virüs tarama veritabanında kayıt bulunamadı.</div>';
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
        : `<span style="color:#f87171">⚠️ Zararlı: <strong>${malicious}</strong></span> / Şüpheli: <strong>${suspicious}</strong> / Toplam: <strong>${total}</strong> motor`;

    return `
        <div class="finding-text" style="margin-top:8px;">${summaryLine}</div>
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

    return `<div class="finding-text" style="margin-top:8px;">Archive contents: ${items.join(', ')}</div>`;
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
    const claudeResults = document.getElementById('claudeResults');
    const claudeContent = document.getElementById('claudeContent');

    if (!analysis) {
        claudeResults.classList.add('hidden');
        claudeContent.innerHTML = '';
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
            <strong>Ozet:</strong> ${esc(currentLang === 'tr' ? analysis.summaryTR : analysis.summaryEN)}
        </div>
        <div class="grid-2" style="margin-bottom:16px;">
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
            <div class="finding-category" style="margin-bottom:8px;">SUSPICIOUS ELEMENTS IDENTIFIED:</div>
            <ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:8px;">
                ${analysis.suspiciousElements.map((item) => `
                    <li style="background:var(--bg-glass);padding:8px 12px;border-radius:6px;border-left:3px solid var(--orange);font-size:14px;">
                        ${esc(item)}
                    </li>
                `).join('')}
            </ul>
        `;
    }

    claudeResults.classList.remove('hidden');
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
        virusTotal: 'Virüs Kontrolleri',
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

    return `<div class="text-red" style="margin-top:8px;">Archive inspection warning: embedded dangerous file(s) detected -> ${dangerousEntries.map((item) => esc(item.name)).join(', ')}</div>`;
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
    const openaiContent = document.getElementById('openaiContent');
    if (!openaiContent) return;

    // Kart her zaman görünür; sadece içerik değişir
    if (!analysis) {
        openaiContent.innerHTML = `
            <div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:14px;">
                🔑 OpenAI API anahtarı yapılandırılmamış veya bu analiz için AI çalıştırılmadı.
            </div>`;
        return;
    }

    const summary   = currentLang === 'tr' ? analysis.summaryTR   : analysis.summaryEN;
    const narrative = currentLang === 'tr' ? analysis.attackNarrativeTR : analysis.attackNarrativeEN;
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
        ${renderAnalysisList(currentLang === 'tr' ? 'Önerilen Aksiyonlar' : 'Recommended Actions', analysis.recommendedActionsTR)}
        </div>
    `;
}

/** Kart başlığına tıklanınca içeriği gizle/göster */
function toggleOpenaiCard() {
    const content = document.getElementById('openaiContent');
    const icon    = document.getElementById('openaiCollapseIcon');
    if (!content) return;
    const collapsed = content.style.display === 'none';
    content.style.display = collapsed ? '' : 'none';
    if (icon) icon.textContent = collapsed ? '▾' : '▸';
}

function renderAnalysisList(title, items) {
    if (!items || !items.length) return '';
    return `
        <div style="margin-bottom:16px;">
            <div class="finding-category" style="margin-bottom:8px;">${esc(title)}</div>
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
    document.getElementById('claudeResults').classList.add('hidden');
    document.getElementById('claudeContent').innerHTML = '';
    // openaiResults kartı her zaman görünür kalır; sadece içeriği temizle
    document.getElementById('openaiContent').innerHTML = '';
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
function showImapModal() {
    document.getElementById('imapModal').classList.remove('hidden');
}

// ---- Multi-email tag input for Rapor Alıcısı ----
let alertEmailList = [];
let editingImapAlertAccountEmail = null;

function updateAlertDefaultRecipientHint() {
    const hint = document.getElementById('imapAlertDefaultHint');
    if (!hint) return;
    if (!editingImapAlertAccountEmail) {
        hint.innerHTML = '<span style="color:#f87171">⚠️ Tarama posta kutusu tanımlanmamış</span>';
    } else {
        hint.innerHTML = `Birden fazla alıcı ekleyebilirsiniz. Boş bırakılırsa: <span style="opacity:0.45">${editingImapAlertAccountEmail}</span>`;
    }
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
    const alertCheck = document.getElementById('imapRealTimeAlert');
    if (alertCheck) { alertCheck.checked = false; toggleImapRealTimeAlertSection(false); }
    clearAlertEmails();
    const senderSel = document.getElementById('imapAlertSenderAccount');
    if (senderSel) senderSel.value = '';
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
        alert(currentLang === 'tr' ? 'E-posta ve sunucu zorunludur' : 'Email and host are required');
        return;
    }

    // Yeni hesap eklerken şifre zorunlu; düzenlemede boş bırakılırsa IMAP kaydını atla
    if (account.password) {
        const res = await fetch('/api/imap/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(account)
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Failed to save IMAP account');
            return;
        }
    } else if (!isEditMode) {
        alert(currentLang === 'tr' ? 'Yeni hesap için şifre zorunludur' : 'Password is required for new accounts');
        return;
    }

    // Anlık rapor ayarlarını kaydet / sil
    const alert_ = getImapAlertFormData();
    const targetEmail = account.email || editingImapAlertAccountEmail;
    if (alert_.enabled) {
        if (alert_.reportMode === 'all' && licenseInfo?.plan !== 'enterprise') {
            alert_.reportMode = 'risky';
        }
        const headers = { 'Content-Type': 'application/json' };
        if (licenseKey) headers['x-license-key'] = licenseKey;
        await fetch('/api/scan-mailboxes', {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...alert_, imapEmail: targetEmail, realtimeAlert: true })
        }).catch(() => {});
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
        autoSummaryReport: document.getElementById('imapAutoSummaryReport')?.checked === true
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
            select.innerHTML = accounts.map((account) => {
                const isMonitoring = activeMonitorEmails.has(account.email);
                const isReportMenuOpen = activeReportMenuEmail === account.email;
                return `
                <div class="connection-bar imap-account-row ${isMonitoring ? 'monitoring' : ''}" data-account-email="${esc(account.email)}" style="margin-bottom:8px">
                    <span class="status-dot ${isMonitoring ? 'monitoring' : 'connected'}"></span>
                    <strong>${esc(account.email)}</strong>
                    <span class="text-muted">${esc(account.host)}:${account.port}</span>
                    <span style="flex:1"></span>
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
                    </div>
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
            document.getElementById('connectionText').textContent = currentLang === 'tr' ? 'Bagli degil' : 'Not connected';
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
    const okay = confirm(
        currentLang === 'tr'
            ? `${email} hesabini silmek istediginize emin misiniz?`
            : `Are you sure you want to delete ${email}?`
    );
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
    const res = await fetch('/api/imap/accounts');
    const accounts = await res.json();
    const account = accounts.find((item) => item.email === email);
    if (!account) return;

    editingImapAlertAccountEmail = account.email;
    document.getElementById('imapEmail').value = account.email;
    document.getElementById('imapPassword').value = '';
    document.getElementById('imapPassword').placeholder = currentLang === 'tr'
        ? 'Mevcut sifreyi tekrar girin'
        : 'Re-enter current password';
    document.getElementById('imapHost').value = account.host;
    document.getElementById('imapPort').value = account.port || 993;
    document.getElementById('imapIgnoreSSL').checked = account.rejectUnauthorized === false;
    document.getElementById('imapAutoSummaryReport').checked = account.autoSummaryReport === true;

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
        }
    } catch {}

    showImapModal();
}

async function toggleImapAutoReport(email, enabled) {
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
    activeReportMenuEmail = activeReportMenuEmail === email ? null : email;
    loadImapAccounts();
}

async function triggerMailboxReport(email, period) {
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
            <span>${currentLang === 'tr' ? 'Mail listesi yukleniyor...' : 'Loading inbox...'}</span>
        </div>
    `;
    if (!preserveSelection) {
        renderImapReportPlaceholder(
            currentLang === 'tr'
                ? 'Sag tarafta rapor icin bir e-posta sececeksiniz.'
                : 'Select an email to load its health report.'
        );
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
            renderImapReportPlaceholder(
                currentLang === 'tr'
                    ? 'Bu hesapta listelenecek e-posta bulunamadi.'
                    : 'No emails found for this account.'
            );
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
                ${currentLang === 'tr' ? 'Listelenecek mail bulunamadi.' : 'No messages to display.'}
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
            <span class="text-muted" style="font-size:11px">${currentLang === 'tr' ? 'Tümünü seç' : 'Select all'} (${currentImapMessages.length})</span>
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
                    style="flex:1;min-width:0"
                    onclick='openImapMail(${message.uid}, ${JSON.stringify(currentImapEmail)})'
                >
                    <span class="email-bullet"></span>
                    <div class="email-main">
                        <div class="email-head">
                            <div class="email-head-main">
                                <span class="email-from">${esc(from)}</span>
                                ${isMonitoringCurrentMailbox ? `<span class="email-monitor-badge">${currentLang === 'tr' ? 'Izleniyor' : 'Monitoring'}</span>` : ''}
                                ${isScanning ? `<span class="email-monitor-badge">${currentLang === 'tr' ? 'Taraniyor' : 'Scanning'}</span>` : ''}
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
            loadMoreButton.innerHTML = currentLang === 'tr'
                ? `⬇️ <span>Daha Fazla Yükle (${currentImapMessages.length}/${currentImapTotal})</span>`
                : `⬇️ <span>Load More (${currentImapMessages.length}/${currentImapTotal})</span>`;
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

    if (!forceRefresh && imapReportCache.has(cacheKey)) {
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
            body: JSON.stringify({ email: targetEmail, uid, folder: 'INBOX' })
        });
        const data = await res.json();
        inFlightImapScans.delete(cacheKey);
        renderImapMessageList();

        if (!res.ok) {
            throw new Error(data.error || 'Scan failed');
        }

        const normalized = { ...data, imapEmail: targetEmail, imapUid: uid };
        imapReportCache.set(cacheKey, normalized);
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
        alert(currentLang === 'tr' ? 'Önce listeden en az bir mail seçin' : 'Select at least one email from the list first');
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
        button.innerHTML = `✅ <span>${selectedImapUids.size} ${currentLang === 'tr' ? 'Mail Tara' : 'Mails Scan'}</span>`;
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
    const subject = message?.subject || (currentLang === 'tr' ? 'Mail raporu yukleniyor' : 'Loading mail report');
    const from = message?.from?.name || message?.from?.address || '';

    document.getElementById('imapReportPane').innerHTML = `
        <div class="imap-report-loading">
            <div class="inline-spinner"></div>
            <div>
                <div class="imap-group-title">${currentLang === 'tr' ? 'Saglik raporu hazirlaniyor' : 'Preparing health report'}</div>
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
    const groups = groupFindingsByCategory(data.findings || []);

    pane.innerHTML = `
        <div class="imap-health-banner ${data.level}">
            <div class="imap-health-score" style="color:${data.color}">
                <span>${data.score}</span>
            </div>
            <div class="imap-health-copy">
                <h3 style="color:${data.color}">${esc(currentLang === 'tr' ? data.labelTR : data.labelEN)}</h3>
                <p>${esc(riskDescriptionFor(data))}</p>
            </div>
            <div class="imap-health-actions">
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

        ${renderImapAttachmentSection(data)}

        ${renderImapAiSection(data.openaiAnalysis, data.openaiError)}
        ${renderImapClaudeSection(data.claudeAnalysis)}

        <div class="imap-finding-groups">
            ${groups.map((group) => `
                <div class="imap-finding-group">
                    <div class="imap-group-title">
                        <span>${esc(group.label)}</span>
                        <span class="text-muted">${group.items.length}</span>
                    </div>
                    <div class="findings-list">
                        ${group.items.map((finding) => `
                            <div class="finding-item compact">
                                <div class="finding-icon ${finding.severity}">${findingIcon(finding.severity)}</div>
                                <div>
                                    <div class="finding-text">${esc(finding.message)}</div>
                                    <div class="finding-category">${esc(formatCategory(finding.category))}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderImapAttachmentSection(data) {
    const rows = mergeAttachmentScanData(data);
    if (!rows.length) return '';

    return `
        <div class="imap-finding-group" style="margin-bottom:16px;">
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
    const summary    = currentLang === 'tr' ? analysis.summaryTR  : analysis.summaryEN;
    const narrative  = currentLang === 'tr' ? analysis.attackNarrativeTR : analysis.attackNarrativeEN;
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

            ${renderAnalysisList(currentLang === 'tr' ? 'Kırmızı Bayraklar' : 'Red Flags', analysis.redFlagsTR)}
            ${renderAnalysisList(currentLang === 'tr' ? 'Sosyal Mühendislik Sinyalleri' : 'Social Engineering', analysis.socialEngineeringSignalsTR)}
            ${renderAnalysisList(currentLang === 'tr' ? 'Önerilen Aksiyonlar' : 'Recommended Actions', analysis.recommendedActionsTR)}
        </div>
    `;
}

function renderImapClaudeSection(analysis) {
    if (!analysis) return '';
    // Claude returns object: { threatLevel, category, summaryTR, summaryEN, suspiciousElements }
    if (Array.isArray(analysis) || (!analysis.summaryTR && !analysis.summaryEN)) return '';
    const sum = currentLang === 'tr'
        ? (analysis.summaryTR || analysis.summaryEN || '')
        : (analysis.summaryEN || analysis.summaryTR || '');
    return `
        <div class="imap-finding-group" style="margin-bottom:16px;">
            <div class="imap-group-title">
                <span>🤖 Claude AI (Anthropic)</span>
                <span class="text-muted">${esc(analysis.threatLevel || '')}</span>
            </div>
            <div class="finding-item compact" style="margin-bottom:8px;">
                <div>
                    <div class="finding-category">ÖZET</div>
                    <div class="finding-text">${esc(sum)}</div>
                </div>
            </div>
            ${analysis.category ? `
            <div class="finding-item compact" style="margin-bottom:8px;">
                <div>
                    <div class="finding-category">KATEGORİ / TEHDİT SEVİYESİ</div>
                    <div class="finding-text">${esc(analysis.category)} / ${esc(analysis.threatLevel || '-')}</div>
                </div>
            </div>` : ''}
            ${analysis.suspiciousElements?.length ? renderAnalysisList(
                currentLang === 'tr' ? 'Şüpheli Unsurlar' : 'Suspicious Elements',
                analysis.suspiciousElements
            ) : ''}
        </div>
    `;
}

function groupFindingsByCategory(findings) {
    const labels = {
        header:      currentLang === 'tr' ? 'Header Kontrolleri'    : 'Header Checks',
        content:     currentLang === 'tr' ? 'Icerik Kontrolleri'    : 'Content Checks',
        link:        currentLang === 'tr' ? 'Link Kontrolleri'       : 'Link Checks',
        attachment:  currentLang === 'tr' ? 'Ek Kontrolleri'        : 'Attachment Checks',
        virusTotal:  currentLang === 'tr' ? 'Virüs Kontrolleri' : 'Virus Checks',
        general:     currentLang === 'tr' ? 'Genel Kontroller'       : 'General Checks'
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
    ws = new WebSocket(`${protocol}//${location.host}`);

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
                (currentLang === 'tr' ? 'Otomatik izleme baslatildi: ' : 'Automatic monitoring started: ')
                + msg.email
            );
        }

        if (msg.type === 'monitor-stopped') {
            activeMonitorEmails.delete(msg.email);
            updateMonitorButton();
            loadImapAccounts();
            if (currentMode === 'scan-mailbox') loadScanMailboxes();
            alert(
                (currentLang === 'tr' ? 'Otomatik izleme durduruldu: ' : 'Automatic monitoring stopped: ')
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
    fetch('/api/imap/accounts')
        .then((res) => res.json())
        .then((accounts) => {
            if (!accounts.length) {
                alert(currentLang === 'tr' ? 'Kayitli IMAP hesabi yok' : 'No IMAP account');
                return;
            }

            if (!ws || ws.readyState !== WebSocket.OPEN) {
                alert(currentLang === 'tr' ? 'WebSocket baglantisi hazir degil' : 'WebSocket connection is not ready yet');
                return;
            }

            const targetEmail = currentImapEmail || accounts[0]?.email;
            if (!targetEmail) {
                alert(currentLang === 'tr' ? 'Once bir hesap secin' : 'Select an account first');
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
        ? (currentLang === 'tr' ? 'Izlemeyi Durdur' : 'Stop Monitoring')
        : (currentLang === 'tr' ? 'Otomatik Izle' : 'Auto Monitor');

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
            <span class="text-muted" style="font-size:12px">${esc(result.emailMeta?.from?.[0]?.address || '')}</span>
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
            <strong>${currentLang === 'tr' ? 'Arka plan taramasi tamamlandi' : 'Background scan completed'}</strong><br>
            <span class="text-muted" style="font-size:12px">${esc(message?.subject || result.emailMeta?.subject || 'Mail')}</span>
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
    // Activate endpoint hem doğrulama hem de sunucuya kalıcı kayıt yapar.
    // Bu sayede yeni cihaz/restart/versiyon geçişlerinde lisans korunur.
    const res = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
    });
    const payload = await res.json();
    const data = payload.validation || payload; // hata durumunda direkt cevap

    if (res.ok && payload.success && data.valid) {
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
                ${currentLang === 'tr' ? 'Aylık limit' : 'Monthly limit'}: ${limitLabel}
                <br>
                ${currentLang === 'tr' ? 'Son kullanma' : 'Expires'}: ${formatDate(data.expiryDate, true)}
                <div style="font-size:11px;margin-top:8px;color:var(--green)">
                    ✓ ${currentLang === 'tr'
                        ? 'Lisans sunucuya kaydedildi — restart ve versiyon geçişlerinde otomatik korunur.'
                        : 'License saved on server — preserved across restarts and upgrades.'}
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
    let res, data;
    try {
        res  = await fetch('/api/license/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: licenseKey })
        });
        data = await res.json();
    } catch (e) {
        // Sunucu henüz hazır değil (yeniden başlatılıyor) — sessizce atla
        console.warn('[License] validateStoredLicense network error:', e.message);
        return;
    }

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
function showSettings() {
    document.getElementById('settingsModal').classList.remove('hidden');
    loadSettingsStatus();
    loadPeriodicReportSettings();
    loadServiceStatus();
    loadWebhookSettings();
}

function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
    // Reset panelini kapat ve temizle
    const panel = document.getElementById('resetPanel');
    if (panel) { panel.style.display = 'none'; _resetPanelOpen = false; }
    const step2 = document.getElementById('resetStep2');
    if (step2) step2.style.display = 'none';
    ['resetCodeInput','resetNewPassword'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['resetStep1Status','resetStep2Status'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
}

// ─── Admin Şifre Sıfırlama (OTP) ─────────────────────────
let _resetPanelOpen = false;

function toggleResetPanel() {
    const panel = document.getElementById('resetPanel');
    if (!panel) return;
    _resetPanelOpen = !_resetPanelOpen;
    panel.style.display = _resetPanelOpen ? '' : 'none';
}

async function sendAdminResetCode() {
    const statusEl = document.getElementById('resetStep1Status');
    if (statusEl) statusEl.textContent = '⏳ Kod gönderiliyor...';

    try {
        const res = await fetch('/api/admin/send-reset-code', { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
            if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">${esc(data.error || 'Hata')}</span>`;
            return;
        }

        if (statusEl) statusEl.innerHTML = `<span style="color:#34d399">✅ ${esc(data.message)}</span>`;
        // Adım 2 göster
        const step2 = document.getElementById('resetStep2');
        if (step2) step2.style.display = '';
        const codeInput = document.getElementById('resetCodeInput');
        if (codeInput) codeInput.focus();
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">Bağlantı hatası: ${esc(e.message)}</span>`;
    }
}

async function verifyAdminResetCode() {
    const code        = document.getElementById('resetCodeInput')?.value.trim() || '';
    const newPassword = document.getElementById('resetNewPassword')?.value || '';
    const statusEl    = document.getElementById('resetStep2Status');

    if (!code || code.length !== 6) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#f87171">6 haneli kodu girin.</span>';
        return;
    }
    if (!newPassword || newPassword.length < 6) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#f87171">Yeni şifre en az 6 karakter olmalıdır.</span>';
        return;
    }

    if (statusEl) statusEl.textContent = '⏳ Doğrulanıyor...';

    try {
        const res = await fetch('/api/admin/verify-reset-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, newPassword })
        });
        const data = await res.json();

        if (!res.ok) {
            if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">❌ ${esc(data.error || 'Hata')}</span>`;
            return;
        }

        if (statusEl) statusEl.innerHTML = '<span style="color:#34d399;font-weight:700">✅ Şifre başarıyla değiştirildi! Panel kapanıyor...</span>';
        // Alanları temizle
        const codeInput = document.getElementById('resetCodeInput');
        const pwInput   = document.getElementById('resetNewPassword');
        if (codeInput) codeInput.value = '';
        if (pwInput)   pwInput.value   = '';
        setTimeout(() => closeSettings(), 2000);
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">Bağlantı hatası: ${esc(e.message)}</span>`;
    }
}

async function saveSettings() {
    const vtKey     = document.getElementById('vtApiKeyInput').value.trim();
    const otxKey    = document.getElementById('otxApiKeyInput')?.value.trim() || '';
    const claudeKey = document.getElementById('claudeApiKeyInput').value.trim();
    const openaiKey = document.getElementById('openaiApiKeyInput').value.trim();
    const adminPwd  = document.getElementById('adminPasswordInput')?.value || '';
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

    // API anahtarları ve model yalnızca admin şifresiyle kaydedilebilir
    if (!adminPwd) {
        const statusEl = document.getElementById('settingsStatus');
        if (statusEl) {
            statusEl.innerHTML = '<span style="color:#f87171;font-weight:600">⛔ API anahtarı ve model kaydetmek için Admin Şifresi gereklidir.</span>';
            setTimeout(() => { statusEl.textContent = ''; }, 3000);
        }
        return;
    }

    // OpenAI model: "__custom__" seçiliyse text box'tan al, yoksa select değerini kullan
    const modelSel   = document.getElementById('openaiModelSelect');
    const modelInp   = document.getElementById('openaiModelCustom');
    const openaiModel = (modelSel?.value === '__custom__')
        ? (modelInp?.value.trim() || '')
        : (modelSel?.value || '');

    const payload = {
        vtApiKey: vtKey, claudeApiKey: claudeKey, openaiApiKey: openaiKey,
        otxApiKey: otxKey,
        openaiModel,
        adminPassword: adminPwd,
        companyProfile
    };

    const keysRes = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPwd },
        body: JSON.stringify(payload)
    });

    // Admin şifresi alanını her kayıttan sonra temizle
    const adminInput = document.getElementById('adminPasswordInput');
    if (adminInput) adminInput.value = '';

    if (!keysRes.ok) {
        const statusEl = document.getElementById('settingsStatus');
        if (statusEl) {
            statusEl.innerHTML = '<span style="color:#f87171;font-weight:600">⛔ Admin şifresi hatalı veya yetki reddedildi.</span>';
            setTimeout(() => { statusEl.textContent = ''; }, 3000);
        }
        return;
    }

    await fetch('/api/reports/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportSettings)
    });

    await saveWebhookSettings();

    await loadSettingsStatus();
    await loadPeriodicReportSettings();
    // Başarı bildirimi göster, sonra kapat
    const statusEl = document.getElementById('settingsStatus');
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
        }

        statusEl.textContent = [
            `VirusTotal: ${status.vtConfigured ? '✅' : '—'}`,
            `OTX: ${status.otxConfigured ? '✅' : '—'}`,
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
        const adminPwd = document.getElementById('adminPasswordInput')?.value || '';
        const res = await fetch('/api/settings/otx/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPwd },
            body: JSON.stringify({ otxApiKey: apiKey })
        });
        const data = await res.json();
        if (res.ok) {
            statusEl.innerHTML = `<span style="color:var(--green,#00e676)">✅ ${esc(data.message)}</span>`;
        } else {
            statusEl.innerHTML = `<span style="color:#f87171">❌ ${esc(data.error)}</span>`;
        }
    } catch (e) {
        statusEl.innerHTML = `<span style="color:#f87171">❌ Bağlantı hatası: ${esc(e.message)}</span>`;
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
    const doc = new jsPDF();
    const result = currentResult;

    doc.setFontSize(20);
    doc.text('MailTrustAI Security Report', 14, 20);
    doc.setFontSize(12);
    doc.text(`Risk Score: ${result.score}/100 - ${result.labelEN}`, 14, 35);
    doc.text(`Subject: ${result.emailMeta?.subject || 'N/A'}`, 14, 45);
    doc.text(`From: ${result.emailMeta?.from?.[0]?.address || 'N/A'}`, 14, 55);
    doc.text(`Date: ${result.timestamp || new Date().toISOString()}`, 14, 65);
    doc.text('---', 14, 72);

    let y = 80;
    (result.findings || []).forEach((finding) => {
        if (y > 270) {
            doc.addPage();
            y = 20;
        }
        const icon = { critical: '[!]', warning: '[W]', info: '[i]', safe: '[OK]' };
        doc.text(`${icon[finding.severity] || ''} [${finding.category}] ${finding.message}`, 14, y);
        y += 8;
    });

    doc.save(`mailtrustai-report-${result.id || 'scan'}.pdf`);
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
        virusTotal:  'VİRÜS KONTROLLERİ',
        header:      'BAŞLIK',
        content:     'İÇERİK',
        link:        'BAĞLANTI',
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

function riskDescriptionFor(data) {
    return t(`risk_${data.level}_desc`);
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

    if (mins < 1) return currentLang === 'tr' ? 'az once' : 'just now';
    if (mins < 60) return `${mins} ${currentLang === 'tr' ? 'dk once' : 'min ago'}`;

    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${currentLang === 'tr' ? 'sa once' : 'hr ago'}`;

    const days = Math.floor(hours / 24);
    return `${days} ${currentLang === 'tr' ? 'gun once' : 'days ago'}`;
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
                return `
                <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px">
                    <div style="flex:1">
                        <div style="font-weight:500">${esc(smb.imapEmail)}${centralBadge}</div>
                        <div class="text-muted" style="font-size:11px">
                            ${smb.enabled ? '<span style="color:var(--green)">● Aktif</span>' : '<span style="color:#94a3b8">● Pasif</span>'}
                            &nbsp;·&nbsp; ${esc(scanMailboxReportModeLabel(smb.reportMode))}
                            &nbsp;·&nbsp; ${(smb.reportLang || 'tr').toUpperCase()}
                        </div>
                        <div style="font-size:11px;margin-top:3px;color:var(--blue,#60a5fa)">${recipientLabel}</div>
                    </div>
                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px">
                        <input type="checkbox" ${smb.enabled ? 'checked' : ''} onchange="toggleScanMailboxEnabled('${esc(smb.imapEmail)}', this.checked)">
                        ${t('scanmailbox_enabled')}
                    </label>
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
                        const updated = m.updatedAt ? new Date(m.updatedAt).toLocaleString(currentLang === 'tr' ? 'tr-TR' : 'en-US') : '-';
                        const smbEntry = reportToMap.get(String(m.email || '').toLowerCase());
                        const recipientLabel = smbEntry?.reportToForwarder
                            ? '📤 İletilen adrese'
                            : (smbEntry?.reportTo || m.email);
                        return `
                        <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px">
                            <div style="flex:1">
                                <div style="font-weight:500">${esc(m.email)}</div>
                                <div class="text-muted" style="font-size:12px">📡 IMAP otomatik izleme &nbsp;·&nbsp; ${isActive ? '<span style="color:var(--green)">● Aktif</span>' : '<span style="color:#f59e0b">● Bekliyor</span>'}</div>
                                <div style="font-size:11px;margin-top:3px;color:var(--blue,#60a5fa)">Rapor: ${esc(recipientLabel)}</div>
                                <div class="text-muted" style="font-size:11px">Eklendi: ${esc(updated)}</div>
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

async function showScanMailboxModal() {
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
        ['smImapHost','smImapEmail','smImapPassword','smSmtpHost','smSmtpPassword','smReportTo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; if (el.dataset) el.dataset.userEdited = 'false'; }
        });
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

function onSmReportTargetChange() {
    const isForwarder = document.getElementById('smReportTargetForwarder')?.checked;
    const wrap = document.getElementById('smReportToWrap');
    if (wrap) wrap.classList.toggle('hidden', !!isForwarder);
}

function closeScanMailboxModal() {
    document.getElementById('scanMailboxModal').classList.add('hidden');
    document.getElementById('smTestResult').innerHTML = '';
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
        return currentLang === 'tr' ? 'tum mailler' : 'all emails';
    }
    return currentLang === 'tr' ? 'yalniz riskli' : 'risky only';
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
    if (!data.imapPassword) {
        showSmError('⚠️ IMAP şifresi zorunludur.');
        return;
    }
    if (!data.smtpHost) {
        showSmError('⚠️ SMTP sunucu adresi zorunludur.');
        return;
    }
    if (!data.reportToForwarder && !data.reportTo) {
        showSmError(currentLang === 'tr'
            ? '⚠️ "Belirli adrese gönder" seçildiğinde bir e-posta adresi girilmesi zorunludur.'
            : '⚠️ Please enter a recipient email address.');
        return;
    }
    if (data.reportMode === 'all' && licenseInfo?.plan !== 'enterprise') {
        showSmError(currentLang === 'tr'
            ? '❌ "Tüm mailler" modu yalnızca Enterprise lisansında kullanılabilir. Lütfen "Sadece riskli mailler" seçeneğini kullanın.'
            : '❌ "All emails" report mode requires an Enterprise license. Please use "Risky only".');
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
            showSmError(`❌ ${result.error || (currentLang === 'tr' ? 'Kayıt başarısız' : 'Save failed')}`);
        }
    } catch (e) {
        showSmError(`❌ ${e.message}`);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
    }
}

async function deleteScanMailbox(imapEmail) {
    if (!confirm(currentLang === 'tr' ? `${imapEmail} silinsin mi?` : `Delete ${imapEmail}?`)) return;
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
        const res = await fetch('/api/admin/status');
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
        const res = await fetch(`/api/admin/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        // Sunucu bazen yanıt göndermeden çıkabilir (restart); JSON parse hatasına karşı güvenli
        let data = {};
        try { data = await res.json(); } catch (_) { /* yanıt kesintili — devam et */ }

        if (!res.ok) {
            if (statusEl) statusEl.textContent = `Hata: ${data.error || res.status}`;
            return;
        }
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--green,#00e676)">${esc(data.message || 'İşlem gönderildi.')}</span>`;
        if (action === 'restart') {
            // 4 saniye sonra sayfayı yenile (sunucunun yeniden başlaması için zaman tanı)
            if (statusEl) statusEl.innerHTML += '<br><span class="text-muted" style="font-size:11px">Sayfa 4 saniye içinde yeniden yüklenecek...</span>';
            setTimeout(() => location.reload(), 4000);
        }
    } catch (e) {
        // Ağ hatası (sunucu kapalı) bile olsa restart başarılı sayılabilir
        if (action === 'restart') {
            if (statusEl) statusEl.innerHTML = '<span style="color:var(--green,#00e676)">🔄 Servis yeniden başlatılıyor...</span><br><span class="text-muted" style="font-size:11px">Sayfa 5 saniye içinde yeniden yüklenecek...</span>';
            setTimeout(() => location.reload(), 5000);
        } else {
            if (statusEl) statusEl.textContent = `Bağlantı hatası: ${e.message}`;
        }
    }
}

async function updateScanMailboxReportMode(imapEmail, reportMode) {
    if (reportMode === 'all' && licenseInfo?.plan !== 'enterprise') {
        alert(currentLang === 'tr'
            ? '❌ "Tüm mailler" modu yalnızca Enterprise lisansında kullanılabilir.'
            : '❌ "All emails" report mode requires an Enterprise license.');
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
    const homePanel  = document.getElementById('homePanel');
    const statsPanel = document.getElementById('statsPanel');
    const mainPanels = ['connectionBar','scanModes','panelUpload','panelPaste',
                        'panelImap','panelScanMailbox','scanProgress','resultsPanel',
                        'historyPanel','listsPanel'];

    const tabHome  = document.getElementById('navTabHome');
    const tabScan  = document.getElementById('navTabScan');
    const tabStats = document.getElementById('navTabStats');

    // Önce her şeyi gizle
    if (homePanel)  homePanel.style.display  = 'none';
    if (statsPanel) statsPanel.style.display = 'none';
    [tabHome, tabScan, tabStats].forEach(t => t && t.classList.remove('active'));

    if (page === 'home') {
        if (homePanel) homePanel.style.display = '';
        mainPanels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (tabHome) tabHome.classList.add('active');
        loadHomePage();
    } else if (page === 'stats') {
        if (statsPanel) statsPanel.style.display = '';
        mainPanels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (tabStats) tabStats.classList.add('active');
        loadStatsPage();
    } else {
        // 'scan' (varsayılan)
        // Her paneli inline style'dan arındır; görünürlüğü mevcut .hidden sınıfı yönetir
        mainPanels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
        if (tabScan) tabScan.classList.add('active');
    }
}

// ─── İSTATİSTİK SAYFASI ───────────────────────────────────
async function loadStatsPage() {
    await Promise.all([_cuLoadStats(), loadDetailedStatsCustomer()]);
}

// Üst tarih aralığı butonları — hem özet hem ayrıntılı raporu aynı aralıkla yükler
function setStatsRange(value) {
    // Aktif buton stil güncelleme
    ['7','30','90','365','Custom'].forEach(k => {
        const btn = document.getElementById('rangeBtn' + k);
        if (btn) btn.style.borderColor = '';
    });
    const wrap = document.getElementById('topRangeWrap');

    if (value === 'custom') {
        const btn = document.getElementById('rangeBtnCustom');
        if (btn) btn.style.borderColor = 'var(--accent)';
        // Default 30 gün önce → bugün
        const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const end   = new Date().toISOString().slice(0, 10);
        const sIn = document.getElementById('topStatsStart');
        const eIn = document.getElementById('topStatsEnd');
        if (sIn && !sIn.value) sIn.value = start;
        if (eIn && !eIn.value) eIn.value = end;
        if (wrap) wrap.style.display = '';
        return;
    }

    // Preset gün sayısı
    if (wrap) wrap.style.display = 'none';
    const days = String(value);
    const btn  = document.getElementById('rangeBtn' + days);
    if (btn) btn.style.borderColor = 'var(--accent)';

    // Alttaki dropdown'u senkronla — eğer bu değer mevcut option'lardan biri değilse "30" varsayalım
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
    document.getElementById('cuStatsIntegrations').innerHTML = `
        <div style="margin-bottom:14px">
            ${_cuBar('🦠 VirusTotal Tespiti', d.vtHits || 0, total || 1, '#f87171')}
            <div style="font-size:11px;color:var(--text-secondary);margin-top:-6px">İsabet oranı: ${vtPct}%</div>
        </div>
        <div>
            ${_cuBar('🌐 AlienVault OTX Tespiti', d.otxHits || 0, total || 1, '#fb923c')}
            <div style="font-size:11px;color:var(--text-secondary);margin-top:-6px">İsabet oranı: ${otxPct}%</div>
        </div>
    `;
}

function _cuRenderCategories(cats) {
    if (!cats.length) {
        document.getElementById('cuStatsCategories').innerHTML = '<p class="text-muted">Henüz tehdit kaydı yok.</p>';
        return;
    }
    const catLabels = {
        virusTotal:  '🦠 VirusTotal', otx: '🌐 OTX',
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
            <div class="stat-card"><div class="stat-value" style="color:#f87171">${d.riskyTotal}</div><div class="stat-label">Riskli</div></div>
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
            <th style="text-align:center;padding:10px" title="Yüksek Risk">🔴</th>
            <th style="text-align:center;padding:10px" title="Orta Risk">🟠</th>
            <th style="text-align:center;padding:10px" title="Düşük Risk">🟡</th>
            <th style="text-align:center;padding:10px" title="Güvenli">🟢</th>
            <th style="text-align:center;padding:10px">Riskli</th>
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
        return `<div style="margin-bottom:8px">
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
    await Promise.all([loadHomeStats(), loadHomeRecentScans(), loadHomeThreatIntel()]);
}

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
                <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.emailMeta?.subject || 'Konu yok')}</div>
                    <div style="font-size:11px;color:var(--text-secondary)">${esc(item.emailMeta?.from?.[0]?.address || '')} &nbsp;·&nbsp; ${timeAgo(item.timestamp)}</div>
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
                <span style="font-size:11px;color:var(--text-secondary)">${updated}</span>
            </div>
            <div style="display:flex;gap:16px;margin-top:4px">
                <div><span style="font-size:20px;font-weight:700;color:var(--red)">${(data.domainCount||0).toLocaleString()}</span><div style="font-size:11px;color:var(--text-secondary)">Tehdit Domain</div></div>
                <div><span style="font-size:20px;font-weight:700;color:var(--orange)">${(data.urlCount||0).toLocaleString()}</span><div style="font-size:11px;color:var(--text-secondary)">Tehdit URL</div></div>
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
        container.innerHTML = '<span class="text-muted" style="font-size:12px">Henüz kayıt yok.</span>';
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
            if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">${esc(data.error || 'Hata')}</span>`;
            return;
        }
        if (input) input.value = '';
        if (statusEl) {
            statusEl.innerHTML = `<span style="color:var(--green,#00e676)">✅ Eklendi</span>`;
            setTimeout(() => { statusEl.textContent = ''; }, 2000);
        }
        loadListsPanel();
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">${esc(e.message)}</span>`;
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

async function saveWebhookSettings() {
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">${esc(data.error || 'Hata')}</span>`;
            return;
        }
        if (statusEl) {
            statusEl.innerHTML = '<span style="color:var(--green,#00e676)">✅ Webhook ayarları kaydedildi.</span>';
            setTimeout(() => { statusEl.textContent = ''; }, 2500);
        }
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">${esc(e.message)}</span>`;
    }
}

async function testWebhookConnection() {
    const urlEl = document.getElementById('webhookUrl');
    const statusEl = document.getElementById('webhookTestStatus');
    const url = (urlEl?.value || '').trim();

    if (!url) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#f87171">Webhook URL giriniz.</span>';
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
            if (statusEl) statusEl.innerHTML = `<span style="color:var(--green,#00e676)">✅ Bağlantı başarılı (HTTP ${data.status})</span>`;
        } else {
            if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">❌ Bağlantı başarısız: ${esc(data.error || String(data.status || ''))}</span>`;
        }
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">Bağlantı hatası: ${esc(e.message)}</span>`;
    }
}
