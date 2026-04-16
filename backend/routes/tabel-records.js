const express = require('express');
const router  = express.Router();
const { TabelRecord, TabelRecordDoctor } = require('../models');
const { authenticate } = require('../middleware/auth');

// GET /api/tabel-records — все батчи (без doctor-строк, только заголовки)
router.get('/', authenticate, async (req, res) => {
  try {
    const records = await TabelRecord.findAll({
      order: [['createdAt', 'DESC']],
      include: [{
        model: TabelRecordDoctor,
        as: 'doctors',
        attributes: ['id', 'misUserId', 'doctorName'],
      }],
    });
    res.json(records);
  } catch (err) {
    console.error('GET /api/tabel-records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tabel-records/by-doctor?misUserId=X — история конкретного врача
router.get('/by-doctor', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId required' });

    const rows = await TabelRecordDoctor.findAll({
      where: { misUserId },
      include: [{
        model: TabelRecord,
        as: 'tabelRecord',
        attributes: ['id', 'month', 'year', 'orgName', 'subdivision', 'docNumber', 'createdAt'],
      }],
      order: [[{ model: TabelRecord, as: 'tabelRecord' }, 'createdAt', 'DESC']],
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/tabel-records/by-doctor error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tabel-records/:id — один батч с полными данными по врачам
router.get('/:id', authenticate, async (req, res) => {
  try {
    const record = await TabelRecord.findByPk(req.params.id, {
      include: [{ model: TabelRecordDoctor, as: 'doctors' }],
    });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    console.error('GET /api/tabel-records/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tabel-records — сохранить новый батч
// body: { month, year, orgName, subdivision, docNumber, doctors: [{misUserId, doctorName, entries, payData}] }
router.post('/', authenticate, async (req, res) => {
  try {
    const { month, year, orgName, subdivision, docNumber, userName, doctors = [] } = req.body;
    if (!month || !year) return res.status(400).json({ error: 'month and year required' });

    const record = await TabelRecord.create({
      month,
      year,
      orgName:     orgName     || null,
      subdivision: subdivision || null,
      docNumber:   docNumber   || null,
      userName:    userName    || null,
      createdBy:   req.user?.id || null,
    });

    if (doctors.length > 0) {
      await TabelRecordDoctor.bulkCreate(
        doctors.map(d => ({
          tabelRecordId: record.id,
          misUserId:     d.misUserId,
          doctorName:    d.doctorName || null,
          entries:       d.entries   || {},
          payData:       d.payData   || {},
        }))
      );
    }

    const full = await TabelRecord.findByPk(record.id, {
      include: [{ model: TabelRecordDoctor, as: 'doctors' }],
    });
    res.status(201).json(full);
  } catch (err) {
    console.error('POST /api/tabel-records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tabel-records/:id — обновить данные врачей в батче
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { doctors = [] } = req.body;
    const record = await TabelRecord.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });

    // Replace all doctor records for this batch
    await TabelRecordDoctor.destroy({ where: { tabelRecordId: record.id } });
    if (doctors.length > 0) {
      await TabelRecordDoctor.bulkCreate(
        doctors.map(d => ({
          tabelRecordId: record.id,
          misUserId:     d.misUserId,
          doctorName:    d.doctorName || null,
          entries:       d.entries   || {},
          payData:       d.payData   || {},
        }))
      );
    }

    const full = await TabelRecord.findByPk(record.id, {
      include: [{ model: TabelRecordDoctor, as: 'doctors' }],
    });
    res.json(full);
  } catch (err) {
    console.error('PUT /api/tabel-records/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tabel-records/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const record = await TabelRecord.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    await record.destroy(); // CASCADE deletes doctors too
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/tabel-records/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
