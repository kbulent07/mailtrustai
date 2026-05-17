'use strict';
// MailTrustAI — Merkezi Yönetim Paneli (keygen.html)
// Geliştirici (admin) için, ADMIN_PANEL_TOKEN ile giriş yapılır.

const TOKEN_KEY = 'msa-admin-token';
let allItems = [];        // /api/admin/customers (flat)
let groupedItems = [];    // /api/admin/customers-grouped
let viewMode = 'flat';    // 'flat' | 'grouped'

const $ = (id) => document.getElementById(id);

// ============== HTTP yardımcısı ==============
async function api(path, opts = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
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

// ============== Login ==============
$('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('adminToken').value.trim();
    const errEl = $('loginError');
    const btn = $('loginBtn');
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = '⏳ Doğrulanıyor...';
    try {
        // POST /api/admin/login — token doğrulanır
        await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token })
        }).then(async r => {
            if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                throw new Error(j.error || `HTTP ${r.status}`);
            }
        });
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

// ============== Dashboard yükleme ==============
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
        renderDealerOptions(dealersResp.dealers || []);
        allItems = customersResp.items || [];
        groupedItems = groupedResp.items || [];
        renderActiveView();
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
    $('statCustomers').textContent = s.customers ?? '—';
    $('statActive').textContent    = s.licensesActive ?? '—';
    $('statExpired').textContent   = s.licensesExpired ?? '—';
    $('statRevoked').textContent   = s.licensesRevoked ?? '—';
    $('statDealers').textContent   = s.dealers ?? '—';
    $('statOnline').textContent    = s.onlineNow ?? '—';
}

function renderDealerOptions(dealers) {
    for (const sel of [$('filterDealer'), $('bulkDealer')]) {
        // İlk option (--Tümü--) korunur
        while (sel.options.length > 1) sel.remove(1);
        for (const d of dealers) {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.name ? `${d.name} (${d.id})` : d.id;
            sel.appendChild(opt);
        }
    }
}

// ============== View toggle ==============
$('viewFlatBtn').addEventListener('click', () => setView('flat'));
$('viewGroupedBtn').addEventListener('click', () => setView('grouped'));

function setView(mode) {
    viewMode = mode;
    $('viewFlatBtn').classList.toggle('active', mode === 'flat');
    $('viewGroupedBtn').classList.toggle('active', mode === 'grouped');
    $('flatView').classList.toggle('hidden', mode !== 'flat');
    $('groupedView').classList.toggle('hidden', mode !== 'grouped');
    renderActiveView();
}

function renderActiveView() {
    if (viewMode === 'flat') renderFlatTable();
    else renderGroupedTable();
}

// ============== Düz tablo (flat) ==============
function renderFlatTable() {
    const q = $('filterQ').value.trim().toLowerCase();
    const fDealer = $('filterDealer').value;
    const fPlan   = $('filterPlan').value;
    const fStatus = $('filterStatus').value;

    const filtered = allItems.filter(item => {
        if (fDealer && item.dealerId !== fDealer) return false;
        if (fPlan && item.license?.plan !== fPlan) return false;
        if (fStatus && item.license?.status !== fStatus) return false;
        if (q) {
            const hay = [item.customerId, item.companyName || '', item.email || '',
                         item.dealerId || '', item.dealerName || '',
                         item.license?.label || ''].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const tbody = $('customersBody');
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="loading">Kayıt bulunamadı.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(it => {
        const lic = it.license;
        const latest = it.latest;
        const expires = lic?.expiresAt ? new Date(lic.expiresAt).toLocaleDateString('tr-TR') : '—';
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

        const dealerLabel = it.dealerName ? `${escapeHtml(it.dealerName)}<br><small class="muted">${escapeHtml(it.dealerId)}</small>` : (it.dealerId || '<span class="muted">—</span>');
        const countBadge = it.licenseCount > 1
            ? `<span class="license-count-badge" title="Bu müşterinin toplam lisans sayısı">${it.licenseCount} lisans</span>`
            : '';
        const customerLabel = `<strong>${escapeHtml(it.companyName || it.customerId)}</strong> ${countBadge}<br><small class="muted">${escapeHtml(it.customerId)}</small>${it.email ? `<br><small class="muted">${escapeHtml(it.email)}</small>` : ''}`;

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
                    <button class="action-btn" data-license="${lic.id}" data-name="${escapeHtml(it.companyName || it.customerId)}" data-mask="${escapeHtml(lic.keyMasked || '')}" data-action="grace">İzin Ver</button>
                    <button class="action-btn" data-license="${lic.id}" data-name="${escapeHtml(it.companyName || it.customerId)}" data-mask="${escapeHtml(lic.keyMasked || '')}" data-current="${escapeHtml(lic.label || '')}" data-action="label">Etiket</button>
                ` : ''}
            </td>
        </tr>`;
    }).join('');

    bindRowActions(tbody);
}

// ============== Müşteri-bazlı gruplu tablo ==============
function renderGroupedTable() {
    const q = $('filterQ').value.trim().toLowerCase();
    const fDealer = $('filterDealer').value;
    const fPlan = $('filterPlan').value;
    const fStatus = $('filterStatus').value;

    const filtered = groupedItems.filter(c => {
        if (fDealer && c.dealerId !== fDealer) return false;
        // Müşterinin EN AZ BİR lisansı plan/status'a uymalı (gruplu için)
        if (fPlan && !c.licenses.some(l => l.plan === fPlan)) return false;
        if (fStatus && !c.licenses.some(l => l.status === fStatus)) return false;
        if (q) {
            const hay = [c.customerId, c.companyName || '', c.email || '',
                         c.dealerId || '', c.dealerName || '',
                         ...c.licenses.map(l => l.label || '')].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const tbody = $('groupedBody');
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Kayıt bulunamadı.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(c => {
        const dealerLabel = c.dealerName ? `${escapeHtml(c.dealerName)}<br><small class="muted">${escapeHtml(c.dealerId)}</small>` : (c.dealerId || '<span class="muted">—</span>');
        const countCls = c.licenseCount > 1 ? '' : 'warn';
        const subRows = c.licenses.map(l => {
            const expires = l.expiresAt ? new Date(l.expiresAt).toLocaleDateString('tr-TR') : '—';
            const expired = l.expiresAt && l.expiresAt < Date.now();
            const statusTag = `<span class="tag tag-${expired ? 'expired' : l.status}">${expired ? 'expired' : l.status}</span>`;
            const labelTag = l.label
                ? `<span class="label-tag">${escapeHtml(l.label)}</span>`
                : '<span class="label-tag empty">—</span>';
            const overridePill = l.offlineGraceOverride != null
                ? `<span class="override-pill">${l.offlineGraceOverride} gün</span>`
                : `<span class="muted">${l.graceDays} gün (plan)</span>`;
            const onlineRow = l.activations.find(a => a.lastHeartbeatAt) || null;
            return `<tr>
                <td><code>${l.keyMasked}</code></td>
                <td>${labelTag}</td>
                <td>${l.plan} / ${l.tier}</td>
                <td>${statusTag}</td>
                <td>${expires}</td>
                <td>${overridePill}</td>
                <td>${l.activations.length} aktivasyon${onlineRow ? `<br><small class="muted">${timeAgo(onlineRow.lastHeartbeatAt)}</small>` : ''}</td>
                <td>
                    <button class="action-btn" data-license="${l.id}" data-name="${escapeHtml(c.companyName || c.customerId)}" data-mask="${escapeHtml(l.keyMasked || '')}" data-action="grace">İzin</button>
                    <button class="action-btn" data-license="${l.id}" data-name="${escapeHtml(c.companyName || c.customerId)}" data-mask="${escapeHtml(l.keyMasked || '')}" data-current="${escapeHtml(l.label || '')}" data-action="label">Etiket</button>
                </td>
            </tr>`;
        }).join('');

        return `
            <tr class="group-row" data-customer="${escapeHtml(c.customerId)}">
                <td><span class="expander">▶</span></td>
                <td><strong>${escapeHtml(c.companyName || c.customerId)}</strong><br><small class="muted">${escapeHtml(c.customerId)}</small>${c.email ? `<br><small class="muted">${escapeHtml(c.email)}</small>` : ''}</td>
                <td>${dealerLabel}</td>
                <td><span class="license-count-badge ${countCls}">${c.licenseCount} lisans</span></td>
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
            </tr>
        `;
    }).join('');

    // Genişletme tıklaması
    tbody.querySelectorAll('.group-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;  // Aksiyon butonları
            const id = row.dataset.customer;
            row.classList.toggle('open');
            const sub = tbody.querySelector(`tr.sub-licenses[data-for="${CSS.escape(id)}"]`);
            if (sub) sub.classList.toggle('hidden');
        });
    });

    bindRowActions(tbody);
}

// Ortak: row aksiyonları (grace + label modal aç)
function bindRowActions(tbody) {
    tbody.querySelectorAll('button.action-btn').forEach(btn => {
        const a = btn.dataset.action;
        if (a === 'grace') {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openGraceModal(btn.dataset.license, btn.dataset.name, btn.dataset.mask);
            });
        } else if (a === 'label') {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openLabelModal(btn.dataset.license, btn.dataset.name, btn.dataset.mask, btn.dataset.current);
            });
        }
    });
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(ms) {
    const diff = Date.now() - ms;
    if (diff < 60_000) return Math.floor(diff/1000) + ' sn önce';
    if (diff < 3600_000) return Math.floor(diff/60_000) + ' dk önce';
    if (diff < 86400_000) return Math.floor(diff/3600_000) + ' sa önce';
    return Math.floor(diff/86400_000) + ' gün önce';
}

['filterQ', 'filterDealer', 'filterPlan', 'filterStatus'].forEach(id => {
    $(id).addEventListener('input', renderActiveView);
    $(id).addEventListener('change', renderActiveView);
});

// ============== Bulk offline grace ==============
$('bulkApplyBtn').addEventListener('click', async () => {
    const daysRaw = $('bulkDays').value.trim();
    const days = daysRaw === '' ? null : Number(daysRaw);
    if (daysRaw !== '' && (!Number.isFinite(days) || days < 0)) {
        showBulkResult('Geçerli bir gün sayısı girin (0 veya pozitif tamsayı).', 'err');
        return;
    }
    const filter = {
        dealerId: $('bulkDealer').value || undefined,
        plan:     $('bulkPlan').value || undefined,
        status:   $('bulkStatus').value || undefined,
        days
    };
    const confirm = window.confirm(
        `Toplu uygulama:\n` +
        `  Bayi: ${filter.dealerId || 'TÜMÜ'}\n` +
        `  Plan: ${filter.plan || 'TÜMÜ'}\n` +
        `  Durum: ${filter.status || 'active'}\n` +
        `  Offline süre: ${days == null ? '(plan default\'a dön)' : days + ' gün'}\n\n` +
        `Devam edilsin mi?`
    );
    if (!confirm) return;
    try {
        const r = await api('/api/admin/offline-grace/bulk', { method: 'POST', body: filter });
        showBulkResult(`✓ Uygulandı — ${r.expected} lisans etkilendi (override: ${r.override == null ? 'null' : r.override + ' gün'})`, 'ok');
        await loadAll();
    } catch (e) {
        showBulkResult('Hata: ' + e.message, 'err');
    }
});

$('bulkClearBtn').addEventListener('click', () => {
    $('bulkDays').value = '';
    showBulkResult('Gün alanı temizlendi — "Uygula" derseniz tüm seçili lisansların override\'ı kaldırılır (plan default\'a döner).', 'ok');
});

function showBulkResult(msg, kind) {
    const el = $('bulkResult');
    el.textContent = msg;
    el.className = 'result ' + (kind || '');
}

// ============== Tek lisans modal ==============
let currentModalLicenseId = null;
function openGraceModal(licenseId, customerName, mask) {
    currentModalLicenseId = licenseId;
    $('graceModalCustomer').textContent = customerName;
    $('graceModalLicense').textContent = mask || licenseId;
    $('graceModalDays').value = '';
    $('graceModalResult').textContent = '';
    $('graceModalResult').className = 'result';
    $('graceModal').classList.remove('hidden');
}
$('graceModalCancel').addEventListener('click', () => $('graceModal').classList.add('hidden'));
$('graceModalApply').addEventListener('click', async () => {
    const daysRaw = $('graceModalDays').value.trim();
    const days = daysRaw === '' ? null : Number(daysRaw);
    if (daysRaw !== '' && (!Number.isFinite(days) || days < 0)) {
        $('graceModalResult').textContent = 'Geçerli gün sayısı girin.';
        $('graceModalResult').className = 'result err';
        return;
    }
    try {
        await api(`/api/admin/licenses/${encodeURIComponent(currentModalLicenseId)}/offline-grace`, {
            method: 'POST', body: { days }
        });
        $('graceModalResult').textContent = '✓ Kaydedildi.';
        $('graceModalResult').className = 'result ok';
        await loadAll();
        setTimeout(() => $('graceModal').classList.add('hidden'), 800);
    } catch (e) {
        $('graceModalResult').textContent = 'Hata: ' + e.message;
        $('graceModalResult').className = 'result err';
    }
});

// Modal dışına tıklama
$('graceModal').addEventListener('click', (e) => {
    if (e.target === $('graceModal')) $('graceModal').classList.add('hidden');
});

// ============== Lisans etiket modal ==============
let currentLabelLicenseId = null;
function openLabelModal(licenseId, customerName, mask, current) {
    currentLabelLicenseId = licenseId;
    $('labelModalCustomer').textContent = customerName;
    $('labelModalLicense').textContent = mask || licenseId;
    $('labelModalValue').value = current || '';
    $('labelModalResult').textContent = '';
    $('labelModalResult').className = 'result';
    $('labelModal').classList.remove('hidden');
    setTimeout(() => $('labelModalValue').focus(), 50);
}
$('labelModalCancel').addEventListener('click', () => $('labelModal').classList.add('hidden'));
$('labelModalApply').addEventListener('click', async () => {
    const raw = $('labelModalValue').value.trim();
    const label = raw === '' ? null : raw.slice(0, 128);
    try {
        await api(`/api/admin/licenses/${encodeURIComponent(currentLabelLicenseId)}/label`, {
            method: 'POST', body: { label }
        });
        $('labelModalResult').textContent = '✓ Kaydedildi.';
        $('labelModalResult').className = 'result ok';
        await loadAll();
        setTimeout(() => $('labelModal').classList.add('hidden'), 600);
    } catch (e) {
        $('labelModalResult').textContent = 'Hata: ' + e.message;
        $('labelModalResult').className = 'result err';
    }
});
$('labelModal').addEventListener('click', (e) => {
    if (e.target === $('labelModal')) $('labelModal').classList.add('hidden');
});

// ============== Boot: token varsa direkt dashboard ==============
(async function boot() {
    const t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) return;
    try {
        // Token hâlâ geçerli mi? /api/admin/stats çağırıp dene.
        await api('/api/admin/stats');
        showDashboard();
    } catch (_) {
        sessionStorage.removeItem(TOKEN_KEY);
    }
})();
