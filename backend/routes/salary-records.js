const express = require('express');
const router = express.Router();
const { SalaryRecord } = require('../models');
const { Op } = require('sequelize');
const { authenticate } = require('../middleware/auth');

// GET /api/salary-records?misUserId=...
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId required' });

    const records = await SalaryRecord.findAll({
      where: { misUserId },
      order: [['dateFrom', 'DESC']],
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
    const { misUserId, doctorName, dateFrom, dateTo, periodLabel, reportData } = req.body;
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
      createdBy: req.user?.id || null,
    });

    res.status(201).json(record);
  } catch (err) {
    console.error('POST /api/salary-records error:', err);
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
