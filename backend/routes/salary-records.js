const express = require('express');
const router = express.Router();
const { SalaryRecord } = require('../models');
const { Op, literal } = require('sequelize');
const { authenticate } = require('../middleware/auth');

// GET /api/salary-records/find?misUserId=X&dateFrom=Y — найти запись за тот же год-месяц
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

// GET /api/salary-records/all — все записи (сводка)
router.get('/all', authenticate, async (req, res) => {
  try {
    const records = await SalaryRecord.findAll({
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
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, dateFrom, dateTo, periodLabel, reportData, excelBase64 } = req.body;
    if (!misUserId || !doctorName) {
      return res.status(400).json({ error: 'misUserId and doctorName required' });
    }

    const record = await SalaryRecord.create({
      misUserId,
      doctorName,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      periodLabel: periodLabel || null,
      reportData: reportData || null,
      excelData: excelBase64 || null,
      createdBy: req.user?.id || null,
    });

    res.status(201).json(record);
  } catch (err) {
    console.error('POST /api/salary-records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salary-records/:id/excel — скачать сохранённый Excel-файл
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
// Returns all assistance payments from saved salary records in the period,
// so Doctor B can see income that Doctor A deducted from their own report.
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

// PUT /api/salary-records/:id — перезаписать существующую запись
router.put('/:id', authenticate, async (req, res) => {
  try {
    const record = await SalaryRecord.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    const { dateFrom, dateTo, periodLabel, reportData, excelBase64 } = req.body;
    await record.update({
      dateFrom:    dateFrom    || null,
      dateTo:      dateTo      || null,
      periodLabel: periodLabel || null,
      reportData:  reportData  || null,
      excelData:   excelBase64 !== undefined ? (excelBase64 || null) : record.excelData,
    });
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
    await record.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/salary-records error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
