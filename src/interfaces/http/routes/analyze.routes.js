// ============================================================
// HTTP routes: dosya/EML yükleme analiz endpoint'leri
//   POST /api/analyze/eml
//   POST /api/analyze/file
// ============================================================
const express = require('express');
const multer  = require('multer');

const { parseEmail, parseUploadedEmail } = require('../../../analysis/parser');
const { analyzeParsedEmail, analyzeStandaloneAttachment } =
    require('../../../application/analyze/AnalyzeUploadedMailService');
const { checkLicense, checkDailyLimit, checkMonthlyLimit } =
    require('../../../services/appState');

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

module.exports = router;
