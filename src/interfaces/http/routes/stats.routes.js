// ============================================================
// HTTP routes: tarama geçmişi, istatistikler, CSV export
// ============================================================
const express = require('express');

const { loadScanHistory, getDetailedStats } = require('../../../storage/scanHistory');
const { loadCredentials } = require('../../../imap/connection');
const { getMonthlyCount } = require('../../../storage/monthlyCounter');
const { getDailyCount } = require('../../../storage/dailyScansStore');
const { state } = require('../../../services/appState');

const router = express.Router();

router.get('/history', (req, res) => {
    state.scanHistory = loadScanHistory();
    res.json(state.scanHistory.slice(0, 50));
});

router.get('/stats/detailed', (req, res) => {
    const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 90));
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

    const vtHits  = history.filter(s => s.vtStatus?.checked && (s.findings || []).some(f => f.category === 'virusTotal' && f.severity === 'critical')).length;
    const otxHits = history.filter(s => (s.findings || []).some(f => f.category === 'otx')).length;

    res.json({
        totalScans:    history.length,
        todayScans:    getDailyCount(today),
        monthlyScans:  getMonthlyCount(),
        threats:       byLevel.high,
        accounts:      loadCredentials().length,
        byLevel, bySource, trend7, topCategories, vtHits, otxHits
    });
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
