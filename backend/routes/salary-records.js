const express = require('express');
const router = express.Router();
const { SalaryRecord } = require('../models');
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
