const express = require('express');
const router  = express.Router();
const { DoctorSchedule } = require('../models');
const { authenticate } = require('../middleware/auth');

// GET /api/doctor-schedules?misUserId=...
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId required' });

    const rows = await DoctorSchedule.findAll({
      where: { misUserId },
      order: [['dateFrom', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    console.error('GET doctor-schedules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/doctor-schedules
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, clinicId, dateFrom, dateTo, pattern, timeFrom, timeTo, exceptions, categoryId, cabinetId } = req.body;
    if (!misUserId || !clinicId || !dateFrom || !dateTo || !pattern) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const row = await DoctorSchedule.create({
      misUserId,
      clinicId,
      dateFrom,
      dateTo,
      pattern,
      timeFrom:   timeFrom   || '09:00',
      timeTo:     timeTo     || '18:00',
      exceptions: exceptions || [],
      categoryId: categoryId || null,
      cabinetId:  cabinetId  || null,
      createdBy:  req.user?.id || null,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST doctor-schedules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/doctor-schedules/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const row = await DoctorSchedule.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const { clinicId, dateFrom, dateTo, pattern, timeFrom, timeTo, exceptions, categoryId, cabinetId } = req.body;
    await row.update({
      ...(clinicId    !== undefined && { clinicId }),
      ...(dateFrom    !== undefined && { dateFrom }),
      ...(dateTo      !== undefined && { dateTo }),
      ...(pattern     !== undefined && { pattern }),
      ...(timeFrom    !== undefined && { timeFrom }),
      ...(timeTo      !== undefined && { timeTo }),
      ...(exceptions  !== undefined && { exceptions }),
      ...(categoryId  !== undefined && { categoryId: categoryId || null }),
      ...(cabinetId   !== undefined && { cabinetId:  cabinetId  || null }),
    });
    await row.reload();
    res.json(row);
  } catch (err) {
    console.error('PUT doctor-schedules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/doctor-schedules/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await DoctorSchedule.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE doctor-schedules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
