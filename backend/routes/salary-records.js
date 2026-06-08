const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { SalaryRecord, CashPayment } = require('../models');
const { Op, literal } = require('sequelize');
const { authenticate } = require('../middleware/auth');
const { logRbActivity } = require('../services/rbLogger');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// GET /api/salary-records/find?misUserId=X&dateFrom=Y
router.get('/find', authenticate, async (req, res) => {
  try {
    const { misUserId, dateFrom } = req.query;
    if (!misUserId || !dateFrom) return res.status(400).json({ error: 'misUserId and dateFrom required' });

    const d = new Date(dateFrom);
    const year  = d.getFullYear();
    const month = d.getMonth() + 1;

    const records = await SalaryRecord.findAll({
      where: { misUserId },
      attributes: { exclude: ['excelData'], include: [[literal('("excelData" IS NOT NULL)'), 'hasExcel']] },
    });

    const match = records.find(r => {
      if (!r.dateFrom) return false;
      const rd = new Date(r.dateFrom);
      return rd.getFullYear() === year && (rd.getMonth() + 1) === month;
    });

    res.json(match || null);
  } catch (err) {
    console.error('GET /api/salary-records/find error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salary-records/all?periods=2025-01,2026-02
router.get('/all', authenticate, async (req, res) => {
  try {
    const { periods } = req.query;
    const where = {};

    if (periods) {
      const pad = n => String(n).padStart(2, '0');
      const periodRange = p => {
        const [y, m] = p.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this month
        return { dateFrom: { [Op.between]: [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDay)}`] } };
      };
      const list = String(periods).split(',').map(p => p.trim()).filter(Boolean);
      if (list.length === 1) {
        where.dateFrom = periodRange(list[0]).dateFrom;
      } else if (list.length > 1) {
        where[Op.or] = list.map(periodRange);
      }
    }

    const records = await SalaryRecord.findAll({
      where,
      order: [['dateFrom', 'DESC']],
      attributes: {
        exclude: ['excelData'],
        include: [[literal('("excelData" IS NOT NULL)'), 'hasExcel']],
      },
    });
    res.json(records);
  } catch (err) {
    console.error('GET /api/salary-records/all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salary-records?misUserId=...
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId required' });

    const records = await SalaryRecord.findAll({
      where: { misUserId },
      order: [['dateFrom', 'DESC']],
      attributes: {
        exclude: ['excelData'],
        include: [[literal('("excelData" IS NOT NULL)'), 'hasExcel']],
      },
    });
    res.json(records);
  } catch (err) {
    console.error('GET /api/salary-records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salary-records
router.post('/',
  authenticate,
  body('misUserId').notEmpty().withMessage('misUserId обязателен').isString().trim(),
  body('doctorName').notEmpty().withMessage('doctorName обязателен').isString().trim().isLength({ max: 255 }),
  body('dateFrom').optional({ nullable: true }).isISO8601().withMessage('dateFrom должен быть датой ISO8601'),
  body('dateTo').optional({ nullable: true }).isISO8601().withMessage('dateTo должен быть датой ISO8601'),
  body('periodLabel').optional({ nullable: true }).isString().isLength({ max: 100 }),
  validate,
  async (req, res) => {
  try {
    const { misUserId, doctorName, dateFrom, dateTo, periodLabel, reportData, excelBase64 } = req.body;

    const record = await SalaryRecord.create({
      misUserId,
      doctorName,
      dateFrom:    dateFrom    || null,
      dateTo:      dateTo      || null,
      periodLabel: periodLabel || null,
      reportData:  reportData  || null,
      excelData:   excelBase64 || null,
      createdBy: req.user?.id || null,
    });

    const recPeriod = periodLabel || (dateFrom ? dateFrom.slice(0, 7) : null);
    if (recPeriod) {
      await CashPayment.update(
        { salaryRecordId: record.id },
        { where: { misUserId, salaryRecordId: null, periodLabel: recPeriod } }
      );
    }

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'report',
      action:     'save',
      entityType: 'salary_record',
      entityId:   record.id,
      misUserId,
      doctorName,
      summary:    `Сохранён зарплатный отчёт: ${doctorName}, ${periodLabel || dateFrom?.slice(0, 7) || ''}`,
      diff:       { after: { periodLabel, dateFrom, dateTo } },
    });

    res.status(201).json(record);
  } catch (err) {
    console.error('POST /api/salary-records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salary-records/:id/excel
router.get('/:id/excel', authenticate, async (req, res) => {
  try {
    const record = await SalaryRecord.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    if (!record.excelData) return res.status(404).json({ error: 'Excel file not saved for this record' });

    const buf = Buffer.from(record.excelData, 'base64');
    const safeName = record.doctorName.split(' ')[0] || 'salary';
    const period = record.periodLabel || (record.dateFrom ? record.dateFrom.slice(0, 7) : 'no-period');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`Зарплата_${safeName}_${period}.xlsx`)}`);
    res.send(buf);
  } catch (err) {
    console.error('GET /api/salary-records/:id/excel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salary-records/assistance-income?dateFrom=...&dateTo=...
router.get('/assistance-income', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const where = {};
    if (dateFrom) where.dateFrom = { [Op.gte]: dateFrom };
    if (dateTo)   where.dateTo   = { [Op.lte]: dateTo };

    const records = await SalaryRecord.findAll({ where });
    const result = [];
    for (const record of records) {
      const clinicReports = record.reportData?.clinicReports || [];
      for (const cr of clinicReports) {
        for (const sec of (cr.salary?.assistanceSections || [])) {
          if (sec.total > 0) {
            result.push({
              executorDoctorName: record.doctorName,
              assistantName: sec.name,
              total: sec.total,
              services: sec.services || [],
              clinicId: cr.clinicId,
              clinicLabel: cr.clinicLabel,
              dateFrom: record.dateFrom,
              dateTo: record.dateTo,
            });
          }
        }
      }
    }
    res.json(result);
  } catch (err) {
    console.error('GET /api/salary-records/assistance-income error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/salary-records/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const record = await SalaryRecord.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    const { dateFrom, dateTo, periodLabel, reportData, excelBase64 } = req.body;
    const oldComment = record.reportData?.comment ?? null;
    await record.update({
      dateFrom:    dateFrom    || null,
      dateTo:      dateTo      || null,
      periodLabel: periodLabel || null,
      reportData:  reportData  || null,
      excelData:   excelBase64 !== undefined ? (excelBase64 || null) : record.excelData,
    });

    if (excelBase64) {
      await logRbActivity({
        userId:     req.user?.id,
        tab:        'report',
        action:     'update',
        entityType: 'salary_record',
        entityId:   record.id,
        misUserId:  record.misUserId,
        doctorName: record.doctorName,
        summary:    `Пересохранён зарплатный отчёт: ${record.doctorName}, ${record.periodLabel || ''}`,
        diff:       { after: { periodLabel: record.periodLabel, dateFrom: record.dateFrom, dateTo: record.dateTo } },
      });
    } else {
      const newComment = reportData?.comment ?? null;
      const commentChanged = oldComment !== newComment;
      await logRbActivity({
        userId:     req.user?.id,
        tab:        'summary',
        action:     'update',
        entityType: 'comment',
        entityId:   record.id,
        misUserId:  record.misUserId,
        doctorName: record.doctorName,
        summary:    `Обновлён комментарий в сводке: ${record.doctorName}, ${record.periodLabel || ''}`,
        diff: commentChanged
          ? { before: { comment: oldComment }, after: { comment: newComment } }
          : null,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/salary-records/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/salary-records/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const record = await SalaryRecord.findByPk(id);
    if (!record) return res.status(404).json({ error: 'Not found' });

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'archive',
      action:     'delete',
      entityType: 'salary_record',
      entityId:   id,
      misUserId:  record.misUserId,
      doctorName: record.doctorName,
      summary:    `Удалён зарплатный отчёт из архива: ${record.doctorName}, ${record.periodLabel || ''}`,
      diff:       { before: { periodLabel: record.periodLabel, dateFrom: record.dateFrom, dateTo: record.dateTo } },
    });

    await record.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/salary-records error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
