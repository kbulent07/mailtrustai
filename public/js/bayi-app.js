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
    const code = document.getElementById('loginCode').value.trim().toUpperCase();
    const pin = document.getElementById('loginPin').value;
    const errEl = document.getElementById('loginError');
    errEl.style.display = 'none';

    if (!code || !pin) {
        errEl.textContent = 'Bayi kodu ve PIN gereklidir';
        errEl.style.display = '';
        return;
    }

    try {
        const res = await fetch('/api/dealer/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, pin })
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
        `👤 ${dealerData?.name || dealerData?.code || ''} | İndirim: %${dealerData?.discountPct || 0}`;
    updateCreditDisplay();
    loadDashboard();
    loadPrices();
}

function showSection(name) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`section${name.charAt(0).toUpperCase() + name.slice(1)}`).classList.add('active');
    document.querySelectorAll('.bayi-nav a').forEach(a => a.classList.remove('active'));
    event.target.classList.add('active');

    if (name === 'sales')     loadSales();
    if (name === 'customers') loadCustomers();
    if (name === 'prices')    renderPrices();
    if (name === 'branding')  loadWhiteLabel();
    if (name === 'trusted')   tdLoad();
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

// ─── MÜŞTERİ ENVANTERİ ───────────────────────────────────
let _custData = [];   // tüm inventory, filtre için bellekte tutar

async function loadCustomers() {
    const el = document.getElementById('custTable');
    if (el) el.innerHTML = '<p class="text-muted" style="padding:12px">Yükleniyor…</p>';
    try {
        const res = await apiFetch('/api/dealer/inventory', { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _custData = await res.json();
        custRender();
    } catch (e) {
        if (e.isSessionExpired) return;
        if (el) el.innerHTML = `<p class="text-red">${escHtml(e.message)}</p>`;
    }
}

function custRender() {
    const el     = document.getElementById('custTable');
    const summary = document.getElementById('custSummary');
    if (!el) return;

    const q      = (document.getElementById('custFilter')?.value || '').toLowerCase().trim();
    const status = document.getElementById('custStatusFilter')?.value || '';

    const rows = _custData.filter(c => {
        // Metin filtresi
        if (q) {
            const hay = `${c.customerNote} ${c.licenseKey}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        // Durum filtresi
        if (status === 'expired')  return c.expired;
        if (status === 'expiring') return !c.expired && c.daysLeft <= 30;
        if (status === 'active')   return !c.expired && c.daysLeft > 30;
        return true;
    });

    const total   = _custData.length;
    const active  = _custData.filter(c => !c.expired && c.daysLeft > 30).length;
    const expiring = _custData.filter(c => !c.expired && c.daysLeft <= 30).length;
    const expired  = _custData.filter(c => c.expired).length;
    if (summary) summary.textContent =
        `${total} müşteri · ${active} aktif · ${expiring} yakında bitiyor · ${expired} süresi dolmuş`;

    if (!rows.length) {
        el.innerHTML = '<p class="text-muted" style="padding:12px">Kayıt bulunamadı.</p>';
        return;
    }

    const badgeHtml = (c) => {
        if (c.expired)           return `<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:rgba(239,68,68,0.15);color:#f87171">❌ Sona Erdi</span>`;
        if (c.daysLeft <= 7)     return `<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:rgba(239,68,68,0.12);color:#f87171">⚠️ ${c.daysLeft} gün</span>`;
        if (c.daysLeft <= 30)    return `<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:rgba(251,191,36,0.15);color:#fbbf24">⚠️ ${c.daysLeft} gün</span>`;
        return `<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:rgba(16,185,129,0.12);color:#10b981">✅ ${c.daysLeft} gün</span>`;
    };

    const maskKey = (k) => k ? k.slice(0, 8) + '…' + k.slice(-6) : '—';

    el.innerHTML = `
        <div class="card">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="color:var(--text-secondary);border-bottom:1px solid var(--border)">
                    <th style="text-align:left;padding:8px 6px">Müşteri</th>
                    <th style="padding:6px;text-align:center">Plan</th>
                    <th style="padding:6px;text-align:center">Tier</th>
                    <th style="padding:6px;text-align:center">Süre</th>
                    <th style="padding:6px;text-align:center">Bitiş</th>
                    <th style="padding:6px;text-align:center">Durum</th>
                    <th style="text-align:left;padding:6px">Lisans (kısmi)</th>
                </tr></thead>
                <tbody>
                    ${rows.map(c => `<tr style="border-top:1px solid var(--border)">
                        <td style="padding:8px 6px;font-weight:600">${escHtml(c.customerNote || '—')}</td>
                        <td style="text-align:center;padding:6px">${escHtml(c.plan || '—')}</td>
                        <td style="text-align:center;padding:6px">${escHtml(c.tier || '—')}</td>
                        <td style="text-align:center;padding:6px">${c.duration === 'Y' ? 'Yıllık' : 'Aylık'}</td>
                        <td style="text-align:center;padding:6px;color:var(--text-secondary);font-size:12px">
                            ${c.expiryDate ? new Date(c.expiryDate).toLocaleDateString('tr') : '—'}
                        </td>
                        <td style="text-align:center;padding:6px">${badgeHtml(c)}</td>
                        <td style="padding:6px;font-family:monospace;font-size:11px;color:var(--text-secondary)">
                            ${escHtml(maskKey(c.licenseKey))}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

// ─── LİSANS ÜRETİMİ ──────────────────────────────────────
async function generateLicense() {
    const plan = document.querySelector('input[name="genPlan"]:checked')?.value || 'PRO';
    const tier = document.getElementById('genTier').value;
    const duration = document.querySelector('input[name="genDuration"]:checked')?.value || 'M';
    const note = document.getElementById('genNote').value.trim();

    try {
        const res = await apiFetch('/api/dealer/generate', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ plan, tier, duration, customerNote: note })
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

        // Kredi bakiyesini anında güncelle
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

        loadDashboard();
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
