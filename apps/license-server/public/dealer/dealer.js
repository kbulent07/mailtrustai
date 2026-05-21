'use strict';
// MailTrustAI — Bayi Paneli (dealer.js)

const DEALER_TOKEN_KEY = 'msa-dealer-token';
const DEALER_ID_KEY    = 'msa-dealer-id';

const $ = (id) => document.getElementById(id);

// ─── HTTP yardımcısı ──────────────────────────────────────────────────────────
async function api(path, opts = {}) {
    const token   = sessionStorage.getItem(DEALER_TOKEN_KEY) || '';
    const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (token) headers.authorization = `Bearer ${token}`;
    const res  = await fetch(path, {
        method:  opts.method || 'GET',
        headers,
        body:    opts.body != null ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (!res.ok) {
        const err = new Error(json?.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return json || {};
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('tr-TR');
}

function fmtPrice(val, currency = 'TRY') {
    return Number(val).toLocaleString('tr-TR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    }) + ' ' + currency;
}

function timeAgo(ms) {
    if (!ms) return '—';
    const d = Date.now() - ms;
    if (d < 60_000)    return Math.floor(d / 1000)     + ' sn önce';
    if (d < 3600_000)  return Math.floor(d / 60_000)   + ' dk önce';
    if (d < 86400_000) return Math.floor(d / 3600_000) + ' sa önce';
    return Math.floor(d / 86400_000) + ' gün önce';
}

function showToast(msg, type = 'info') {
    const icons = { info: 'ℹ', error: '✕', success: '✓' };
    const host  = $('toast-host');
    const el    = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = (icons[type] || 'ℹ') + '  ' + String(msg);
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, 3500);
}

// ─── Tab yönetimi ─────────────────────────────────────────────────────────────
function activateTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tabName)
    );
    document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `panel-${tabName}`)
    );
    if (tabName === 'pricing')   loadPricing();
    if (tabName === 'customers') loadCustomers();
    if (tabName === 'credits')   loadCreditLog();
}

document.querySelectorAll('.tab-btn').forEach(b =>
    b.addEventListener('click', () => activateTab(b.dataset.tab))
);

// ─── LOGIN ────────────────────────────────────────────────────────────────────
$('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dealerId = ($('dealerId').value || '').trim();
    const password = $('dealerPw').value || '';
    const errEl    = $('loginError');
    const btn      = e.target.querySelector('button[type=submit]');
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = '⏳ Doğrulanıyor...';
    try {
        const r = await fetch('/api/dealer/login', {
            method:  'POST',
            headers: { 'content-type': 'application/json' },
            body:    JSON.stringify({ dealerId, password })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);

        sessionStorage.setItem(DEALER_TOKEN_KEY, data.sessionToken || '');
        sessionStorage.setItem(DEALER_ID_KEY,    data.dealerId      || dealerId);

        $('dealerNamePill').textContent = data.name || data.dealerId;
        showDashboard();
        loadDealerMe();
        loadPricing();
    } catch (err) {
        errEl.textContent = 'Hata: ' + (err.message || 'giriş başarısız');
    } finally {
        btn.disabled = false; btn.textContent = '🔓 Giriş Yap';
    }
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
$('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/dealer/logout', { method: 'POST' }); } catch (_) {}
    sessionStorage.removeItem(DEALER_TOKEN_KEY);
    sessionStorage.removeItem(DEALER_ID_KEY);
    location.reload();
});

// ─── UI görünürlük yardımcıları ───────────────────────────────────────────────
function showDashboard() {
    $('loginScreen').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
}

// ─── Bayi bilgisi + kredi ─────────────────────────────────────────────────────
async function loadDealerMe() {
    try {
        const r = await api('/api/dealer/me');
        const d = r.dealer || {};
        $('dealerNamePill').textContent = d.name || d.id || '—';
        const credits = d.credits ?? 0;
        $('dealerCredits').textContent  = credits.toLocaleString('tr-TR');
        checkCreditWarning(credits);
    } catch (_) {}
}

// ─── FİYATLANDIRMA ────────────────────────────────────────────────────────────
const PLAN_LABELS   = { demo: '🆓 Demo', pro: '⭐ Pro', enterprise: '🏢 Enterprise' };
const PERIOD_LABELS = { monthly: 'Aylık', annual: 'Yıllık' };

async function loadPricing() {
    const tbody   = $('pricingBody');
    const infoDiv = $('pricingInfo');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Yükleniyor...</td></tr>';
    try {
        const r = await api('/api/dealer/pricing');
        const plans = r.plans || [];
        const mult  = r.enterpriseMultiplier || 1.20;
        const unit  = r.creditUnit || 'tarama';

        if (infoDiv) {
            infoDiv.innerHTML =
                `<strong>Kredi Birimi:</strong> 1 ${escapeHtml(unit)} = 1 kredi &nbsp;|&nbsp;
                 <strong>Enterprise Çarpanı:</strong> Pro × ${mult.toFixed(2)} &nbsp;|&nbsp;
                 <strong>Toplam Plan:</strong> ${plans.length} &nbsp;|&nbsp;
                 <span style="color:#94a3b8;font-size:.9em">Fiyatlar KDV hariçtir.</span>`;
        }

        if (!plans.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Aktif fiyat planı bulunmuyor.</td></tr>';
            return;
        }

        tbody.innerHTML = plans.map(p => {
            const planTag   = `<span class="tag tag-${p.plan}">${escapeHtml(PLAN_LABELS[p.plan] || p.plan)}</span>`;
            const periodTag = `<span class="tag tag-${p.billing_period}">${escapeHtml(PERIOD_LABELS[p.billing_period] || p.billing_period)}</span>`;
            const priceCell = `<span class="price-val">${fmtPrice(p.base_price, p.currency)}</span>
                               <br><span class="price-sub">${p.billing_period === 'monthly' ? 'ay' : 'yıl'}</span>`;
            const credCell  = `<span class="included-credits">${Number(p.included_credits).toLocaleString('tr-TR')} ${escapeHtml(unit)}</span>`;
            const extraCell = p.extra_credit_price > 0
                ? `<span class="extra-price">${fmtPrice(p.extra_credit_price, p.currency)} / ${escapeHtml(unit)}</span>`
                : '<span class="muted">—</span>';
            return `<tr>
                <td>${planTag}</td>
                <td>${periodTag}</td>
                <td>${priceCell}</td>
                <td>${credCell}</td>
                <td>${extraCell}</td>
                <td class="muted">${escapeHtml(p.notes || '—')}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="err-msg">Yüklenemedi: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// ─── MÜŞTERİLER ──────────────────────────────────────────────────────────────
async function loadCustomers() {
    const listDiv = $('customerList');
    if (!listDiv) return;
    listDiv.innerHTML = '<div class="loading">Yükleniyor...</div>';
    $('customerStats').style.display = 'none';
    try {
        const r = await api('/api/dealer/customers');
        const customers = r.customers || [];

        // İstatistik kartları
        let totalActive = 0, totalExpired = 0;
        customers.forEach(c => c.licenses.forEach(l => {
            if (l.status === 'active') totalActive++;
            if (l.expiresAt && l.expiresAt < Date.now()) totalExpired++;
        }));
        $('statTotalCustomers').textContent = customers.length;
        $('statActiveL').textContent  = totalActive;
        $('statExpiredL').textContent = totalExpired;
        $('customerStats').style.display = 'flex';

        if (!customers.length) {
            listDiv.innerHTML = '<div class="empty-msg">Henüz müşteri kaydı yok.</div>';
            return;
        }

        listDiv.innerHTML = customers.map(c => buildCustomerBlock(c)).join('');

        // Accordion toggle
        listDiv.querySelectorAll('.customer-header').forEach(h => {
            h.addEventListener('click', () => {
                const body = h.nextElementSibling;
                if (body) body.classList.toggle('hidden');
                const arrow = h.querySelector('.arrow');
                if (arrow) arrow.textContent = body?.classList.contains('hidden') ? '▶' : '▼';
            });
        });
    } catch (e) {
        listDiv.innerHTML = `<div class="err-msg">Yüklenemedi: ${escapeHtml(e.message)}</div>`;
    }
}

function buildCustomerBlock(c) {
    const licCount    = c.licenses.length;
    const activeCount = c.licenses.filter(l => l.status === 'active').length;
    const summaryBadge = activeCount > 0
        ? `<span class="tag tag-active">${activeCount} Aktif</span>`
        : `<span class="tag tag-expired">Aktif Yok</span>`;

    const licensesHtml = licCount === 0
        ? '<p class="muted" style="padding:8px 0">Lisans yok.</p>'
        : `<div style="overflow-x:auto"><table style="margin-top:8px">
            <thead><tr>
                <th>Lisans</th><th>Plan</th><th>Durum</th>
                <th>Bitiş</th><th>Son Bağlantı</th>
            </tr></thead>
            <tbody>${c.licenses.map(l => buildLicenseRow(l)).join('')}</tbody>
           </table></div>`;

    const cid   = escapeHtml(c.id);
    const cname = escapeHtml(c.companyName || c.id);

    return `<div class="customer-block">
        <div class="customer-header">
            <span class="arrow" style="color:var(--muted);font-size:.8em">▼</span>
            <span class="customer-name">${cname}</span>
            <span class="muted" style="font-size:.8em">${escapeHtml(c.email || '')}</span>
            ${summaryBadge}
            <button class="btn-clic" data-cid="${cid}" data-cname="${cname}"
                style="margin-left:auto;font-size:.75em;padding:3px 10px;border-radius:5px;border:1px solid var(--primary);background:transparent;color:var(--primary);cursor:pointer"
                onclick="event.stopPropagation();openCreateLicModal('${cid}','${cname}')">
                ➕ Lisans Üret
            </button>
            <span class="muted" style="font-size:.75em">${fmtDate(c.createdAt)}</span>
        </div>
        <div class="customer-body">
            ${licensesHtml}
        </div>
    </div>`;
}

function buildLicenseRow(l) {
    const planTag    = `<span class="tag tag-${l.plan || 'demo'}">${escapeHtml(l.plan || '—')}</span>`;
    const now        = Date.now();
    const isExpired  = l.expiresAt && l.expiresAt < now;
    let   statusTag;
    if (l.status === 'revoked')       statusTag = '<span class="tag tag-revoked">İptal</span>';
    else if (isExpired)               statusTag = '<span class="tag tag-expired">Süresi Doldu</span>';
    else if (l.status === 'active')   statusTag = '<span class="tag tag-active">Aktif</span>';
    else                              statusTag = `<span class="tag">${escapeHtml(l.status || '—')}</span>`;

    const onlineBadge = l.lastHeartbeatAt && (now - l.lastHeartbeatAt) < 300_000
        ? '<span class="tag tag-online" title="Son 5 dk içinde bağlandı">🟢 Çevrimiçi</span>'
        : '';

    return `<tr>
        <td><code style="font-size:.8em">${escapeHtml(l.keyMasked || l.id)}</code>
            ${l.label ? `<br><span class="muted" style="font-size:.75em">${escapeHtml(l.label)}</span>` : ''}</td>
        <td>${planTag}</td>
        <td>${statusTag} ${onlineBadge}</td>
        <td>${fmtDate(l.expiresAt)}</td>
        <td><span class="muted">${l.lastHeartbeatAt ? timeAgo(l.lastHeartbeatAt) : '—'}</span></td>
    </tr>`;
}

$('refreshCustomersBtn')?.addEventListener('click', loadCustomers);
$('refreshCreditsBtn')?.addEventListener('click', loadCreditLog);

// ─── KREDİ HAREKETLERİ ───────────────────────────────────────────────────────
async function loadCreditLog() {
    const tbody = $('creditLogBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Yükleniyor...</td></tr>';
    try {
        const r = await api('/api/dealer/credit-log?limit=100');
        const log = r.log || [];
        if (!log.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">Henüz kredi hareketi yok.</td></tr>';
            return;
        }
        tbody.innerHTML = log.map(row => {
            const deltaColor = row.delta > 0 ? '#34d399' : '#f87171';
            const deltaText  = row.delta > 0 ? `+${row.delta}` : String(row.delta);
            const reasonMap  = {
                'credit.load':     '⬆️ Kredi Yükleme',
                'credit.manual':   '✏️ Manuel Düzenleme',
                'license.create':  '🔑 Lisans Üretimi',
                'credit.deduct':   '➖ Kesinti'
            };
            const reasonLabel = reasonMap[row.reason] || escapeHtml(row.reason || '—');
            return `<tr>
                <td style="white-space:nowrap">${fmtDate(row.created_at)}<br>
                    <span style="font-size:.75em;color:var(--muted)">${new Date(row.created_at).toLocaleTimeString('tr-TR')}</span></td>
                <td style="color:${deltaColor};font-weight:600;font-size:1.05em">${deltaText}</td>
                <td style="font-weight:600">${row.balance != null ? row.balance.toLocaleString('tr-TR') : '—'}</td>
                <td>${reasonLabel}</td>
                <td style="font-size:.82em;color:var(--muted)">${escapeHtml(row.description || '—')}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="err-msg">Yüklenemedi: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// ─── YENİ MÜŞTERİ MODALI ─────────────────────────────────────────────────────
function openAddCustomerModal() {
    ['ncCustomerId','ncCompanyName','ncEmail','ncContactName','ncPhone'].forEach(id => {
        const el = $(id); if (el) el.value = '';
    });
    $('ncResult').textContent = '';
    $('addCustomerModal').style.display = 'flex';
    $('ncCustomerId')?.focus();
}

function closeAddCustomerModal() {
    $('addCustomerModal').style.display = 'none';
}

$('addCustomerBtn')?.addEventListener('click', openAddCustomerModal);
$('ncCancel')?.addEventListener('click', closeAddCustomerModal);
$('addCustomerModal')?.addEventListener('click', e => {
    if (e.target === $('addCustomerModal')) closeAddCustomerModal();
});

$('ncSave')?.addEventListener('click', async () => {
    const resEl = $('ncResult');
    const customerId   = ($('ncCustomerId')?.value   || '').trim();
    const companyName  = ($('ncCompanyName')?.value  || '').trim();
    const email        = ($('ncEmail')?.value        || '').trim();
    const contactName  = ($('ncContactName')?.value  || '').trim();
    const contactPhone = ($('ncPhone')?.value        || '').trim();

    if (!customerId) { resEl.style.color='#f87171'; resEl.textContent='Müşteri ID zorunlu.'; return; }
    resEl.style.color='#94a3b8'; resEl.textContent='Kaydediliyor...';
    try {
        await api('/api/dealer/customers', {
            method: 'POST',
            body: { customerId, companyName, email, contactName, contactPhone }
        });
        resEl.style.color = '#34d399';
        resEl.textContent = '✅ Müşteri kaydedildi.';
        showToast('Müşteri kaydedildi: ' + (companyName || customerId), 'success');
        setTimeout(closeAddCustomerModal, 800);
        loadCustomers();
    } catch (e) {
        resEl.style.color = '#f87171';
        resEl.textContent = 'Hata: ' + e.message;
    }
});

// ─── LİSANS ÜRET MODALI ──────────────────────────────────────────────────────
let _clicCustomerId = null;

function openCreateLicModal(customerId, customerName) {
    _clicCustomerId = customerId;
    $('clicCustomerName').textContent = decodeURIComponent ? customerName : customerName;
    $('clicResult').textContent = '';
    $('clicPlan').value  = 'pro';
    $('clicDays').value  = '365';
    $('clicLabel').value = '';
    $('createLicModal').style.display = 'flex';
}

function closeCreateLicModal() {
    $('createLicModal').style.display = 'none';
}

$('clicCancel')?.addEventListener('click', closeCreateLicModal);
$('createLicModal')?.addEventListener('click', e => {
    if (e.target === $('createLicModal')) closeCreateLicModal();
});

$('clicPlan')?.addEventListener('change', function() {
    // Demo seçilince süreyi 14 ile sınırla
    if (this.value === 'demo') {
        const daysEl = $('clicDays');
        if (daysEl && Number(daysEl.value) > 14) daysEl.value = '14';
    }
});

$('clicCreate')?.addEventListener('click', async () => {
    const resEl = $('clicResult');
    if (!_clicCustomerId) return;
    const plan     = $('clicPlan')?.value  || 'pro';
    const validDays= Number($('clicDays')?.value) || 365;
    const label    = ($('clicLabel')?.value || '').trim();

    resEl.style.color = '#94a3b8'; resEl.textContent = '⏳ Lisans üretiliyor...';
    $('clicCreate').disabled = true;

    try {
        const r = await api('/api/dealer/licenses', {
            method: 'POST',
            body: { customerId: _clicCustomerId, plan, validDays, label: label || undefined }
        });
        resEl.style.color = '#34d399';
        resEl.textContent = `✅ Lisans üretildi! Kalan kredi: ${r.remainingCredits}`;
        showToast('Lisans üretildi. Kalan kredi: ' + r.remainingCredits, 'success');
        // Kredi sayacını güncelle
        $('dealerCredits').textContent = r.remainingCredits.toLocaleString('tr-TR');
        checkCreditWarning(r.remainingCredits);
        // Lisans anahtarını göster
        setTimeout(() => {
            resEl.innerHTML += `<br><strong>Lisans Anahtarı:</strong> <code style="font-size:.85em">${escapeHtml(r.licenseKey)}</code>
                <button onclick="navigator.clipboard.writeText('${escapeHtml(r.licenseKey)}');showToast('Kopyalandı','success')"
                    style="margin-left:6px;font-size:.75em;padding:2px 8px;border-radius:4px;border:1px solid #4ade80;background:transparent;color:#4ade80;cursor:pointer">📋 Kopyala</button>`;
        }, 200);
        loadCustomers();
        loadDealerMe();
    } catch (e) {
        resEl.style.color = '#f87171';
        resEl.textContent = 'Hata: ' + e.message;
        if (e.status === 402) {
            resEl.textContent = '⚠️ Yetersiz kredi! Yöneticinizden kredi yüklemesini isteyin.';
        }
    } finally {
        $('clicCreate').disabled = false;
    }
});

// ─── Kredi uyarısı (başlangıçta veya yenileme sonrası) ────────────────────────
function checkCreditWarning(credits) {
    const pill   = $('dealerCredits');
    const banner = $('creditWarningBanner');
    const text   = $('creditWarningText');
    if (!pill) return;

    if (credits === 0) {
        pill.style.color = '#ef4444';
        pill.title = '⚠️ Krediniz tükendi!';
        if (banner) {
            text.textContent = '⚠️ Krediniz tükendi! Yeni lisans üretemezsiniz. Lütfen yöneticinizle iletişime geçin.';
            banner.classList.remove('hidden');
            banner.style.display = 'flex';
        }
    } else if (credits <= 5) {
        pill.style.color = '#f59e0b';
        pill.title = `⚠️ Düşük kredi: ${credits} kaldı.`;
        if (banner) {
            text.textContent = `⚠️ Kredi bakiyeniz çok düşük: ${credits} kredi kaldı. Yakında lisans üretemeyeceksiniz.`;
            banner.classList.remove('hidden');
            banner.style.display = 'flex';
            banner.style.background = '#451a03';
            banner.style.color = '#fcd34d';
            banner.style.borderColor = '#92400e';
        }
    } else {
        pill.style.color = '#10b981';
        pill.title = '';
        if (banner) banner.classList.add('hidden');
    }
}

// ─── BOOT: mevcut session kontrolü ───────────────────────────────────────────
(async function boot() {
    const t = sessionStorage.getItem(DEALER_TOKEN_KEY);
    if (!t) return;
    try {
        const r = await api('/api/dealer/me');
        const d = r.dealer || {};
        $('dealerNamePill').textContent = d.name || d.id || '—';
        $('dealerCredits').textContent  = (d.credits || 0).toLocaleString('tr-TR');
        showDashboard();
        loadPricing();
    } catch (_) {
        sessionStorage.removeItem(DEALER_TOKEN_KEY);
        sessionStorage.removeItem(DEALER_ID_KEY);
    }
})();
