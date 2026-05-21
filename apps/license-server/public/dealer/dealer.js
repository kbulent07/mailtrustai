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
        $('dealerCredits').textContent  = (d.credits || 0).toLocaleString('tr-TR');
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
    const licCount = c.licenses.length;
    const activeCount = c.licenses.filter(l => l.status === 'active').length;
    const summaryBadge = activeCount > 0
        ? `<span class="tag tag-active">${activeCount} Aktif</span>`
        : `<span class="tag tag-expired">Aktif Yok</span>`;

    const licensesHtml = licCount === 0
        ? '<p class="muted" style="padding:8px 0">Lisans yok.</p>'
        : `<table style="margin-top:8px">
            <thead><tr>
                <th>Lisans</th><th>Plan</th><th>Durum</th>
                <th>Bitiş</th><th>Son Bağlantı</th>
            </tr></thead>
            <tbody>${c.licenses.map(l => buildLicenseRow(l)).join('')}</tbody>
           </table>`;

    return `<div class="customer-block">
        <div class="customer-header">
            <span class="arrow" style="color:var(--muted);font-size:.8em">▼</span>
            <span class="customer-name">${escapeHtml(c.companyName || c.id)}</span>
            <span class="muted" style="font-size:.8em">${escapeHtml(c.email || '')}</span>
            ${summaryBadge}
            <span class="muted" style="font-size:.75em;margin-left:auto">${fmtDate(c.createdAt)}</span>
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
