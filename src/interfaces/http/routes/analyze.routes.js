// ============================================================
// HTTP routes: dosya/EML yükleme analiz endpoint'leri
//   POST /api/analyze/eml
//   POST /api/analyze/file
//   POST /api/analyze/deep-ai  ← Derinlemesine AI inceleme (5 limit)
// ============================================================
const express = require('express');
const multer  = require('multer');

const { parseEmail, parseUploadedEmail } = require('../../../analysis/parser');
const { analyzeParsedEmail, analyzeStandaloneAttachment } =
    require('../../../application/analyze/AnalyzeUploadedMailService');
const { state, checkLicense, checkDailyLimit, checkMonthlyLimit, incrementScanCounts } =
    require('../../../services/appState');
const { findScanById, updateScanById } = require('../../../storage/scanHistory');
const { buildEvidencePack } = require('../../../analysis/evidencePack');
const { deepAnalyzeRisk } = require('../../../integrations/openai');
const { getMonthlyCount } = require('../../../storage/monthlyCounter');

const DEEP_AI_COST = 5; // Derinlemesine inceleme aylık limitten 5 düşer

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/analyze/eml', upload.single('file'), async (req, res) => {
    try {
        const license = checkLicense(req);
        if (!checkDailyLimit(license))   return res.status(429).json({ error: 'Daily scan limit reached' });
        if (!checkMonthlyLimit(license)) return res.status(429).json({ error: 'Monthly scan limit reached' });

        let source;
        if (req.file)             source = req.file.buffer;
        else if (req.body.source) source = req.body.source;
        else return res.status(400).json({ error: 'No EML file or source provided' });

        const parsed = req.file
            ? await parseUploadedEmail(source, req.file.originalname || '')
            : await parseEmail(source);
        if (!parsed.success) return res.status(400).json({ error: parsed.error });

        const result = await analyzeParsedEmail(parsed.data, license, 'upload');
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/analyze/file', upload.single('file'), async (req, res) => {
    try {
        const license = checkLicense(req);
        if (!checkDailyLimit(license))   return res.status(429).json({ error: 'Daily scan limit reached' });
        if (!checkMonthlyLimit(license)) return res.status(429).json({ error: 'Monthly scan limit reached' });
        if (!req.file) return res.status(400).json({ error: 'No file provided' });

        const lowerName = String(req.file.originalname || '').toLowerCase();
        if (lowerName.endsWith('.eml') || lowerName.endsWith('.msg')) {
            const parsed = await parseUploadedEmail(req.file.buffer, req.file.originalname || '');
            if (!parsed.success) return res.status(400).json({ error: parsed.error });
            const result = await analyzeParsedEmail(parsed.data, license, 'upload');
            return res.json(result);
        }

        const result = await analyzeStandaloneAttachment({
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size:     req.file.size,
            buffer:   req.file.buffer
        }, license);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// POST /api/analyze/deep-ai
// Body: { scanId: string, force?: boolean }
//
// • Mevcut bir taramayı OpenAI'den derinlemesine analiz ettirir.
// • Sonuç scan history'ye `deepAiAnalysis` alanı olarak kaydedilir.
// • Aylık tarama limitinden DEEP_AI_COST (5) düşer.
// • Aynı tarama için zaten yapılmışsa cached sonuç döner; force:true verildiğinde
//   yeniden hesaplanır (yine 5 limit).
// ============================================================
router.post('/analyze/deep-ai', async (req, res) => {
    try {
        const { scanId, force } = req.body || {};
        if (!scanId) return res.status(400).json({ error: 'scanId zorunludur' });

        const license = checkLicense(req);
        const scan = findScanById(scanId);
        if (!scan) return res.status(404).json({ error: 'Tarama bulunamadı' });

        // Cache: zaten yapılmışsa ve force değilse
        if (scan.deepAiAnalysis && !force) {
            return res.json({
                success:  true,
                cached:   true,
                cost:     0,
                analysis: scan.deepAiAnalysis,
                monthlyUsed: getMonthlyCount(undefined, license.usageScope || 'unlicensed'),
                monthlyLimit: license.monthlyLimit ?? 30
            });
        }

        // OpenAI API anahtarı kontrolü
        if (!state.openaiApiKey) {
            return res.status(400).json({
                error: 'OpenAI API anahtarı tanımlı değil. Ayarlardan ekleyin.'
            });
        }

        // Limit kontrolü — 5 yetecek mi?
        const limit = license.monthlyLimit ?? 30;
        if (limit !== Infinity) {
            const used = getMonthlyCount(undefined, license.usageScope || 'unlicensed');
            if (used + DEEP_AI_COST > limit) {
                return res.status(429).json({
                    error: `Bu işlem ${DEEP_AI_COST} tarama hakkı tüketir. Aylık limitiniz yetmiyor (${used}/${limit}).`,
                    needed: DEEP_AI_COST,
                    used,
                    limit
                });
            }
        }

        // Mail içeriği — eklerden ham metni topla
        const meta = scan.emailMeta || {};
        const emailContent = {
            subject: meta.subject || '',
            body:    String(scan.parsedBody || scan.rawText || meta.bodyExcerpt || '').slice(0, 8000)
        };

        const evidencePack = buildEvidencePack(scan);
        const aiRes = await deepAnalyzeRisk(state.openaiApiKey, { evidencePack, emailContent }, state.openaiModel);
        if (!aiRes.success) {
            return res.status(502).json({ error: aiRes.error || 'AI derinlemesine inceleme başarısız' });
        }

        const deepAiAnalysis = {
            ...aiRes.report,
            modelUsed:   aiRes.modelUsed,
            requestedAt: new Date().toISOString(),
            cost:        DEEP_AI_COST
        };

        // Tarama kaydını güncelle
        updateScanById(scanId, { deepAiAnalysis });

        // Limiti tüket — DEEP_AI_COST kez artır
        for (let i = 0; i < DEEP_AI_COST; i++) {
            incrementScanCounts(license);
        }

        res.json({
            success:      true,
            cached:       false,
            cost:         DEEP_AI_COST,
            analysis:     deepAiAnalysis,
            monthlyUsed:  getMonthlyCount(undefined, license.usageScope || 'unlicensed'),
            monthlyLimit: license.monthlyLimit ?? 30
        });
    } catch (e) {
        console.error('[DeepAI] hata:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
