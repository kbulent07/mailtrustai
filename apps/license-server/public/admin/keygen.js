'use strict';
// MailTrustAI — Merkezi Yönetim Paneli  (keygen.js)
// Tüm sekmeler: Özet · Müşteriler · Bayiler · Lisans Üret · Lisans Yönet · Audit Log

const TOKEN_KEY = 'msa-admin-token';
let allItems     = [];   // /api/admin/customers (flat)
let groupedItems = [];   // /api/admin/customers-grouped
let allDealers   = [];   // /api/admin/dealers
let viewMode     = 'flat';

const $ = (id) => document.getElementById(id);

// ================================================================
// HTTP yardımcısı
// ================================================================
async function api(path, opts = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(path, {
        method : opts.method || 'GET',
        headers,
        body   : opts.body != null ? JSON.stringify(opts.body) : undefined
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

// ================================================================
// Ortak yardımcılar
// ================================================================
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(ms) {
    const d = Date.now() - ms;
    if (d < 60_000)    return Math.floor(d/1000)     + ' sn önce';
    if (d < 3600_000)  return Math.floor(d/60_000)   + ' dk önce';
    if (d < 86400_000) return Math.floor(d/3600_000) + ' sa önce';
    return Math.floor(d/86400_000) + ' gün önce';
}

function fmtDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('tr-TR');
}

function fmtDateTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('tr-TR');
}

// ================================================================
// SEKMELİ NAVİGASYON
// ================================================================
function activateTab(tabName) {
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tabName);
    });
    // Her sekme açıldığında ilgili veriyi yükle
    if (tabName === 'dealers')  loadDealers();
    if (tabName === 'manage')   renderManageTable();
    if (tabName === 'audit')    loadAudit();
}

document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => activateTab(el.dataset.tab));
});

// ================================================================
// LOGIN / LOGOUT
// ================================================================
$('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token  = $('adminToken').value.trim();
    const errEl  = $('loginError');
    const btn    = $('loginBtn');
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = '⏳ Doğrulanıyor...';
    try {
        const r = await fetch('/api/admin/login', {
            method : 'POST',
            headers: { 'content-type': 'application/json' },
            body   : JSON.stringify({ token })
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || `HTTP ${r.status}`);
        }
        sessionStorage.setItem(TOKEN_KEY, token);
        showDashboard();
    } catch (e) {
        errEl.textContent = 'Hata: ' + (e.message || 'giriş başarısız');
    } finally {
        btn.disabled = false; btn.textContent = '🔓 Giriş Yap';
    }
});

$('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    $('dashboard').classList.add('hidden');
    $('loginScreen').classList.remove('hidden');
    $('adminToken').value = '';
});

$('refreshBtn').addEventListener('click', () => loadAll());

// ================================================================
// DASHBOARD YÜKLEME
// ================================================================
async function showDashboard() {
    $('loginScreen').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    await loadAll();
}

async function loadAll() {
    try {
        const [stats, dealersResp, customersResp, groupedResp] = await Promise.all([
            api('/api/admin/stats'),
            api('/api/admin/dealers'),
            api('/api/admin/customers'),
            api('/api/admin/customers-grouped')
        ]);
        renderStats(stats);
        allDealers   = dealersResp.dealers || [];
        allItems     = customersResp.items  || [];
        groupedItems = groupedResp.items    || [];
        populateDealerSelects();
        renderActiveView();
        renderManageTable();
    } catch (e) {
        if (e.status === 401) {
            sessionStorage.removeItem(TOKEN_KEY);
            alert('Oturum süresi doldu. Yeniden giriş yapın.');
            location.reload();
            return;
        }
        alert('Veri yüklenemedi: ' + e.message);
    }
}

function renderStats(s) {
    $('statCustomers').textContent = s.customers        ?? '—';
    $('statActive').textContent    = s.licensesActive   ?? '—';
    $('statExpired').textContent   = s.licensesExpired  ?? '—';
    $('statRevoked').textContent   = s.licensesRevoked  ?? '—';
    $('statDealers').textContent   = s.dealers          ?? '—';
    $('statOnline').textContent    = s.onlineNow        ?? '—';
}

// Tüm dealer <select>'lerini güncelle
function populateDealerSelects() {
    const ids = ['filterDealer','bulkDealer','newLicDealer'];
    for (const id of ids) {
        const sel = $(id);
        if (!sel) continue;
        while (sel.options.length > 1) sel.remove(1);
        for (const d of allDealers) {
            const opt = document.createElement('option');
            opt.value       = d.id;
            opt.textContent = d.name ? `${d.name} (${d.id})` : d.id;
            sel.appendChild(opt);
        }
    }
}

// ================================================================
// MÜŞTERİLER — DÜZGÖRÜNÜM / GRUPLU GÖRÜNÜM
// ================================================================
$('viewFlatBtn').addEventListener('click',    () => setView('flat'));
$('viewGroupedBtn').addEventListener('click', () => setView('grouped'));

function setView(mode) {
    viewMode = mode;
    $('viewFlatBtn').classList.toggle('active',   mode === 'flat');
    $('viewGroupedBtn').classList.toggle('active', mode === 'grouped');
    $('flatView').classList.toggle('hidden',    mode !== 'flat');
    $('groupedView').classList.toggle('hidden', mode !== 'grouped');
    renderActiveView();
}

function renderActiveView() {
    if (viewMode === 'flat') renderFlatTable();
    else renderGroupedTable();
}

['filterQ','filterDealer','filterPlan','filterStatus'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input',  renderActiveView);
    el.addEventListener('change', renderActiveView);
});

// --- Düz tablo ---
function renderFlatTable() {
    const q       = ($('filterQ')?.value      || '').trim().toLowerCase();
    const fDealer = $('filterDealer')?.value  || '';
    const fPlan   = $('filterPlan')?.value    || '';
    const fStatus = $('filterStatus')?.value  || '';

    const filtered = allItems.filter(it => {
        if (fDealer && it.dealerId !== fDealer)           return false;
        if (fPlan   && it.license?.plan !== fPlan)        return false;
        if (fStatus && it.license?.status !== fStatus)    return false;
        if (q) {
            const hay = [it.customerId, it.companyName || '', it.email || '',
                         it.dealerId || '', it.dealerName || '',
                         it.license?.label || ''].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const tbody = $('customersBody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="loading">Kayıt bulunamadı.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(it => {
        const lic     = it.license;
        const latest  = it.latest;
        const expires = fmtDate(lic?.expiresAt);
        const expired = lic?.expiresAt && lic.expiresAt < Date.now();

        const onlineTag = !latest?.onlineStatus
            ? '<span class="tag tag-never">hiç bağlanmadı</span>'
            : `<span class="tag tag-${latest.onlineStatus}">${latest.onlineStatus}</span>`;

        const statusTag = lic
            ? `<span class="tag tag-${expired ? 'expired' : lic.status}">${expired ? 'expired' : lic.status}</span>`
            : '<span class="tag">lisans yok</span>';

        const overridePill = (lic && lic.offlineGraceOverride != null)
            ? `<span class="override-pill">${lic.offlineGraceOverride} gün</span>`
            : `<span class="muted">— (plan: ${lic?.graceDays ?? '—'} gün)</span>`;

        const labelTag = lic?.label
            ? `<span class="label-tag">${escapeHtml(lic.label)}</span>`
            : '<span class="label-tag empty">—</span>';

        const dealerLabel = it.dealerName
            ? `${escapeHtml(it.dealerName)}<br><small class="muted">${escapeHtml(it.dealerId)}</small>`
            : (it.dealerId || '<span class="muted">—</span>');

        const countBadge = it.licenseCount > 1
            ? `<span class="license-count-badge" title="Toplam lisans">${it.licenseCount} lisans</span>`
            : '';

        const customerLabel = `<strong>${escapeHtml(it.companyName || it.customerId)}</strong> ${countBadge}<br>
            <small class="muted">${escapeHtml(it.customerId)}</small>
            ${it.email ? `<br><small class="muted">${escapeHtml(it.email)}</small>` : ''}`;

        const da  = encodeURIComponent(it.companyName || it.customerId);
        const dm  = encodeURIComponent(lic?.keyMasked || '');
        const dcl = encodeURIComponent(lic?.label     || '');

        return `<tr>
            <td>${customerLabel}</td>
            <td>${dealerLabel}</td>
            <td><code>${lic?.keyMasked || '—'}</code></td>
            <td>${labelTag}</td>
            <td>${lic?.plan || '—'} / ${lic?.tier || '—'}</td>
            <td>${statusTag}</td>
            <td>${expires}</td>
            <td>${onlineTag}${latest?.lastHeartbeatAt ? `<br><small class="muted">${timeAgo(latest.lastHeartbeatAt)}</small>` : ''}</td>
            <td>${overridePill}</td>
            <td>
                ${lic ? `
                    <button class="action-btn" data-action="grace" data-license="${lic.id}" data-name="${da}" data-mask="${dm}">İzin Ver</button>
                    <button class="action-btn" data-action="label" data-license="${lic.id}" data-name="${da}" data-mask="${dm}" data-current="${dcl}">Etiket</button>
                ` : ''}
            </td>
        </tr>`;
    }).join('');

    bindRowActions(tbody);
}

// --- Gruplu tablo ---
function renderGroupedTable() {
    const q       = ($('filterQ')?.value     || '').trim().toLowerCase();
    const fDealer = $('filterDealer')?.value || '';
    const fPlan   = $('filterPlan')?.value   || '';
    const fStatus = $('filterStatus')?.value || '';

    const filtered = groupedItems.filter(c => {
        if (fDealer && c.dealerId !== fDealer)                        return false;
        if (fPlan   && !c.licenses.some(l => l.plan === fPlan))      return false;
        if (fStatus && !c.licenses.some(l => l.status === fStatus))  return false;
        if (q) {
            const hay = [c.customerId, c.companyName || '', c.email || '',
                         c.dealerId || '', c.dealerName || '',
                         ...c.licenses.map(l => l.label || '')].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const tbody = $('groupedBody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Kayıt bulunamadı.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(c => {
        const dealerLabel = c.dealerName
            ? `${escapeHtml(c.dealerName)}<br><small class="muted">${escapeHtml(c.dealerId)}</small>`
            : (c.dealerId || '<span class="muted">—</span>');

        const subRows = c.licenses.map(l => {
            const expires  = fmtDate(l.expiresAt);
            const expired  = l.expiresAt && l.expiresAt < Date.now();
            const statusTag = `<span class="tag tag-${expired ? 'expired' : l.status}">${expired ? 'expired' : l.status}</span>`;
            const labelTag  = l.label
                ? `<span class="label-tag">${escapeHtml(l.label)}</span>`
                : '<span class="label-tag empty">—</span>';
            const override  = l.offlineGraceOverride != null
                ? `<span class="override-pill">${l.offlineGraceOverride} gün</span>`
                : `<span class="muted">${l.graceDays} gün (plan)</span>`;
            const hbRow     = (l.activations || []).find(a => a.lastHeartbeatAt) || null;
            const da  = encodeURIComponent(c.companyName || c.customerId);
            const dm  = encodeURIComponent(l.keyMasked  || '');
            const dcl = encodeURIComponent(l.label      || '');
            return `<tr>
                <td><code>${l.keyMasked}</code></td>
                <td>${labelTag}</td>
                <td>${l.plan} / ${l.tier}</td>
                <td>${statusTag}</td>
                <td>${expires}</td>
                <td>${override}</td>
                <td>${(l.activations||[]).length} aktivasyon${hbRow ? `<br><small class="muted">${timeAgo(hbRow.lastHeartbeatAt)}</small>` : ''}</td>
                <td>
                    <button class="action-btn" data-action="grace" data-license="${l.id}" data-name="${da}" data-mask="${dm}">İzin</button>
                    <button class="action-btn" data-action="label" data-license="${l.id}" data-name="${da}" data-mask="${dm}" data-current="${dcl}">Etiket</button>
                </td>
            </tr>`;
        }).join('');

        return `
            <tr class="group-row" data-customer="${escapeHtml(c.customerId)}">
                <td><span class="expander">▶</span></td>
                <td><strong>${escapeHtml(c.companyName || c.customerId)}</strong><br>
                    <small class="muted">${escapeHtml(c.customerId)}</small>
                    ${c.email ? `<br><small class="muted">${escapeHtml(c.email)}</small>` : ''}
                </td>
                <td>${dealerLabel}</td>
                <td><span class="license-count-badge${c.licenseCount > 1 ? '' : ' warn'}">${c.licenseCount} lisans</span></td>
                <td><span class="tag tag-active">${c.activeCount} aktif</span></td>
                <td></td>
            </tr>
            <tr class="sub-licenses hidden" data-for="${escapeHtml(c.customerId)}">
                <td colspan="6">
                    <table class="inner-table">
                        <thead><tr>
                            <th>Anahtar</th><th>Etiket</th><th>Plan</th><th>Durum</th>
                            <th>Bitiş</th><th>Offline İzin</th><th>Aktivasyon</th><th>Aksiyon</th>
                        </tr></thead>
                        <tbody>${subRows}</tbody>
                    </table>
                </td>
            </tr>`;
    }).join('');

    // Genişletme
    tbody.querySelectorAll('.group-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const id  = row.dataset.customer;
            row.classList.toggle('open');
            const sub = tbody.querySelector(`tr.sub-licenses[data-for="${CSS.escape(id)}"]`);
            if (sub) sub.classList.toggle('hidden');
        });
    });

    bindRowActions(tbody);
}

function bindRowActions(tbody) {
    tbody.querySelectorAll('button.action-btn').forEach(btn => {
        const a = btn.dataset.action;
        if (a === 'grace') {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openGraceModal(btn.dataset.license,
                    decodeURIComponent(btn.dataset.name),
                    decodeURIComponent(btn.dataset.mask));
            });
        } else if (a === 'label') {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openLabelModal(btn.dataset.license,
                    decodeURIComponent(btn.dataset.name),
                    decodeURIComponent(btn.dataset.mask),
                    decodeURIComponent(btn.dataset.current || ''));
            });
        }
    });
}

// ================================================================
// BAYİLER SEKMESİ
// ================================================================
async function loadDealers() {
    try {
        const r = await api('/api/admin/dealers');
        allDealers = r.dealers || [];
        renderDealersTable();
        populateDealerSelects();
    } catch (e) {
        $('dealersBody').innerHTML = `<tr><td colspan="5" class="loading err">Hata: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function renderDealersTable() {
    const tbody = $('dealersBody');
    if (!allDealers.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Henüz bayi yok.</td></tr>';
        return;
    }
    tbody.innerHTML = allDealers.map(d => `<tr>
        <td><code>${escapeHtml(d.id)}</code></td>
        <td>${escapeHtml(d.name || '—')}</td>
        <td>${escapeHtml(d.email || '—')}</td>
        <td><small class="muted">${fmtDate(d.createdAt)}</small></td>
        <td>
            <button class="action-btn" data-action="dealerPw" data-id="${escapeHtml(d.id)}">🔑 Parola</button>
            <button class="action-btn danger" data-action="dealerDel" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name || d.id)}">🗑️ Sil</button>
        </td>
    </tr>`).join('');

    tbody.querySelectorAll('button.action-btn').forEach(btn => {
        if (btn.dataset.action === 'dealerPw') {
            btn.addEventListener('click', () => openDealerPwModal(btn.dataset.id));
        } else if (btn.dataset.action === 'dealerDel') {
            btn.addEventListener('click', () => confirmDeleteDealer(btn.dataset.id, btn.dataset.name));
        }
    });
}

$('dealerCreateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = $('dealerCreateResult');
    res.textContent = '';
    const body = {
        id      : $('newDealerId').value.trim(),
        name    : $('newDealerName').value.trim()    || undefined,
        email   : $('newDealerEmail').value.trim()   || undefined,
        password: $('newDealerPassword').value.trim()|| undefined
    };
    if (!body.id) { res.textContent = 'Bayi ID zorunlu.'; res.className = 'result err'; return; }
    try {
        await api('/api/admin/dealers', { method: 'POST', body });
        res.textContent = `✓ Bayi "${body.id}" oluşturuldu.`;
        res.className   = 'result ok';
        $('dealerCreateForm').reset();
        await loadDealers();
    } catch (err) {
        res.textContent = 'Hata: ' + err.message;
        res.className   = 'result err';
    }
});

async function confirmDeleteDealer(id, name) {
    if (!confirm(`"${name}" bayisini silmek istediğinizden emin misiniz?\nBayiye bağlı müşterilerin dealer_id'si temizlenecek.`)) return;
    try {
        await api(`/api/admin/dealers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadDealers();
    } catch (e) {
        alert('Hata: ' + e.message);
    }
}

// ================================================================
// LİSANS ÜRETME SEKMESİ
// ================================================================
$('licenseCreateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resEl = $('licenseCreateResult');
    const boxEl = $('generatedKeyBox');
    resEl.textContent = '';
    resEl.className   = 'result';
    boxEl.classList.add('hidden');

    const body = {
        customerId : $('newLicCustomerId').value.trim(),
        dealerId   : $('newLicDealer').value            || undefined,
        companyName: $('newLicCompany').value.trim()    || undefined,
        email      : $('newLicEmail').value.trim()      || undefined,
        plan       : $('newLicPlan').value,
        validDays  : Number($('newLicDays').value),
        label      : $('newLicLabel').value.trim()      || undefined
    };

    if (!body.customerId) { resEl.textContent = 'Müşteri ID zorunlu.'; resEl.className = 'result err'; return; }
    if (!body.validDays || body.validDays < 1) { resEl.textContent = 'Geçerli bir gün sayısı girin.'; resEl.className = 'result err'; return; }

    try {
        const r = await api('/api/admin/licenses', { method: 'POST', body });
        resEl.textContent = '✓ Lisans üretildi!';
        resEl.className   = 'result ok';

        // Anahtarı göster (endpoint: licenseKey veya key)
        const shownKey = r.licenseKey || r.key || '—';
        const shownCustomer = r.customerId || body.customerId;
        $('generatedKeyValue').textContent = shownKey;
        $('generatedKeyMeta').innerHTML =
            `<span>Müşteri: <code>${escapeHtml(shownCustomer)}</code></span> &nbsp;|&nbsp; ` +
            `<span>Plan: <strong>${escapeHtml(r.plan)}</strong></span> &nbsp;|&nbsp; ` +
            `<span>Bitiş: <strong>${fmtDate(r.expiresAt)}</strong></span>` +
            (r.label ? ` &nbsp;|&nbsp; <span class="label-tag">${escapeHtml(r.label)}</span>` : '');
        boxEl.classList.remove('hidden');

        // Tabloları güncelle
        await loadAll();
    } catch (err) {
        resEl.textContent = 'Hata: ' + err.message;
        resEl.className   = 'result err';
    }
});

$('copyKeyBtn').addEventListener('click', async () => {
    const key = $('generatedKeyValue').textContent;
    if (!key || key === '—') return;
    try {
        await navigator.clipboard.writeText(key);
        $('copyKeyBtn').textContent = '✓';
        setTimeout(() => ($('copyKeyBtn').textContent = '📋'), 1500);
    } catch (_) {
        prompt('Kopyalamak için Ctrl+C:', key);
    }
});

// ================================================================
// LİSANS YÖNET SEKMESİ
// ================================================================
function renderManageTable() {
    const q       = ($('manageQ')?.value      || '').trim().toLowerCase();
    const fStatus = $('manageStatus')?.value  || '';

    const filtered = allItems.filter(it => {
        const lic = it.license;
        if (!lic) return false;
        if (fStatus && lic.status !== fStatus) return false;
        if (q) {
            const hay = [it.customerId, it.companyName || '', it.email || '',
                         lic.keyMasked || '', lic.label || ''].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const tbody = $('manageBody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Kayıt bulunamadı.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(it => {
        const lic     = it.license;
        const expired = lic.expiresAt && lic.expiresAt < Date.now();
        const statusTag = `<span class="tag tag-${expired ? 'expired' : lic.status}">${expired ? 'expired' : lic.status}</span>`;
        const labelTag  = lic.label
            ? `<span class="label-tag">${escapeHtml(lic.label)}</span>`
            : '<span class="muted">—</span>';
        const da = encodeURIComponent(it.companyName || it.customerId);

        const revokeBtn = lic.status === 'active'
            ? `<button class="action-btn danger" data-action="revoke" data-license="${lic.id}" data-name="${da}">🚫 İptal</button>`
            : `<button class="action-btn ok"    data-action="unrevoke" data-license="${lic.id}" data-name="${da}">✅ Etkinleştir</button>`;

        return `<tr>
            <td><strong>${escapeHtml(it.companyName || it.customerId)}</strong><br>
                <small class="muted">${escapeHtml(it.customerId)}</small>
            </td>
            <td><code>${escapeHtml(lic.keyMasked || '—')}</code></td>
            <td>${labelTag}</td>
            <td>${escapeHtml(lic.plan)} / ${escapeHtml(lic.tier || '—')}</td>
            <td>${statusTag}</td>
            <td>${fmtDate(lic.expiresAt)}</td>
            <td class="btn-group">
                ${revokeBtn}
                <button class="action-btn" data-action="renew" data-license="${lic.id}" data-name="${da}">⏳ Uzat</button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('button.action-btn').forEach(btn => {
        const a    = btn.dataset.action;
        const lid  = btn.dataset.license;
        const name = decodeURIComponent(btn.dataset.name || '');
        if (a === 'revoke') {
            btn.addEventListener('click', () => doRevoke(lid, name));
        } else if (a === 'unrevoke') {
            btn.addEventListener('click', () => doUnrevoke(lid, name));
        } else if (a === 'renew') {
            btn.addEventListener('click', () => openRenewModal(lid, name));
        }
    });
}

['manageQ','manageStatus'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input',  renderManageTable);
    el.addEventListener('change', renderManageTable);
});

async function doRevoke(licenseId, name) {
    if (!confirm(`"${name}" için lisansı iptal etmek istiyor musunuz?`)) return;
    try {
        await api(`/api/admin/licenses/${encodeURIComponent(licenseId)}/revoke`, { method: 'POST' });
        await loadAll();
    } catch (e) { alert('Hata: ' + e.message); }
}

async function doUnrevoke(licenseId, name) {
    if (!confirm(`"${name}" için lisansı yeniden etkinleştirmek istiyor musunuz?`)) return;
    try {
        await api(`/api/admin/licenses/${encodeURIComponent(licenseId)}/unrevoke`, { method: 'POST' });
        await loadAll();
    } catch (e) { alert('Hata: ' + e.message); }
}

// ================================================================
// AUDİT LOG SEKMESİ
// ================================================================
async function loadAudit() {
    const actor  = $('auditActor')?.value.trim()  || '';
    const action = $('auditAction')?.value.trim() || '';
    const target = $('auditTarget')?.value.trim() || '';
    const limit  = Number($('auditLimit')?.value  || 200);

    const params = new URLSearchParams();
    if (actor)  params.set('actor',  actor);
    if (action) params.set('action', action);
    if (target) params.set('target', target);
    params.set('limit', Math.min(Math.max(limit, 10), 1000));

    const tbody = $('auditBody');
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Yükleniyor...</td></tr>';

    try {
        const r    = await api(`/api/admin/audit?${params}`);
        const rows = r.entries || r.rows || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">Kayıt yok.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(row => {
            let detailHtml = '';
            const rawDetail = row.detail_json || row.detail;
            if (rawDetail) {
                try {
                    const obj = typeof rawDetail === 'string' ? JSON.parse(rawDetail) : rawDetail;
                    detailHtml = `<pre class="audit-detail">${escapeHtml(JSON.stringify(obj, null, 2))}</pre>`;
                } catch (_) {
                    detailHtml = `<span class="muted">${escapeHtml(String(rawDetail))}</span>`;
                }
            }
            return `<tr>
                <td><small>${fmtDateTime(row.ts || row.createdAt)}</small></td>
                <td><code>${escapeHtml(row.actor || '—')}</code></td>
                <td><code>${escapeHtml(row.action || '—')}</code></td>
                <td><code>${escapeHtml(row.target || '—')}</code></td>
                <td>${detailHtml}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="loading err">Hata: ${escapeHtml(e.message)}</td></tr>`;
    }
}

$('auditReloadBtn')?.addEventListener('click', loadAudit);

// ================================================================
// TOPLU OFFLİNE GRACE (Özet sekmesi)
// ================================================================
$('bulkApplyBtn').addEventListener('click', async () => {
    const daysRaw = $('bulkDays').value.trim();
    const days    = daysRaw === '' ? null : Number(daysRaw);
    if (daysRaw !== '' && (!Number.isFinite(days) || days < 0)) {
        showBulkResult('Geçerli bir gün sayısı girin (0 veya pozitif tamsayı).', 'err');
        return;
    }
    const filter = {
        dealerId: $('bulkDealer').value || undefined,
        plan    : $('bulkPlan').value   || undefined,
        status  : $('bulkStatus').value || undefined,
        days
    };
    const ok = confirm(
        `Toplu uygulama:\n` +
        `  Bayi  : ${filter.dealerId || 'TÜMÜ'}\n` +
        `  Plan  : ${filter.plan     || 'TÜMÜ'}\n` +
        `  Durum : ${filter.status   || 'active'}\n` +
        `  Offline: ${days == null ? '(plan default\'a dön)' : days + ' gün'}\n\nDevam edilsin mi?`
    );
    if (!ok) return;
    try {
        const r = await api('/api/admin/offline-grace/bulk', { method: 'POST', body: filter });
        showBulkResult(`✓ Uygulandı — ${r.expected} lisans etkilendi (override: ${r.override == null ? 'temizlendi' : r.override + ' gün'})`, 'ok');
        await loadAll();
    } catch (e) {
        showBulkResult('Hata: ' + e.message, 'err');
    }
});

$('bulkClearBtn').addEventListener('click', () => {
    $('bulkDays').value = '';
    showBulkResult('Gün alanı temizlendi — "Uygula" derseniz seçili lisansların override\'ı kaldırılır.', 'ok');
});

function showBulkResult(msg, kind) {
    const el = $('bulkResult');
    el.textContent = msg;
    el.className   = 'result ' + (kind || '');
}

// ================================================================
// MODAL: Grace (Tek lisans)
// ================================================================
let currentModalLicenseId = null;

function openGraceModal(licenseId, customerName, mask) {
    currentModalLicenseId = licenseId;
    $('graceModalCustomer').textContent = customerName;
    $('graceModalLicense').textContent  = mask || licenseId;
    $('graceModalDays').value           = '';
    $('graceModalResult').textContent   = '';
    $('graceModalResult').className     = 'result';
    $('graceModal').classList.remove('hidden');
}

$('graceModalCancel').addEventListener('click', () => $('graceModal').classList.add('hidden'));
$('graceModal').addEventListener('click', (e) => { if (e.target === $('graceModal')) $('graceModal').classList.add('hidden'); });

$('graceModalApply').addEventListener('click', async () => {
    const raw  = $('graceModalDays').value.trim();
    const days = raw === '' ? null : Number(raw);
    if (raw !== '' && (!Number.isFinite(days) || days < 0)) {
        $('graceModalResult').textContent = 'Geçerli gün sayısı girin.';
        $('graceModalResult').className   = 'result err';
        return;
    }
    try {
        await api(`/api/admin/licenses/${encodeURIComponent(currentModalLicenseId)}/offline-grace`, {
            method: 'POST', body: { days }
        });
        $('graceModalResult').textContent = '✓ Kaydedildi.';
        $('graceModalResult').className   = 'result ok';
        await loadAll();
        setTimeout(() => $('graceModal').classList.add('hidden'), 800);
    } catch (e) {
        $('graceModalResult').textContent = 'Hata: ' + e.message;
        $('graceModalResult').className   = 'result err';
    }
});

// ================================================================
// MODAL: Etiket
// ================================================================
let currentLabelLicenseId = null;

function openLabelModal(licenseId, customerName, mask, current) {
    currentLabelLicenseId = licenseId;
    $('labelModalCustomer').textContent = customerName;
    $('labelModalLicense').textContent  = mask || licenseId;
    $('labelModalValue').value          = current || '';
    $('labelModalResult').textContent   = '';
    $('labelModalResult').className     = 'result';
    $('labelModal').classList.remove('hidden');
    setTimeout(() => $('labelModalValue').focus(), 50);
}

$('labelModalCancel').addEventListener('click', () => $('labelModal').classList.add('hidden'));
$('labelModal').addEventListener('click', (e) => { if (e.target === $('labelModal')) $('labelModal').classList.add('hidden'); });

$('labelModalApply').addEventListener('click', async () => {
    const raw   = $('labelModalValue').value.trim();
    const label = raw === '' ? null : raw.slice(0, 128);
    try {
        await api(`/api/admin/licenses/${encodeURIComponent(currentLabelLicenseId)}/label`, {
            method: 'POST', body: { label }
        });
        $('labelModalResult').textContent = '✓ Kaydedildi.';
        $('labelModalResult').className   = 'result ok';
        await loadAll();
        setTimeout(() => $('labelModal').classList.add('hidden'), 600);
    } catch (e) {
        $('labelModalResult').textContent = 'Hata: ' + e.message;
        $('labelModalResult').className   = 'result err';
    }
});

// ================================================================
// MODAL: Yenile (Renew)
// ================================================================
let currentRenewLicenseId = null;

function openRenewModal(licenseId, name) {
    currentRenewLicenseId = licenseId;
    $('renewModalCustomer').textContent = name;
    $('renewModalDays').value           = '365';
    $('renewModalResult').textContent   = '';
    $('renewModalResult').className     = 'result';
    $('renewModal').classList.remove('hidden');
    setTimeout(() => $('renewModalDays').focus(), 50);
}

$('renewModalCancel').addEventListener('click', () => $('renewModal').classList.add('hidden'));
$('renewModal').addEventListener('click', (e) => { if (e.target === $('renewModal')) $('renewModal').classList.add('hidden'); });

$('renewModalApply').addEventListener('click', async () => {
    const addDays = Number($('renewModalDays').value);
    if (!Number.isFinite(addDays) || addDays < 1) {
        $('renewModalResult').textContent = 'En az 1 gün girin.';
        $('renewModalResult').className   = 'result err';
        return;
    }
    try {
        const r = await api(`/api/admin/licenses/${encodeURIComponent(currentRenewLicenseId)}/renew`, {
            method: 'POST', body: { addDays }
        });
        $('renewModalResult').textContent = `✓ Uzatıldı. Yeni bitiş: ${fmtDate(r.expiresAt)}`;
        $('renewModalResult').className   = 'result ok';
        await loadAll();
        setTimeout(() => $('renewModal').classList.add('hidden'), 1000);
    } catch (e) {
        $('renewModalResult').textContent = 'Hata: ' + e.message;
        $('renewModalResult').className   = 'result err';
    }
});

// ================================================================
// MODAL: Bayi Parolası
// ================================================================
let currentDealerPwId = null;

function openDealerPwModal(dealerId) {
    currentDealerPwId = dealerId;
    $('dealerPwId').textContent    = dealerId;
    $('dealerPwValue').value       = '';
    $('dealerPwResult').textContent = '';
    $('dealerPwResult').className  = 'result';
    $('dealerPwModal').classList.remove('hidden');
    setTimeout(() => $('dealerPwValue').focus(), 50);
}

$('dealerPwCancel').addEventListener('click', () => $('dealerPwModal').classList.add('hidden'));
$('dealerPwModal').addEventListener('click', (e) => { if (e.target === $('dealerPwModal')) $('dealerPwModal').classList.add('hidden'); });

$('dealerPwApply').addEventListener('click', async () => {
    const pw = $('dealerPwValue').value;
    if (!pw || pw.length < 8) {
        $('dealerPwResult').textContent = 'Parola en az 8 karakter olmalı.';
        $('dealerPwResult').className   = 'result err';
        return;
    }
    try {
        await api(`/api/admin/dealers/${encodeURIComponent(currentDealerPwId)}/password`, {
            method: 'POST', body: { password: pw }
        });
        $('dealerPwResult').textContent = '✓ Parola güncellendi.';
        $('dealerPwResult').className   = 'result ok';
        setTimeout(() => $('dealerPwModal').classList.add('hidden'), 800);
    } catch (e) {
        $('dealerPwResult').textContent = 'Hata: ' + e.message;
        $('dealerPwResult').className   = 'result err';
    }
});

// ================================================================
// BOOT: sessionStorage'da token varsa doğrula ve giriş yap
// ================================================================
(async function boot() {
    const t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) return;
    try {
        await api('/api/admin/stats');
        showDashboard();
    } catch (_) {
        sessionStorage.removeItem(TOKEN_KEY);
    }
})();
