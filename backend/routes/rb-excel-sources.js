const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { RbExcelSource } = require('../models');
const { authenticate } = require('../middleware/auth');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// GET /api/rb-excel-sources — список всех источников (без fileData)
router.get('/', authenticate, async (req, res) => {
  try {
    const sources = await RbExcelSource.findAll({
      attributes: ['id', 'dateFrom', 'dateTo', 'periodLabel', 'fileName', 'uploadedBy', 'createdAt', 'updatedAt'],
      order: [['dateFrom', 'DESC']],
    });
    res.json(sources.map(s => {
      const d = s.toJSON();
      return { ...d, uploadedAt: d.createdAt };
    }));
  } catch (err) {
    console.error('GET /api/rb-excel-sources error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rb-excel-sources/:id/file — скачать Excel файл
router.get('/:id/file', authenticate, async (req, res) => {
  try {
    const source = await RbExcelSource.findByPk(req.params.id, {
      attributes: ['id', 'fileName', 'fileData'],
    });
    if (!source) return res.status(404).json({ error: 'Источник не найден' });

    const buf = Buffer.from(source.fileData, 'base64');
    const encoded = encodeURIComponent(source.fileName);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
      'Content-Length': buf.length,
    });
    res.send(buf);
  } catch (err) {
    console.error('GET /api/rb-excel-sources/:id/file error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rb-excel-sources — добавить источник
router.post('/',
  authenticate,
  [
    body('dateFrom').isDate().withMessage('dateFrom должен быть датой'),
    body('dateTo').isDate().withMessage('dateTo должен быть датой'),
    body('fileName').notEmpty().withMessage('fileName обязателен'),
    body('fileBase64').notEmpty().withMessage('fileBase64 обязателен'),
  ],
  validate,
  async (req, res) => {
    try {
      const { dateFrom, dateTo, periodLabel, fileName, fileBase64, uploadedBy } = req.body;

      if (dateFrom > dateTo) {
        return res.status(400).json({ error: 'dateFrom не может быть позже dateTo' });
      }

      const source = await RbExcelSource.create({
        dateFrom,
        dateTo,
        periodLabel: periodLabel || null,
        fileName,
        fileData: fileBase64,
        uploadedBy: uploadedBy || req.user?.displayName || req.user?.username || null,
      });

      // Возвращаем без fileData
      res.status(201).json({
        id: source.id,
        dateFrom: source.dateFrom,
        dateTo: source.dateTo,
        periodLabel: source.periodLabel,
        fileName: source.fileName,
        uploadedBy: source.uploadedBy,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      });
    } catch (err) {
      console.error('POST /api/rb-excel-sources error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /api/rb-excel-sources/:id — обновить период / название / имя файла
router.put('/:id',
  authenticate,
  [
    body('dateFrom').isDate().withMessage('dateFrom должен быть датой'),
    body('dateTo').isDate().withMessage('dateTo должен быть датой'),
  ],
  validate,
  async (req, res) => {
    try {
      const source = await RbExcelSource.findByPk(req.params.id);
      if (!source) return res.status(404).json({ error: 'Источник не найден' });

      const { dateFrom, dateTo, periodLabel, fileName } = req.body;

      if (dateFrom > dateTo) {
        return res.status(400).json({ error: 'dateFrom не может быть позже dateTo' });
      }

      const updates = { dateFrom, dateTo, periodLabel: periodLabel || null };
      if (fileName && fileName.trim()) updates.fileName = fileName.trim();

      await source.update(updates);

      res.json({
        id: source.id,
        dateFrom: source.dateFrom,
        dateTo: source.dateTo,
        periodLabel: source.periodLabel,
        fileName: source.fileName,
        uploadedBy: source.uploadedBy,
        uploadedAt: source.createdAt,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      });
    } catch (err) {
      console.error('PUT /api/rb-excel-sources/:id error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/rb-excel-sources/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const source = await RbExcelSource.findByPk(req.params.id);
    if (!source) return res.status(404).json({ error: 'Источник не найден' });

    await source.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/rb-excel-sources/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
