// ============================================================
// THREAT INTELLIGENCE FEED MANAGER
// Kaynak: URLhaus (malware URL'leri) + OpenPhish (phishing URL'leri)
// Günlük önbellek — ağ erişimi yoksa sessizce devre dışı kalır.
// ============================================================
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', '..', 'data', 'threat-intel-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

// URLhaus online CSV
const URLHAUS_URL = 'https://urlhaus.abuse.ch/downloads/text_online/';
// OpenPhish feed
const OPENPHISH_URL = 'https://openphish.com/feed.txt';

let _cache = null;
let _cacheLoaded = false;

function loadCache() {
    if (_cacheLoaded) return _cache;
    _cacheLoaded = true;
    try {
        if (!fs.existsSync(CACHE_FILE)) { _cache = null; return null; }
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.updatedAt > CACHE_TTL_MS) { _cache = null; return null; }
        _cache = parsed;
        return _cache;
    } catch {
        _cache = null;
        return null;
    }
}

function saveCache(domains, urls) {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = { updatedAt: Date.now(), domains: [...new Set(domains)], urls: [...new Set(urls)] };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
    _cache = data;
    _cacheLoaded = true;
}

async function refreshFeed() {
    console.log('[ThreatIntel] Feed indirme başlıyor (URLhaus + OpenPhish)...');
    const domains = new Set();
    const urls = new Set();
    let urlhausCount = 0;
    let openphishCount = 0;

    // URLhaus
    try {
        const controller = new AbortController();
        const t1 = setTimeout(() => controller.abort(), 30000);
        const r1 = await fetch(URLHAUS_URL, {
            signal: controller.signal,
            headers: { 'User-Agent': 'MailTrustAI/1.0 (security-research)' }
        });
        clearTimeout(t1);
        if (r1.ok) {
            const text = await r1.text();
            text.split(/\r?\n/).forEach(line => {
                if (line.startsWith('#') || !line.trim()) return;
                urls.add(line.trim());
                try { domains.add(new URL(line.trim()).hostname.toLowerCase()); } catch {}
            });
            urlhausCount = urls.size;
            console.log(`[ThreatIntel] URLhaus: ${urlhausCount} URL indirildi (status ${r1.status})`);
        } else {
            console.warn(`[ThreatIntel] URLhaus HTTP ${r1.status}: ${r1.statusText}`);
        }
    } catch (e) {
        console.error(`[ThreatIntel] URLhaus indirilemedi: ${e.message}`);
    }

    // OpenPhish
    try {
        const controller2 = new AbortController();
        const t2 = setTimeout(() => controller2.abort(), 30000);
        const r2 = await fetch(OPENPHISH_URL, {
            signal: controller2.signal,
            headers: { 'User-Agent': 'MailTrustAI/1.0 (security-research)' }
        });
        clearTimeout(t2);
        if (r2.ok) {
            const text = await r2.text();
            const before = urls.size;
            text.split(/\r?\n/).forEach(line => {
                if (line.startsWith('#') || !line.trim()) return;
                urls.add(line.trim());
                try { domains.add(new URL(line.trim()).hostname.toLowerCase()); } catch {}
            });
            openphishCount = urls.size - before;
            console.log(`[ThreatIntel] OpenPhish: ${openphishCount} yeni URL indirildi (status ${r2.status})`);
        } else {
            console.warn(`[ThreatIntel] OpenPhish HTTP ${r2.status}: ${r2.statusText}`);
        }
    } catch (e) {
        console.error(`[ThreatIntel] OpenPhish indirilemedi: ${e.message}`);
    }

    if (domains.size > 0 || urls.size > 0) {
        saveCache([...domains], [...urls]);
        console.log(`[ThreatIntel] ✓ Önbellek güncellendi: ${domains.size} domain, ${urls.size} URL (URLhaus: ${urlhausCount}, OpenPhish: ${openphishCount})`);
        return { ok: true, domains: domains.size, urls: urls.size };
    } else {
        console.error('[ThreatIntel] ✗ Hiç feed indirilemedi — cache boş kalacak. Ağ erişimi var mı? Proxy/firewall kontrolü gerekebilir.');
        return { ok: false, domains: 0, urls: 0 };
    }
}

// Sunucu başlangıcında arka planda yükle
function initThreatIntelFeed() {
    const cache = loadCache();
    if (!cache) {
        // refreshFeed içinde kendi hata logları var; bu catch sadece beklenmedik throw'lar için
        refreshFeed().catch(e => console.warn('[ThreatIntel] İlk feed yüklemesi başarısız (beklenmedik):', e.message));
    }
    // Her 24 saatte bir güncelle
    // unref: test/graceful-shutdown sırasında process'i açık tutmaz.
    const _feedTimer = setInterval(() => {
        _cacheLoaded = false;
        const c = loadCache();
        if (!c) {
            refreshFeed().catch(e => console.warn('[ThreatIntel] Periyodik feed yenilemesi başarısız (beklenmedik):', e.message));
        }
    }, CACHE_TTL_MS);
    if (_feedTimer.unref) _feedTimer.unref();
}

function isThreatDomain(domain) {
    const cache = loadCache();
    if (!cache || !Array.isArray(cache.domains)) return false;
    const d = String(domain || '').toLowerCase();
    return cache.domains.some(td => d === td || d.endsWith('.' + td));
}

function isThreatUrl(url) {
    const cache = loadCache();
    if (!cache || !Array.isArray(cache.urls)) return false;
    return cache.urls.includes(url);
}

function getThreatIntelStats() {
    const cache = loadCache();
    return {
        available: !!cache,
        domainCount: cache?.domains?.length || 0,
        urlCount: cache?.urls?.length || 0,
        updatedAt: cache?.updatedAt ? new Date(cache.updatedAt).toISOString() : null
    };
}

module.exports = { initThreatIntelFeed, isThreatDomain, isThreatUrl, getThreatIntelStats, refreshFeed };
