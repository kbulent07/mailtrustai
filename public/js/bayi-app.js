// ============================================================
// MAILTRUSTAI BAYI PORTAL — Frontend JS
// ============================================================
let dealerToken = sessionStorage.getItem('dealerToken') || '';
let dealerData = null;
let pricesData = null;

// ─── API YARDIMCI — 401 oturum bitişini yakalar ──────────
async function apiFetch(url, opts = {}) {
    const res = await fetch(url, opts);
    if (res.status === 401) {
        _clearSession();
        document.getElementById('portalWrap').style.display = 'none';
        document.getElementById('loginWrap').style.display = '';
        const errEl = document.getElementById('loginError');
        errEl.textContent = 'Oturum süresi doldu. Lütfen tekrar giriş yapın.';
        errEl.style.display = '';
        const err = new Error('SESSION_EXPIRED');
        err.isSessionExpired = true;
        throw err;
    }
    return res;
}

function _clearSession() {
    dealerToken = '';
    dealerData = null;
    sessionStorage.removeItem('dealerToken');
    sessionStorage.removeItem('dealerData');
    sessionStorage.removeItem('sessionExpiresAt');
    _stopSessionWarning();
}

// ─── OTURUM SÜRESİ UYARISI ───────────────────────────────
let _sessionWarningTimer = null;

function _startSessionWarning(expiresAt) {
    _stopSessionWarning();
    _sessionWarningTimer = setInterval(() => {
        const msLeft = expiresAt - Date.now();
        if (msLeft <= 0) {
            _stopSessionWarning();
            return;
        }
        const minLeft = Math.ceil(msLeft / 60000);
        const bar = document.getElementById('sessionWarningBar');
        if (minLeft <= 15 && bar) {
            bar.style.display = 'flex';
            const el = document.getElementById('sessionMinLeft');
            if (el) el.textContent = minLeft;
        }
    }, 60 * 1000);
}

function _stopSessionWarning() {
    if (_sessionWarningTimer) {
        clearInterval(_sessionWarningTimer);
        _sessionWarningTimer = null;
    }
}

// ─── GİRİŞ / ÇIKIŞ ───────────────────────────────────────
async function doLogin() {
    const username = document.getElementById('loginCode').value.trim().toLowerCase();
    const password = document.getElementById('loginPin').value;
    const errEl = document.getElementById('loginError');
    errEl.style.display = 'none';

    if (!username || !password) {
        errEl.textContent = 'E-posta ve sifre gereklidir';
        errEl.style.display = '';
        return;
    }

    try {
        const res = await fetch('/api/dealer/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, code: username, pin: password })
        });
        const data = await res.json();
        if (res.status === 429) {
            errEl.textContent = data.error || 'Çok fazla deneme. Lütfen bekleyin.';
            errEl.style.display = '';
            return;
        }
        if (!res.ok || !data.success) {
            errEl.textContent = data.error || 'Giriş başarısız';
            errEl.style.display = '';
            return;
        }
        dealerToken = data.token;
        dealerData = data.dealer;
        const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
        sessionStorage.setItem('dealerToken', dealerToken);
        sessionStorage.setItem('dealerData', JSON.stringify(dealerData));
        sessionStorage.setItem('sessionExpiresAt', String(expiresAt));
        _startSessionWarning(expiresAt);
        showPortal();
    } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = '';
    }
}

function doLogout() {
    fetch('/api/dealer/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
    _clearSession();
    document.getElementById('loginWrap').style.display = '';
    document.getElementById('portalWrap').style.display = 'none';
    const bar = document.getElementById('sessionWarningBar');
    if (bar) bar.style.display = 'none';
}

function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dealerToken}` };
}

// ─── PORTAL GÖSTERİMİ ─────────────────────────────────────
function showPortal() {
    document.getElementById('loginWrap').style.display = 'none';
    document.getElementById('portalWrap').style.display = '';
    document.getElementById('dealerNameDisplay').textContent =
        `Bayi: ${dealerData?.name || dealerData?.code || ''} | Indirim: %${dealerData?.discountPct || 0}${dealerData?.founderProxy ? ' | Kurucu erisimi' : ''}`;
    updateCreditDisplay();
    loadDashboard();
    loadPrices();
}

function toggleBayiNav() {
    document.getElementById('bayiNavLinks').classList.toggle('open');
}

function showSection(name) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`section${name.charAt(0).toUpperCase() + name.slice(1)}`).classList.add('active');
    document.querySelectorAll('.bayi-nav-links a').forEach(a => a.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    // Mobilde menüyü kapat
    document.getElementById('bayiNavLinks')?.classList.remove('open');

    if (name === 'sales')     loadSales();
    if (name === 'customers') loadCustomers();
    if (name === 'prices')    renderPrices();
    if (name === 'branding')  loadWhiteLabel();
    if (name === 'trusted')   tdLoad();
    if (name === 'stats')     loadStats();
    if (name === 'activity')  loadActivity();
}

// ─── KREDİ GÖSTERİMİ ─────────────────────────────────────
function updateCreditDisplay() {
    const credits = dealerData?.credits ?? null;
    const el = document.getElementById('creditDisplay');
    const bal = document.getElementById('creditBalance');
    if (!el) return;
    if (credits === null) { el.style.display = 'none'; return; }
    bal.textContent = credits;
    el.style.display = '';
    el.style.color = credits > 0 ? 'var(--green)' : '#f87171';
}

function updateCreditInfo() {
    const wrap = document.getElementById('creditInfoWrap');
    const el = document.getElementById('creditInfo');
    const btn = document.getElementById('genBtn');
    if (!wrap || !el || !pricesData) return;
    const plan = document.querySelector('input[name="genPlan"]:checked')?.value || 'PRO';
    const tier = document.getElementById('genTier')?.value || 'T2';
    const duration = document.querySelector('input[name="genDuration"]:checked')?.value || 'M';
    const price = pricesData.prices?.[plan]?.[tier]?.[duration];
    const credits = dealerData?.credits ?? 0;

    if (price == null) { wrap.style.display = 'none'; return; }

    wrap.style.display = '';

    if (price === 0) {
        el.style.background = 'rgba(99,102,241,0.08)';
        el.style.borderColor = 'var(--accent)';
        el.style.color = 'var(--text-secondary)';
        el.textContent = 'ℹ️ Bu tier özel anlaşma kapsamındadır — kredi kesintisi yapılmaz.';
        if (btn) btn.disabled = false;
        return;
    }

    const hasCredits = credits >= price;
    el.style.background = hasCredits ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)';
    el.style.borderColor = hasCredits ? 'var(--green)' : '#f87171';
    el.style.color = hasCredits ? 'var(--green)' : '#f87171';
    el.innerHTML = hasCredits
        ? `💳 Bakiyeniz <strong>${credits} kredi</strong> — bu lisans <strong>${price} kredi</strong> düşer, kalan: <strong>${credits - price}</strong>`
        : `⚠️ Yetersiz kredi! Bu lisans <strong>${price} kredi</strong> gerektirir, bakiyeniz: <strong>${credits}</strong>. Lütfen yöneticinizden kredi yüklemesini isteyin.`;
    if (btn) btn.disabled = !hasCredits;
}

// ─── DASHBOARD ────────────────────────────────────────────
async function loadDashboard() {
    try {
        const [statsRes, salesRes, meRes] = await Promise.all([
            apiFetch('/api/dealer/stats', { headers: authHeaders() }),
            apiFetch('/api/dealer/sales?limit=5', { headers: authHeaders() }),
            apiFetch('/api/dealer/me', { headers: authHeaders() })
        ]);

        const stats = await statsRes.json();
        const sales = await salesRes.json();
        let renewals = [];
        try {
            const renewalsRes = await apiFetch('/api/dealer/renewals?days=30', { headers: authHeaders() });
            if (renewalsRes.ok) renewals = await renewalsRes.json();
        } catch {}

        if (meRes.ok) {
            dealerData = await meRes.json();
            updateCreditDisplay();
            updateCreditInfo();
        }

        const credits = dealerData?.credits ?? 0;
        const creditColor = credits > 0 ? 'var(--green)' : '#f87171';
        document.getElementById('dashStats').innerHTML = `
            <div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">Toplam Satış</div></div>
            <div class="stat-card"><div class="stat-value">${stats.thisMonth}</div><div class="stat-label">Bu Ay</div></div>
            <div class="stat-card"><div class="stat-value">${stats.byPlan?.PRO || 0}</div><div class="stat-label">Pro Lisans</div></div>
            <div class="stat-card"><div class="stat-value">${stats.byPlan?.ENT || 0}</div><div class="stat-label">Enterprise</div></div>
            <div class="stat-card"><div class="stat-value" style="color:${creditColor}">💳 ${credits}</div><div class="stat-label">Kredi Bakiyesi</div></div>
        `;

        document.getElementById('recentSales').innerHTML = sales.length
            ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="color:var(--text-secondary)">
                    <th style="text-align:left;padding:6px">Tarih</th>
                    <th style="padding:6px">Plan</th><th style="padding:6px">Tier</th>
                    <th style="text-align:left;padding:6px">Not</th>
                </tr></thead>
                <tbody>${sales.map(s => `<tr style="border-top:1px solid var(--border)">
                    <td style="padding:6px;color:var(--text-secondary)">${new Date(s.createdAt).toLocaleDateString('tr')}</td>
                    <td style="text-align:center;padding:6px">${s.plan}</td>
                    <td style="text-align:center;padding:6px">${s.tier}</td>
                    <td style="padding:6px">${escHtml(s.customerNote)}</td>
                </tr>`).join('')}</tbody>
               </table>`
            : '<p class="text-muted" style="padding:12px">Henüz satış bulunmuyor</p>';
        if (renewals.length) {
            const target = document.getElementById('recentSales');
            target.innerHTML =
                `<div style="border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.08);border-radius:8px;padding:10px 12px;margin-bottom:12px;color:#fde68a;font-size:13px">
                    ${renewals.length} lisans 30 gun icinde yenileme penceresinde. Ilk musteri: ${escHtml(renewals[0].customerNote || renewals[0].licenseKey)}
                </div>` + target.innerHTML;
        }
    } catch (e) {
        if (e.isSessionExpired) return;
        console.error('dashboard error:', e);
    }
}

// ─── FİYATLAR ─────────────────────────────────────────────
async function loadPrices() {
    try {
        const res = await apiFetch('/api/dealer/prices', { headers: authHeaders() });
        pricesData = await res.json();
        updatePricePreview();
    } catch (e) {
        if (e.isSessionExpired) return;
    }
}

function renderPrices() {
    if (!pricesData) { document.getElementById('priceTable').innerHTML = '<p class="text-muted">Yükleniyor...</p>'; return; }
    const { prices, tierInfo, discountPct } = pricesData;

    let html = `<div class="card"><p class="text-muted" style="margin-bottom:12px">İndirim oranınız: <strong>%${discountPct}</strong></p>`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="color:var(--text-secondary)">
            <th style="text-align:left;padding:8px">Tier</th>
            <th style="padding:8px">PRO Aylık</th><th style="padding:8px">PRO Yıllık</th>
            <th style="padding:8px">ENT Aylık</th><th style="padding:8px">ENT Yıllık</th>
        </tr></thead><tbody>`;

    const tiers = ['T1','T2','T3','T4','T5','T6','T7','T8','T9'];
    for (const tier of tiers) {
        const info = tierInfo?.[tier];
        html += `<tr style="border-top:1px solid var(--border)">
            <td style="padding:8px"><strong>${tier}</strong><div style="font-size:11px;color:var(--text-secondary)">${info?.label || ''}</div></td>
            <td style="text-align:center;padding:8px">$${prices?.PRO?.[tier]?.M ?? '—'}</td>
            <td style="text-align:center;padding:8px">$${prices?.PRO?.[tier]?.Y ?? '—'}</td>
            <td style="text-align:center;padding:8px">$${prices?.ENT?.[tier]?.M ?? '—'}</td>
            <td style="text-align:center;padding:8px">$${prices?.ENT?.[tier]?.Y ?? '—'}</td>
        </tr>`;
    }
    html += '</tbody></table></div>';
    document.getElementById('priceTable').innerHTML = html;
}

async function loadWhiteLabel() {
    const status = document.getElementById('whiteLabelStatus');
    try {
        const res = await apiFetch('/api/dealer/white-label', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'White-label ayarlari alinamadi');
        document.getElementById('wlEnabled').checked = data.enabled === true;
        document.getElementById('wlName').value = data.name || '';
        document.getElementById('wlDetails').value = data.details || '';
        document.getElementById('wlContact').value = data.contactInfo || '';
        document.getElementById('wlAccent').value = data.accentColor || '';
        if (status) status.textContent = 'Mevcut marka ayarlari yuklendi.';
    } catch (e) {
        if (e.isSessionExpired) return;
        if (status) status.innerHTML = `<span class="text-red">${escHtml(e.message)}</span>`;
    }
}

async function saveWhiteLabel() {
    const status = document.getElementById('whiteLabelStatus');
    const payload = {
        enabled: document.getElementById('wlEnabled')?.checked === true,
        name: document.getElementById('wlName')?.value.trim() || '',
        details: document.getElementById('wlDetails')?.value.trim() || '',
        contactInfo: document.getElementById('wlContact')?.value.trim() || '',
        accentColor: document.getElementById('wlAccent')?.value.trim() || ''
    };
    if (payload.enabled && !payload.name) {
        if (status) status.innerHTML = '<span class="text-red">White-label acikken firma adi zorunludur.</span>';
        return;
    }
    try {
        const res = await apiFetch('/api/dealer/white-label', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Kaydedilemedi');
        if (status) status.innerHTML = '<span class="text-green">White-label rapor ayarlari kaydedildi.</span>';
    } catch (e) {
        if (e.isSessionExpired) return;
        if (status) status.innerHTML = `<span class="text-red">${escHtml(e.message)}</span>`;
    }
}

function updatePricePreview() {
    if (!pricesData) return;
    const plan = document.querySelector('input[name="genPlan"]:checked')?.value || 'PRO';
    const tier = document.getElementById('genTier')?.value || 'T2';
    const duration = document.querySelector('input[name="genDuration"]:checked')?.value || 'M';

    const price = pricesData.prices?.[plan]?.[tier]?.[duration];
    const el = document.getElementById('pricePreview');
    if (price != null) {
        el.textContent = price === 0 ? 'Özel Anlaşma' : `$${price} / ${duration === 'M' ? 'ay' : 'yıl'}`;
    } else {
        el.textContent = '—';
    }
    updateCreditInfo();
}

// ─── SATIŞ GEÇMİŞİ ───────────────────────────────────────
async function loadSales() {
    try {
        const res = await apiFetch('/api/dealer/sales', { headers: authHeaders() });
        const sales = await res.json();
        document.getElementById('salesTable').innerHTML = sales.length
            ? `<div class="card"><table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="color:var(--text-secondary)">
                    <th style="text-align:left;padding:6px">Tarih</th>
                    <th style="padding:6px">Plan</th><th style="padding:6px">Tier</th><th style="padding:6px">Süre</th>
                    <th style="padding:6px">Kredi</th>
                    <th style="text-align:left;padding:6px">Lisans Anahtarı</th>
                    <th style="text-align:left;padding:6px">Not</th>
                </tr></thead>
                <tbody>${sales.map(s => `<tr style="border-top:1px solid var(--border)">
                    <td style="padding:6px;color:var(--text-secondary)">${new Date(s.createdAt).toLocaleDateString('tr')}</td>
                    <td style="text-align:center;padding:6px">${s.plan}</td>
                    <td style="text-align:center;padding:6px">${s.tier}</td>
                    <td style="text-align:center;padding:6px">${s.duration === 'Y' ? 'Yıllık' : 'Aylık'}</td>
                    <td style="text-align:center;padding:6px;font-weight:600">${s.creditCost ?? '—'}</td>
                    <td style="padding:6px;font-family:monospace;font-size:11px">${escHtml(s.licenseKey)}</td>
                    <td style="padding:6px">${escHtml(s.customerNote)}</td>
                </tr>`).join('')}</tbody>
               </table></div>`
            : '<p class="text-muted">Henüz satış bulunmuyor</p>';
    } catch (e) {
        if (e.isSessionExpired) return;
        document.getElementById('salesTable').innerHTML = `<p class="text-red">${e.message}</p>`;
    }
}

// ─── MÜŞTERİ YÖNETİMİ ────────────────────────────────────
let _custData = [];

async function loadCustomers() {
    const el = document.getElementById('custTable');
    if (el) el.innerHTML = '<p class="text-muted" style="padding:12px">Yükleniyor…</p>';
    try {
        const res = await apiFetch('/api/dealer/customers', { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _custData = await res.json();
        custRender();
        _populateCustomerDropdown();
    } catch (e) {
        if (e.isSessionExpired) return;
        if (el) el.innerHTML = `<p class="text-red">${escHtml(e.message)}</p>`;
    }
}

function _populateCustomerDropdown() {
    const sel = document.getElementById('genCustomerId');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Müşteri seçin veya notu elle yazın —</option>' +
        _custData.map(c => `<option value="${escHtml(c.id)}" data-name="${escHtml(c.name)}"${c.id===cur?' selected':''}>${escHtml(c.name)}${c.company ? ' – '+escHtml(c.company) : ''}</option>`).join('');
}

function custRender() {
    const el = document.getElementById('custTable');
    const summary = document.getElementById('custSummary');
    if (!el) return;
    const q = (document.getElementById('custFilter')?.value || '').toLowerCase().trim();
    const rows = _custData.filter(c => {
        if (!q) return true;
        return `${c.name} ${c.company} ${c.email}`.toLowerCase().includes(q);
    });
    if (summary) summary.textContent = `${rows.length} / ${_custData.length} müşteri`;
    if (!rows.length) {
        el.innerHTML = _custData.length
            ? '<p class="text-muted" style="padding:12px">Arama sonucu bulunamadı.</p>'
            : '<p class="text-muted" style="padding:12px">Henüz müşteri eklenmemiş. Yukarıdaki "Müşteri Ekle" butonuyla başlayın.</p>';
        return;
    }
    el.innerHTML = rows.map(c => {
        const licCount = c.sales?.length || 0;
        const licBadge = licCount > 0
            ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(99,102,241,0.15);color:#818cf8">🔑 ${licCount} lisans</span>`
            : `<span style="font-size:11px;opacity:.5">Lisans yok</span>`;
        const licRows = (c.sales || []).map(s => {
            const durLabel = s.duration === 'Y' ? 'Yıllık' : s.duration === 'T' ? 'Trial' : 'Aylık';
            const fp = s.hasFingerprint ? ' 🔒' : '';
            return `<div class="cust-license-row">
                <span style="font-weight:600">${escHtml(s.plan)} ${escHtml(s.tier)}</span>
                <span style="opacity:.6">${durLabel}${fp}</span>
                <span style="font-family:monospace;font-size:10px;color:var(--text-secondary)">${escHtml((s.licenseKey||'').slice(0,14)+'…')}</span>
                <span style="opacity:.5;font-size:11px">${new Date(s.createdAt).toLocaleDateString('tr')}</span>
            </div>`;
        }).join('');
        return `<div class="cust-card">
            <div class="cust-card-header">
                <div>
                    <div class="cust-card-title">${escHtml(c.name)}${c.company ? ` <span style="font-weight:400;opacity:.7">· ${escHtml(c.company)}</span>` : ''}</div>
                    <div class="cust-card-meta">${c.email ? `✉️ ${escHtml(c.email)}` : ''}${c.email && c.phone ? ' &nbsp;·&nbsp; ' : ''}${c.phone ? `📞 ${escHtml(c.phone)}` : ''}</div>
                    ${c.notes ? `<div class="cust-card-meta" style="margin-top:3px">📝 ${escHtml(c.notes)}</div>` : ''}
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    ${licBadge}
                    <button class="btn btn-ghost btn-sm" onclick="editCust('${escHtml(c.id)}')">✏️ Düzenle</button>
                    <button class="btn btn-ghost btn-sm" onclick="deleteCust('${escHtml(c.id)}','${escHtml(c.name)}')" style="color:#f87171;border-color:rgba(248,113,113,.3)">🗑</button>
                </div>
            </div>
            ${licRows ? `<div class="cust-licenses">${licRows}</div>` : ''}
        </div>`;
    }).join('');
}

function showCustForm(id) {
    document.getElementById('custFormWrap').style.display = '';
    document.getElementById('cfEditId').value = id || '';
    document.getElementById('custFormTitle').textContent = id ? '✏️ Müşteri Düzenle' : '➕ Yeni Müşteri';
    document.getElementById('custFormStatus').textContent = '';
    if (!id) {
        ['cfName','cfCompany','cfEmail','cfPhone','cfNotes'].forEach(f => {
            const el = document.getElementById(f); if (el) el.value = '';
        });
    }
    document.getElementById('cfName')?.focus();
}

function hideCustForm() {
    document.getElementById('custFormWrap').style.display = 'none';
    document.getElementById('cfEditId').value = '';
}

function editCust(id) {
    const c = _custData.find(x => x.id === id);
    if (!c) return;
    showCustForm(id);
    document.getElementById('cfName').value    = c.name    || '';
    document.getElementById('cfCompany').value = c.company || '';
    document.getElementById('cfEmail').value   = c.email   || '';
    document.getElementById('cfPhone').value   = c.phone   || '';
    document.getElementById('cfNotes').value   = c.notes   || '';
}

async function saveCust() {
    const id      = document.getElementById('cfEditId').value;
    const name    = document.getElementById('cfName').value.trim();
    const company = document.getElementById('cfCompany').value.trim();
    const email   = document.getElementById('cfEmail').value.trim();
    const phone   = document.getElementById('cfPhone').value.trim();
    const notes   = document.getElementById('cfNotes').value.trim();
    const status  = document.getElementById('custFormStatus');
    if (!name) { status.innerHTML = '<span class="text-red">Ad alanı zorunludur.</span>'; return; }
    status.textContent = '⏳ Kaydediliyor…';
    try {
        const res = await apiFetch(id ? `/api/dealer/customers/${id}` : '/api/dealer/customers', {
            method: id ? 'PUT' : 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ name, company, email, phone, notes })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Hata');
        status.innerHTML = '<span class="text-green">✅ Kaydedildi.</span>';
        setTimeout(hideCustForm, 800);
        loadCustomers();
    } catch (e) {
        if (e.isSessionExpired) return;
        status.innerHTML = `<span class="text-red">❌ ${escHtml(e.message)}</span>`;
    }
}

async function deleteCust(id, name) {
    if (!confirm(`"${name}" silinsin mi?`)) return;
    try {
        const res = await apiFetch(`/api/dealer/customers/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) { const d = await res.json(); alert(d.error || 'Silinemedi'); return; }
        loadCustomers();
    } catch (e) { if (!e.isSessionExpired) alert(e.message); }
}

// ─── FİNGERPRİNT TOGGLE ───────────────────────────────────
function toggleFingerprint() {
    const body = document.getElementById('fpBody');
    const icon = document.getElementById('fpToggleIcon');
    if (!body) return;
    const open = body.classList.toggle('open');
    if (icon) icon.textContent = open ? '▼' : '▶';
}

// Trial seçilince fingerprint alanını gizle
function onDurationChange() {
    updatePricePreview();
    const dur = document.querySelector('input[name="genDuration"]:checked')?.value;
    const wrap = document.getElementById('genFingerprintWrap');
    if (wrap) wrap.style.display = dur === 'T' ? 'none' : '';
}

// Müşteri seçilince Not alanına isim yaz
function onGenCustomerChange() {
    const sel = document.getElementById('genCustomerId');
    const noteEl = document.getElementById('genNote');
    if (!sel || !noteEl) return;
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.value) noteEl.value = opt.dataset.name || opt.text;
    else if (!noteEl.value) noteEl.value = '';
}

// ─── LİSANS ÜRETİMİ ──────────────────────────────────────
async function generateLicense() {
    const plan = document.querySelector('input[name="genPlan"]:checked')?.value || 'PRO';
    const tier = document.getElementById('genTier').value;
    const duration = document.querySelector('input[name="genDuration"]:checked')?.value || 'M';
    const note = document.getElementById('genNote').value.trim();
    const customerId = document.getElementById('genCustomerId')?.value || null;

    // Fingerprint (trial değilse zorunlu)
    let fingerprint = null;
    if (duration !== 'T') {
        const fpRaw = document.getElementById('genFingerprint')?.value.trim();
        if (!fpRaw) {
            alert('⚠️ Parmak izi zorunludur.\n\nMüşterinin uygulamasındaki Ana Sayfa → Cihaz Parmak İzi kartından JSON\'ı kopyalayıp yapıştırın.\n\nTrialda parmak izi gerekmez.');
            document.getElementById('genFingerprint')?.closest('[id$="Wrap"]')?.querySelector('.fp-toggle')?.click();
            document.getElementById('genFingerprint')?.focus();
            return;
        }
        try { fingerprint = JSON.parse(fpRaw); }
        catch { alert('Parmak izi JSON formatı geçersiz. Lütfen kontrol edin.'); return; }
    }

    try {
        const res = await apiFetch('/api/dealer/generate', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ plan, tier, duration, customerNote: note, customerId: customerId || null, fingerprint })
        });
        const data = await res.json();

        if (res.status === 402) {
            alert(`⚠️ Yetersiz Kredi\n\n${data.error}`);
            return;
        }
        if (!res.ok || !data.success) {
            alert(data.error || 'Üretme başarısız');
            return;
        }

        if (dealerData && data.creditsRemaining != null) {
            dealerData.credits = data.creditsRemaining;
            updateCreditDisplay();
            updateCreditInfo();
        }

        document.getElementById('genKeyBox').textContent = data.licenseKey;
        const resultDiv = document.getElementById('genResult');
        resultDiv.style.display = '';
        const titleEl = resultDiv.querySelector('.card-title');
        if (titleEl) {
            titleEl.textContent = data.creditCost > 0
                ? `✅ Lisans Üretildi — ${data.creditCost} kredi düşüldü, kalan: ${data.creditsRemaining}`
                : '✅ Lisans Üretildi';
        }
        // Fingerprint alanını temizle
        const fpEl = document.getElementById('genFingerprint');
        if (fpEl) fpEl.value = '';

        loadDashboard();
        // Müşteri listesini güncelle (yeni lisans eklenmiş olabilir)
        if (customerId) loadCustomers();
    } catch (e) {
        if (e.isSessionExpired) return;
        alert(e.message);
    }
}

function copyKey() {
    const key = document.getElementById('genKeyBox').textContent;
    navigator.clipboard.writeText(key).then(() => alert('Kopyalandı!')).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = key; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        alert('Kopyalandı!');
    });
}

function escHtml(v) {
    const d = document.createElement('span'); d.textContent = v || ''; return d.innerHTML;
}

// ─── OTO-GİRİŞ KONTROLÜ ──────────────────────────────────
(async function init() {
    if (!dealerToken) return;
    try {
        const savedData = sessionStorage.getItem('dealerData');
        if (savedData) dealerData = JSON.parse(savedData);

        const res = await fetch('/api/dealer/me', { headers: authHeaders() });
        if (res.ok) {
            dealerData = await res.json();
            // Oturum süresi bilinmiyor — son validasyon zamanından 8 saat say
            const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
            sessionStorage.setItem('sessionExpiresAt', String(expiresAt));
            _startSessionWarning(expiresAt);
            showPortal();
        } else {
            _clearSession();
        }
    } catch {
        _clearSession();
    }
})();

// ══════════════════════════════════════════════════════════
// BAYİ İSTATİSTİKLERİ
// ══════════════════════════════════════════════════════════
let _statsData = null;

async function loadStats() {
    document.getElementById('statsCards').innerHTML =
        '<div class="stat-card"><div class="stat-value" style="opacity:.4">—</div><div class="stat-label">Yükleniyor…</div></div>';
    try {
        const res = await apiFetch('/api/dealer/stats/detailed', { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _statsData = await res.json();
        renderStats(_statsData);
    } catch (e) {
        if (e.isSessionExpired) return;
        document.getElementById('statsCards').innerHTML = `<p class="text-red">${escHtml(e.message)}</p>`;
    }
}

function renderStats(d) {
    // ── Özet kartlar ─────────────────────────────────────
    const creditColor = (d.totalCreditCost || 0) > 0 ? 'var(--accent)' : 'var(--text-secondary)';
    document.getElementById('statsCards').innerHTML = `
        <div class="stat-card"><div class="stat-value">${d.total}</div><div class="stat-label">Toplam Satış</div></div>
        <div class="stat-card"><div class="stat-value">${d.thisMonth}</div><div class="stat-label">Bu Ay</div></div>
        <div class="stat-card"><div class="stat-value">${d.byPlan?.PRO || 0}</div><div class="stat-label">Pro Lisans</div></div>
        <div class="stat-card"><div class="stat-value">${d.byPlan?.ENT || 0}</div><div class="stat-label">Enterprise</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${creditColor}">${d.totalCreditCost || 0}</div><div class="stat-label">Toplam Kredi Harcaması</div></div>
        <div class="stat-card"><div class="stat-value">${d.avgCreditCost || 0}</div><div class="stat-label">Ortalama Kredi/Satış</div></div>
    `;

    // ── Aylık trend bar chart ──────────────────────────────
    const trend = d.monthlyTrend || [];
    const maxCount = Math.max(...trend.map(t => t.count), 1);
    const monthNames = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
    document.getElementById('statsMonthChart').innerHTML = `
        <div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding:0 8px">
            ${trend.map(t => {
                const pct = Math.round((t.count / maxCount) * 100);
                const mon = t.month ? monthNames[parseInt(t.month.split('-')[1]) - 1] : '';
                const yr  = t.month ? t.month.split('-')[0].slice(2) : '';
                return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
                    <div style="font-size:11px;color:var(--text-secondary);font-weight:600">${t.count > 0 ? t.count : ''}</div>
                    <div style="width:100%;background:var(--surface2);border-radius:4px 4px 0 0;transition:height .3s"
                         title="${t.month}: ${t.count} satış">
                        <div style="width:100%;height:${Math.max(pct, t.count > 0 ? 8 : 2)}px;
                                    background:${t.count > 0 ? 'var(--accent)' : 'var(--border)'};
                                    border-radius:4px 4px 0 0;opacity:${t.count > 0 ? 1 : 0.3}"></div>
                    </div>
                    <div style="font-size:10px;color:var(--text-secondary);text-align:center;line-height:1.2">${mon}<br>'${yr}</div>
                </div>`;
            }).join('')}
        </div>
    `;

    // ── Plan & Süre dağılımı ───────────────────────────────
    const pro  = d.byPlan?.PRO  || 0;
    const ent  = d.byPlan?.ENT  || 0;
    const aylik = d.byDuration?.M || 0;
    const yillik = d.byDuration?.Y || 0;
    const total = d.total || 1;

    function pctBar(val, tot, color, label) {
        const pct = tot > 0 ? Math.round((val / tot) * 100) : 0;
        return `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                <span style="color:var(--text-secondary)">${label}</span>
                <span style="font-weight:600">${val} <span style="opacity:.5;font-weight:400">(${pct}%)</span></span>
            </div>
            <div style="background:var(--surface2);border-radius:4px;height:8px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width .4s"></div>
            </div>
        </div>`;
    }

    document.getElementById('statsPlanDur').innerHTML = `
        <div style="padding:0 8px">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.5;margin-bottom:8px">Plan</div>
            ${pctBar(pro,  total, '#6366f1', 'Pro')}
            ${pctBar(ent,  total, '#10b981', 'Enterprise')}
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.5;margin:12px 0 8px">Süre</div>
            ${pctBar(aylik,  total, '#f59e0b', 'Aylık')}
            ${pctBar(yillik, total, '#60a5fa', 'Yıllık')}
        </div>
    `;

    // ── Tier tablosu ───────────────────────────────────────
    const tiers = ['T1','T2','T3','T4','T5','T6','T7','T8','T9'];
    const tierLabels = { T1:'50/ay', T2:'100/ay', T3:'250/ay', T4:'500/ay', T5:'1.000/ay',
                         T6:'2.000/ay', T7:'5.000/ay', T8:'10.000/ay', T9:'Sınırsız' };
    const maxTier = Math.max(...tiers.map(t => d.byTier?.[t] || 0), 1);
    const rows = tiers.map(t => {
        const cnt = d.byTier?.[t] || 0;
        const pct = Math.round((cnt / maxTier) * 100);
        return `<tr style="border-top:1px solid var(--border)${cnt === 0 ? ';opacity:0.4' : ''}">
            <td style="padding:8px 12px;font-weight:700">${t}</td>
            <td style="padding:8px;color:var(--text-secondary);font-size:12px">${tierLabels[t]}</td>
            <td style="padding:8px 12px;font-weight:600;text-align:right">${cnt}</td>
            <td style="padding:8px 16px;min-width:160px">
                <div style="background:var(--surface2);border-radius:4px;height:8px">
                    <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:4px"></div>
                </div>
            </td>
        </tr>`;
    }).join('');

    document.getElementById('statsTierTable').innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.04em">
                <th style="text-align:left;padding:8px 12px">Tier</th>
                <th style="text-align:left;padding:8px">Limit</th>
                <th style="text-align:right;padding:8px 12px">Satış</th>
                <th style="padding:8px 16px">Dağılım</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

// ══════════════════════════════════════════════════════════
// BAYİ HAREKETLERİ (Satış + Kredi İşlem Feed)
// ══════════════════════════════════════════════════════════
let _activityData = [];

async function loadActivity() {
    const el = document.getElementById('activityFeed');
    if (el) el.innerHTML = '<p class="text-muted" style="padding:12px">Yükleniyor…</p>';
    try {
        const res = await apiFetch('/api/dealer/activity?limit=200', { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _activityData = await res.json();
        renderActivity();
    } catch (e) {
        if (e.isSessionExpired) return;
        if (el) el.innerHTML = `<p class="text-red">${escHtml(e.message)}</p>`;
    }
}

function renderActivity() {
    const el = document.getElementById('activityFeed');
    if (!el) return;
    const filter = document.getElementById('activityFilter')?.value || '';
    const rows = _activityData.filter(r => !filter || r.kind === filter);

    if (!rows.length) {
        el.innerHTML = '<p class="text-muted" style="padding:12px">Hareket bulunamadı.</p>';
        return;
    }

    const kindIcon = { sale: '🔑', credit: '💳' };
    const typeLabel = {
        load:   { label: 'Kredi Yükleme',   color: '#10b981' },
        deduct: { label: 'Kredi Kesintisi',  color: '#f87171' },
        adjust: { label: 'Kredi Düzeltme',   color: '#f59e0b' }
    };

    const tableRows = rows.map(r => {
        const date = new Date(r.date).toLocaleString('tr', { dateStyle: 'short', timeStyle: 'short' });

        if (r.kind === 'sale') {
            const durLabel = r.duration === 'Y' ? 'Yıllık' : 'Aylık';
            return `<tr style="border-top:1px solid var(--border)">
                <td style="padding:8px 12px;white-space:nowrap;color:var(--text-secondary);font-size:12px">${date}</td>
                <td style="padding:8px;text-align:center">
                    <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(99,102,241,0.15);color:#818cf8">🔑 Satış</span>
                </td>
                <td style="padding:8px 12px">
                    <span style="font-weight:600">${escHtml(r.plan)} ${escHtml(r.tier)}</span>
                    <span style="font-size:11px;color:var(--text-secondary);margin-left:6px">${durLabel}</span>
                    ${r.note ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${escHtml(r.note)}</div>` : ''}
                </td>
                <td style="padding:8px;text-align:right;font-weight:600;color:#f87171;white-space:nowrap">
                    ${r.creditCost > 0 ? `−${r.creditCost} kredi` : '<span style="opacity:.5">—</span>'}
                </td>
                <td style="padding:8px 12px;font-family:monospace;font-size:10px;color:var(--text-secondary);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${r.licenseKey ? escHtml(r.licenseKey.slice(0,16) + '…') : ''}
                </td>
            </tr>`;
        }

        // credit
        const tl = typeLabel[r.type] || { label: r.type, color: '#94a3b8' };
        const sign = r.amount > 0 ? '+' : '';
        const amtColor = r.amount > 0 ? '#10b981' : '#f87171';
        return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:8px 12px;white-space:nowrap;color:var(--text-secondary);font-size:12px">${date}</td>
            <td style="padding:8px;text-align:center">
                <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${tl.color}22;color:${tl.color}">💳 ${tl.label}</span>
            </td>
            <td style="padding:8px 12px;color:var(--text-secondary);font-size:13px">${escHtml(r.note)}</td>
            <td style="padding:8px;text-align:right;font-weight:700;color:${amtColor};white-space:nowrap">
                ${sign}${r.amount} kredi
            </td>
            <td style="padding:8px 12px;font-size:12px;color:var(--text-secondary);white-space:nowrap">
                Bakiye: ${r.balanceAfter}
            </td>
        </tr>`;
    }).join('');

    el.innerHTML = `
        <div class="card">
            <div style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    <thead><tr style="color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border)">
                        <th style="text-align:left;padding:8px 12px">Tarih</th>
                        <th style="padding:8px;text-align:center">Tür</th>
                        <th style="text-align:left;padding:8px 12px">Detay</th>
                        <th style="text-align:right;padding:8px">Tutar</th>
                        <th style="text-align:left;padding:8px 12px">Ek Bilgi</th>
                    </tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <div style="padding:10px 12px;font-size:12px;color:var(--text-secondary);border-top:1px solid var(--border)">
                ${rows.length} hareket gösteriliyor
            </div>
        </div>
    `;
}

// ══════════════════════════════════════════════════════════
// GÜVENİLİR DOMAIN (OTX WHITELIST) YÖNETİMİ — Bayi Portal
// ══════════════════════════════════════════════════════════
let _bdTdAll = [];

function _bdTdHeaders(extra) {
    return Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dealerToken }, extra || {});
}

function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function tdLoad() {
    const listEl = document.getElementById('bdTdList');
    const sumEl  = document.getElementById('bdTdSummary');
    if (!listEl) return;
    listEl.innerHTML = '<div style="padding:12px;opacity:0.6">⏳ Yükleniyor…</div>';
    try {
        const res = await apiFetch('/api/dealer/trusted-domains', {
            headers: _bdTdHeaders()
        });
        if (!res.ok) { listEl.innerHTML = `<div style="padding:12px;color:#f87171">Yüklenemedi: ${res.status}</div>`; return; }
        _bdTdAll = await res.json();

        // Kategori filtresi güncelle
        const catSel = document.getElementById('bdTdFilterCat');
        if (catSel) {
            const cats = [...new Set(_bdTdAll.map(t => t.category))].sort();
            const cur  = catSel.value;
            catSel.innerHTML = '<option value="">Tüm kategoriler</option>' +
                cats.map(c => `<option value="${_esc(c)}"${c===cur?' selected':''}>${_esc(c)}</option>`).join('');
        }
        tdRender();
    } catch (e) {
        if (!e.isSessionExpired) listEl.innerHTML = `<div style="padding:12px;color:#f87171">Hata: ${_esc(e.message)}</div>`;
    }
}

function tdRender() {
    const listEl  = document.getElementById('bdTdList');
    const sumEl   = document.getElementById('bdTdSummary');
    const filter  = (document.getElementById('bdTdFilter')?.value || '').toLowerCase();
    const catFilter = document.getElementById('bdTdFilterCat')?.value || '';
    if (!listEl) return;

    const filtered = _bdTdAll.filter(t => {
        if (catFilter && t.category !== catFilter) return false;
        if (filter && !t.domain.includes(filter)) return false;
        return true;
    });

    if (sumEl) sumEl.textContent = `${filtered.length} / ${_bdTdAll.length} domain`;

    if (!filtered.length) {
        listEl.innerHTML = '<div style="padding:16px;opacity:0.6;text-align:center">Liste boş veya filtre eşleşmedi.</div>';
        return;
    }

    const catColors = { tech:'#60a5fa', cloud:'#34d399', social:'#a78bfa', finance:'#fbbf24',
        cdn:'#94a3b8', ai:'#f472b6', tr_service:'#fb923c', custom:'#64748b', standard:'#6ee7b7' };

    listEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
                <tr style="border-bottom:1px solid var(--border);opacity:0.6;font-size:11px;text-transform:uppercase;letter-spacing:.04em">
                    <th style="padding:8px 10px;text-align:left">Domain</th>
                    <th style="padding:8px 10px;text-align:left">Kategori</th>
                    <th style="padding:8px 10px;text-align:left">Not</th>
                    <th style="padding:8px 10px;text-align:left">Durum</th>
                    <th style="padding:8px 10px;text-align:right">İşlem</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(t => {
                    const color = catColors[t.category] || '#94a3b8';
                    const enabled = t.enabled !== 0;
                    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);${enabled ? '' : 'opacity:0.4'}">
                        <td style="padding:8px 10px;font-family:monospace;font-weight:600">${_esc(t.domain)}</td>
                        <td style="padding:8px 10px"><span style="font-size:11px;padding:2px 7px;border-radius:4px;background:${color}22;color:${color}">${_esc(t.category)}</span></td>
                        <td style="padding:8px 10px;font-size:12px;opacity:0.65;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(t.note||'')}</td>
                        <td style="padding:8px 10px">
                            <button onclick="tdToggle('${_esc(t.domain)}',${!enabled})" style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid ${enabled?'#34d399':'#94a3b8'};color:${enabled?'#34d399':'#94a3b8'};background:transparent;cursor:pointer">
                                ${enabled ? '✅ Aktif' : '⏸ Pasif'}
                            </button>
                        </td>
                        <td style="padding:8px 10px;text-align:right">
                            <button onclick="tdRemove('${_esc(t.domain)}')" style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid rgba(239,68,68,0.4);color:#f87171;background:transparent;cursor:pointer">🗑 Sil</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
}

async function tdAdd() {
    const domain   = document.getElementById('bdTdDomain')?.value.trim();
    const category = document.getElementById('bdTdCategory')?.value || 'custom';
    const note     = document.getElementById('bdTdNote')?.value.trim() || '';
    const resEl    = document.getElementById('bdTdAddResult');
    if (!domain) { resEl.textContent = '❌ Domain zorunludur.'; resEl.style.color='#f87171'; return; }
    try {
        const res = await apiFetch('/api/dealer/trusted-domains', {
            method: 'POST',
            headers: _bdTdHeaders(),
            body: JSON.stringify({ domain, category, note })
        });
        const data = await res.json();
        if (!res.ok) { resEl.textContent = '❌ ' + (data.error || res.status); resEl.style.color='#f87171'; return; }
        resEl.textContent = `✅ ${data.domain} eklendi.`; resEl.style.color='#34d399';
        document.getElementById('bdTdDomain').value = '';
        document.getElementById('bdTdNote').value   = '';
        tdLoad();
    } catch (e) { if (!e.isSessionExpired) { resEl.textContent='❌ '+e.message; resEl.style.color='#f87171'; } }
}

async function tdBulkAdd() {
    const raw      = document.getElementById('bdTdBulk')?.value || '';
    const category = document.getElementById('bdTdBulkCat')?.value || 'custom';
    const resEl    = document.getElementById('bdTdBulkResult');
    const domains  = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!domains.length) { resEl.textContent='❌ Liste boş.'; resEl.style.color='#f87171'; return; }
    try {
        const res = await apiFetch('/api/dealer/trusted-domains/bulk', {
            method: 'POST',
            headers: _bdTdHeaders(),
            body: JSON.stringify({ domains, category })
        });
        const data = await res.json();
        if (!res.ok) { resEl.textContent='❌ '+(data.error||res.status); resEl.style.color='#f87171'; return; }
        resEl.textContent=`✅ ${data.accepted?.length||0} eklendi${data.rejected?.length ? `, ${data.rejected.length} geçersiz atlandı` : ''}.`;
        resEl.style.color='#34d399';
        document.getElementById('bdTdBulk').value = '';
        tdLoad();
    } catch (e) { if (!e.isSessionExpired) { resEl.textContent='❌ '+e.message; resEl.style.color='#f87171'; } }
}

async function tdRemove(domain) {
    if (!confirm(`"${domain}" silinsin mi?`)) return;
    try {
        const res = await apiFetch(`/api/dealer/trusted-domains/${encodeURIComponent(domain)}`, {
            method: 'DELETE', headers: _bdTdHeaders()
        });
        if (!res.ok) { alert('Hata: ' + res.status); return; }
        tdLoad();
    } catch (e) { if (!e.isSessionExpired) alert(e.message); }
}

async function tdToggle(domain, enabled) {
    try {
        await apiFetch(`/api/dealer/trusted-domains/${encodeURIComponent(domain)}/toggle`, {
            method: 'PATCH', headers: _bdTdHeaders(),
            body: JSON.stringify({ enabled })
        });
        const t = _bdTdAll.find(x => x.domain === domain);
        if (t) t.enabled = enabled ? 1 : 0;
        tdRender();
    } catch (e) { if (!e.isSessionExpired) alert(e.message); }
}

async function tdExport() {
    try {
        const res = await apiFetch('/api/dealer/trusted-domains/export', { headers: _bdTdHeaders() });
        if (!res.ok) { alert('Dışa aktarma başarısız: ' + res.status); return; }
        const blob = await res.blob();
        const cd   = res.headers.get('Content-Disposition') || '';
        const fnMatch = cd.match(/filename="([^"]+)"/);
        const filename = fnMatch ? fnMatch[1] : 'trusted-domains.json';
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    } catch (e) { if (!e.isSessionExpired) alert('Hata: ' + e.message); }
}

async function tdImportFile(input) {
    const file   = input.files[0];
    if (!file) return;
    input.value  = '';
    const resEl  = document.getElementById('tdBayiImportResult');
    try {
        const text    = await file.text();
        const payload = JSON.parse(text);
        const domains = Array.isArray(payload) ? payload
            : (Array.isArray(payload.domains) ? payload.domains : null);
        if (!domains || !domains.length) {
            resEl.style.cssText = 'display:block;background:rgba(239,68,68,.12);color:#f87171;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px';
            resEl.textContent   = '❌ Geçerli domain listesi bulunamadı.'; return;
        }
        const merge = confirm(`${domains.length} domain içe aktarılacak.\n\n"Tamam" → Mevcut listeyle birleştir\n"İptal" → Önce listeyi temizle, sonra yükle`);
        const res = await apiFetch('/api/dealer/trusted-domains/import', {
            method: 'POST', headers: _bdTdHeaders(),
            body: JSON.stringify({ domains, merge })
        });
        const data = await res.json();
        if (!res.ok) { alert('Hata: ' + (data.error || res.status)); return; }
        resEl.style.cssText = 'display:block;background:rgba(16,185,129,.12);color:#34d399;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px';
        resEl.textContent   = `✅ ${data.accepted?.length||0} domain içe aktarıldı${data.rejected?.length ? `, ${data.rejected.length} geçersiz atlandı` : ''}.${data.replaced ? ' (Liste yenilendi)' : ''}`;
        tdLoad();
    } catch (e) {
        if (!e.isSessionExpired) {
            resEl.style.cssText = 'display:block;background:rgba(239,68,68,.12);color:#f87171;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px';
            resEl.textContent   = '❌ ' + e.message;
        }
    }
}
