// ============================================================
// LLM KULLANIM SAYACI — provider × model × tarih bazlı çağrı sayımı
// JSON dosyada persist edilir; her çağrıda atomic update.
//
// Yapı:
//   {
//     "lifetime": {
//       "openai|gpt-4o-mini": { calls: 1234, errors: 12, lastCallAt: ISO },
//       "openai|gpt-4o":      { ... },
//       "anthropic|claude-haiku-4-5": { ... }
//     },
//     "daily": {
//       "2026-05-09": {
//         "openai|gpt-4o-mini": { calls: 42, errors: 1 }
//       }
//     }
//   }
// ============================================================
const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'llm-usage.json');
const DAILY_RETENTION_DAYS = 90;

let _cache = null;

function _ensureLoaded() {
    if (_cache) return _cache;
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (fs.existsSync(FILE_PATH)) {
            _cache = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
        } else {
            _cache = { lifetime: {}, daily: {} };
        }
    } catch {
        _cache = { lifetime: {}, daily: {} };
    }
    if (!_cache.lifetime) _cache.lifetime = {};
    if (!_cache.daily) _cache.daily = {};
    return _cache;
}

function _persist() {
    try {
        fs.writeFileSync(FILE_PATH, JSON.stringify(_cache, null, 2), 'utf8');
    } catch (e) {
        console.error('[LLM Usage] Persist hatası:', e.message);
    }
}

function _todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function _pruneOldDailies() {
    const cutoff = new Date(Date.now() - DAILY_RETENTION_DAYS * 86400 * 1000).toISOString().slice(0, 10);
    for (const day of Object.keys(_cache.daily)) {
        if (day < cutoff) delete _cache.daily[day];
    }
}

/**
 * Bir LLM çağrısını kaydet.
 * @param {Object} opts
 * @param {string} opts.provider   - 'openai' | 'anthropic'
 * @param {string} opts.model      - örn. 'gpt-4o-mini' veya 'claude-haiku-4-5-20251001'
 * @param {string} [opts.purpose]  - 'analysis' | 'adjudicate' | 'other' (default: 'other')
 * @param {boolean} [opts.success] - true = başarılı, false = hata (default: true)
 * @param {Object} [opts.usage]    - { promptTokens, completionTokens, totalTokens }
 */
function recordCall({ provider, model, purpose = 'other', success = true, usage = null } = {}) {
    if (!provider || !model) return;
    _ensureLoaded();

    const key = `${provider}|${model}`;
    const day = _todayKey();

    // Lifetime
    if (!_cache.lifetime[key]) {
        _cache.lifetime[key] = {
            provider, model,
            calls: 0, errors: 0, lastCallAt: null,
            byPurpose: {}, totalTokens: 0
        };
    }
    const lt = _cache.lifetime[key];
    lt.calls += 1;
    if (!success) lt.errors += 1;
    lt.lastCallAt = new Date().toISOString();
    lt.byPurpose[purpose] = (lt.byPurpose[purpose] || 0) + 1;
    if (usage?.totalTokens) lt.totalTokens += Number(usage.totalTokens) || 0;

    // Daily
    if (!_cache.daily[day]) _cache.daily[day] = {};
    if (!_cache.daily[day][key]) {
        _cache.daily[day][key] = { provider, model, calls: 0, errors: 0, byPurpose: {} };
    }
    const dl = _cache.daily[day][key];
    dl.calls += 1;
    if (!success) dl.errors += 1;
    dl.byPurpose[purpose] = (dl.byPurpose[purpose] || 0) + 1;

    _pruneOldDailies();
    _persist();
}

function getUsageSummary({ days = 30 } = {}) {
    _ensureLoaded();

    // Lifetime özeti
    const lifetime = Object.values(_cache.lifetime).map(e => ({ ...e }))
        .sort((a, b) => b.calls - a.calls);

    // Son N günün toplamı
    const cutoff = new Date(Date.now() - (days - 1) * 86400 * 1000).toISOString().slice(0, 10);
    const recentByModel = {};
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
        let dayTotal = 0;
        const dayDetail = _cache.daily[d] || {};
        for (const k of Object.keys(dayDetail)) {
            dayTotal += dayDetail[k].calls;
            if (!recentByModel[k]) {
                recentByModel[k] = { provider: dayDetail[k].provider, model: dayDetail[k].model, calls: 0, errors: 0 };
            }
            recentByModel[k].calls  += dayDetail[k].calls;
            recentByModel[k].errors += dayDetail[k].errors;
        }
        trend.push({ date: d, calls: dayTotal });
    }

    return {
        lifetime,
        recent: {
            days,
            byModel: Object.values(recentByModel).sort((a, b) => b.calls - a.calls),
            trend
        }
    };
}

module.exports = { recordCall, getUsageSummary };
