// ============================================================
// HTTP routes: tarama geçmişi, istatistikler, CSV export
// ============================================================
const express = require('express');

const { loadScanHistory, getDetailedStats } = require('../../../storage/scanHistory');
const { loadCredentials } = require('../../../imap/connection');
const { getMonthlyCount } = require('../../../storage/monthlyCounter');
const { getDailyCount } = require('../../../storage/dailyScansStore');
const { state } = require('../../../services/appState');
const { loadSettings } = require('../../../storage/settingsStore');
const { validateLicenseKey } = require('../../../license/license');
const { buildRiskDashboard } = require('../../../services/riskDashboardService');
const { getUsageSummary: getLlmUsageSummary } = require('../../../storage/llmUsageStore');

const router = express.Router();

function resolveCurrentLicense(req) {
    const settings = loadSettings();
    const key = String(req.headers['x-license-key'] || req.body?.licenseKey || settings.activeLicenseKey || '').trim();
    if (!key) return null;
    const validation = validateLicenseKey(key);
    return validation.valid ? { ...validation, maskedKey: `${key.slice(0, 8)}...${key.slice(-4)}` } : null;
}

function buildCommercialAlerts(dashboard, license) {
    const alerts = [];
    if (license?.daysLeft !== undefined && license.daysLeft <= 7) {
        alerts.push({
            type: license.daysLeft <= 3 ? 'critical' : 'warning',
            title: 'Lisans yenileme firsati',
            message: `Aktif lisansin bitmesine ${license.daysLeft} gun kaldi. Yenileme/upgrade gorusmesi icin dogru zaman.`
        });
    }
    if (license && license.plan !== 'enterprise') {
        alerts.push({
            type: 'upgrade',
            title: 'Enterprise upgrade onerisi',
            message: 'Anlik izleme, tum mail raporu ve API erisimi icin Enterprise pakete yukseltme onerilebilir.'
        });
    }
    if (dashboard.stats.high > 0 || dashboard.score < 75) {
        alerts.push({
            type: 'risk',
            title: 'Guvenlik aksiyonu gerekli',
            message: `Son ${dashboard.periodDays} gunde ${dashboard.stats.high} yuksek riskli mail ve ${dashboard.stats.risky} toplam riskli mail goruldu.`
        });
    }
    return alerts;
}

function buildExecutiveSummary(req) {
    const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 365));
    const license = resolveCurrentLicense(req);
    const dashboard = buildRiskDashboard({
        history: loadScanHistory(),
        periodDays: days,
        license
    });
    return {
        ...dashboard,
        commercialAlerts: buildCommercialAlerts(dashboard, license)
    };
}

router.get('/risk-dashboard', (req, res) => {
    res.json(buildExecutiveSummary(req));
});

router.get('/reports/executive/summary', (req, res) => {
    res.json(buildExecutiveSummary(req));
});

router.get('/history', (req, res) => {
    state.scanHistory = loadScanHistory();
    res.json(state.scanHistory.slice(0, 50));
});

router.get('/stats/detailed', (req, res) => {
    // Tarih aralığı modları:
    //   ?days=N         → son N gün (1..365)
    //   ?start=YYYY-MM-DD&end=YYYY-MM-DD → özel aralık
    const { start, end } = req.query;
    if (start && end) {
        const sd = new Date(start);
        const ed = new Date(end);
        if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) {
            return res.status(400).json({ error: 'Geçersiz tarih: start/end YYYY-MM-DD formatında olmalı.' });
        }
        if (sd.getTime() > ed.getTime()) {
            return res.status(400).json({ error: 'start tarihi end tarihinden büyük olamaz.' });
        }
        return res.json(getDetailedStats({ start, end }));
    }
    const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 365));
    res.json(getDetailedStats(days));
});

router.get('/stats', (req, res) => {
    state.scanHistory = loadScanHistory();
    const today   = new Date().toISOString().slice(0, 10);
    const history = state.scanHistory;

    const byLevel = { high: 0, medium: 0, low: 0, safe: 0 };
    for (const s of history) {
        const lvl = s.level || 'safe';
        if (byLevel[lvl] !== undefined) byLevel[lvl]++;
        else byLevel.safe++;
    }

    const bySource = {};
    for (const s of history) {
        const src = s.scanSource || 'unknown';
        bySource[src] = (bySource[src] || 0) + 1;
    }

    const trend7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const count = history.filter(s => (s.timestamp || s.scanTime || '').slice(0, 10) === dateStr).length;
        trend7.push({ date: dateStr, count });
    }

    const catCount = {};
    for (const s of history.slice(0, 200)) {
        for (const f of (s.findings || [])) {
            if (f.severity === 'critical' || f.severity === 'warning') {
                const cat = f.category || 'other';
                catCount[cat] = (catCount[cat] || 0) + 1;
            }
        }
    }
    const topCategories = Object.entries(catCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([category, count]) => ({ category, count }));

    const vtHits    = history.filter(s => s.vtStatus?.checked && (s.findings || []).some(f => f.category === 'virusTotal' && f.severity === 'critical')).length;
    const otxHits   = history.filter(s => (s.findings || []).some(f => f.category === 'otx')).length;
    const abuseHits = history.filter(s => (s.findings || []).some(f => f.category === 'abuse')).length;

    res.json({
        totalScans:    history.length,
        todayScans:    getDailyCount(today),
        monthlyScans:  getMonthlyCount(),
        threats:       byLevel.high,
        accounts:      loadCredentials().length,
        byLevel, bySource, trend7, topCategories, vtHits, otxHits, abuseHits
    });
});

// ─── LLM kullanım istatistikleri (provider × model bazında çağrı sayısı) ─
router.get('/stats/llm-usage', (req, res) => {
    const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 90));
    res.json(getLlmUsageSummary({ days }));
});

// VirusTotal tespitleri — istatistik paneli için ek/mail detayı
router.get('/stats/vt-detections', (req, res) => {
    const history = loadScanHistory();
    const results = [];

    for (const scan of history) {
        const vtFiles = (scan.virusTotal || []).filter(v =>
            (v.stats?.malicious || 0) > 0 || (v.stats?.suspicious || 0) > 0
        );
        if (!vtFiles.length) continue;

        const meta = scan.emailMeta || {};
        const from    = meta.from?.[0]?.address || '';
        const fromName= meta.from?.[0]?.name    || '';
        const subject = meta.subject || '(Konu yok)';
        const date    = meta.date || scan.timestamp || '';

        for (const vt of vtFiles) {
            // Engine listesini birleştir ve deduplikasyon yap (aynı virus adı birden fazla motorda)
            const engines = [
                ...(vt.maliciousEngines  || []).map(e => ({ engine: e.engine, result: e.result, type: 'malicious' })),
                ...(vt.suspiciousEngines || []).map(e => ({ engine: e.engine, result: e.result, type: 'suspicious' }))
            ];
            results.push({
                scanId:    scan.id || scan.timestamp || '',
                timestamp: scan.timestamp || '',
                filename:  vt.filename || vt.name || '—',
                sha256:    vt.sha256 || vt.hash || '',
                fileType:  vt.typeDescription || '',
                link:      vt.link || '',
                malicious: vt.stats?.malicious  || 0,
                suspicious:vt.stats?.suspicious || 0,
                total:     vt.stats?.total      || 0,
                engines,
                email: { from, fromName, subject, date }
            });
        }
    }

    // En çok malicious önce, sonra tarih
    results.sort((a, b) => (b.malicious + b.suspicious) - (a.malicious + a.suspicious) || b.timestamp.localeCompare(a.timestamp));

    res.json(results.slice(0, 200));
});

// OTX ile tespit edilen domain/hostname listesi — istatistik paneli FP entegrasyonu için
router.get('/stats/otx-domains', (req, res) => {
    const history = loadScanHistory();
    const domainMap = new Map(); // domain → { severity, message, lastSeen, count }

    for (const scan of history) {
        for (const f of (scan.findings || [])) {
            if (f.category !== 'otx') continue;
            if (!f.indicatorValue) continue;
            if (f.indicatorType === 'IPv4') continue;
            if (f.severity !== 'critical' && f.severity !== 'warning') continue;

            const key = f.indicatorValue;
            const ts  = scan.timestamp || scan.scanTime || '';
            if (!domainMap.has(key)) {
                domainMap.set(key, { domain: key, severity: f.severity, message: f.message || '', lastSeen: ts, count: 1 });
            } else {
                const entry = domainMap.get(key);
                entry.count++;
                // En yüksek severity'yi koru
                if (f.severity === 'critical') entry.severity = 'critical';
                // En son görülme tarihini güncelle
                if (ts > entry.lastSeen) { entry.lastSeen = ts; entry.message = f.message || entry.message; }
            }
        }
    }

    const list = Array.from(domainMap.values())
        .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
        .slice(0, 100);

    res.json(list);
});

router.get('/history/export.csv', (req, res) => {
    const history = loadScanHistory();
    const limit   = Math.min(Number(req.query.limit) || 500, 1000);
    const rows    = history.slice(0, limit);

    const headers  = ['Tarih','Seviye','Skor','Gonderen','Alici','Konu','Ek_Sayisi','VT_Zararli','AI_Seviye'];
    const csvLines = [headers.join(',')];

    for (const row of rows) {
        const meta = row.emailMeta || {};
        const from = (meta.from?.[0]?.address || '').replace(/,/g, ';');
        const to   = (meta.to?.[0]?.address   || '').replace(/,/g, ';');
        const subj = String(meta.subject || '').replace(/,/g, ';').replace(/"/g, "'").slice(0, 100);
        const attCount    = meta.attachmentCount || (Array.isArray(row.attachmentDetails) ? row.attachmentDetails.length : 0);
        const vtMalicious = (row.virusTotal || []).reduce((s, v) => s + (v.stats?.malicious || 0), 0);
        const aiLevel     = row.openaiAnalysis?.threatLevel || '';
        const date        = row.timestamp ? new Date(row.timestamp).toISOString().slice(0, 19).replace('T', ' ') : '';
        csvLines.push([date, row.level || '', row.score || 0, from, to, `"${subj}"`, attCount, vtMalicious, aiLevel].join(','));
    }

    const csv = '﻿' + csvLines.join('\r\n'); // UTF-8 BOM for Excel
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mailtrustai-tarama-gecmisi-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
});

module.exports = router;
