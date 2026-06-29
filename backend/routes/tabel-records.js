const express = require('express');
const router  = express.Router();
const { TabelRecord, TabelRecordDoctor } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity } = require('../services/rbLogger');

// GET /api/tabel-records
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

// GET /api/tabel-records/by-doctor?misUserId=X
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

// GET /api/tabel-records/:id
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

// POST /api/tabel-records
router.post('/', authenticate, async (req, res) => {
  try {
    const { month, year, orgName, subdivision, docNumber, userName, tabelType, doctors = [] } = req.body;
    if (!month || !year) return res.status(400).json({ error: 'month and year required' });

    const record = await TabelRecord.create({
      month,
      year,
      orgName:     orgName     || null,
      subdivision: subdivision || null,
      docNumber:   docNumber   || null,
      userName:    userName    || null,
      tabelType:   tabelType   || 'standard',
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

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'worktime',
      action:     'save',
      entityType: 'tabel',
      entityId:   record.id,
      summary:    `Сохранён табель: ${orgName || ''} ${month}/${year}, врачей: ${doctors.length}`,
      diff: {
        after: { month, year, orgName, subdivision, docNumber, doctorCount: doctors.length }
      },
    });

    res.status(201).json(full);
  } catch (err) {
    console.error('POST /api/tabel-records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tabel-records/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { doctors = [] } = req.body;
    const record = await TabelRecord.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });

    const oldDoctors = await TabelRecordDoctor.findAll({
      where: { tabelRecordId: record.id },
      attributes: ['misUserId', 'doctorName'],
    });
    const oldIdSet = new Set(oldDoctors.map(d => d.misUserId));
    const newIdSet = new Set(doctors.map(d => d.misUserId));

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

    const addedDoctors   = doctors.filter(d => !oldIdSet.has(d.misUserId));
    const removedDoctors = oldDoctors.filter(d => !newIdSet.has(d.misUserId));
    const diffChanges = [];
    for (const d of addedDoctors)   diffChanges.push({ field: 'doctor_added',   label: 'Добавлен врач',   before: null, after: d.doctorName || d.misUserId });
    for (const d of removedDoctors) diffChanges.push({ field: 'doctor_removed', label: 'Исключён врач',   before: d.doctorName || d.misUserId, after: null });

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'archive',
      action:     'update',
      entityType: 'tabel',
      entityId:   record.id,
      summary:    `Изменён табель из архива: ${record.orgName || ''} ${record.month}/${record.year}, врачей: ${oldDoctors.length} → ${doctors.length}`,
      diff: diffChanges.length > 0
        ? { changes: diffChanges }
        : { before: { doctorCount: oldDoctors.length }, after: { doctorCount: doctors.length } },
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
    const record = await TabelRecord.findByPk(req.params.id, {
      include: [{ model: TabelRecordDoctor, as: 'doctors', attributes: ['id'] }],
    });
    if (!record) return res.status(404).json({ error: 'Not found' });

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'archive',
      action:     'delete',
      entityType: 'tabel',
      entityId:   record.id,
      summary:    `Удалён табель из архива: ${record.orgName || ''} ${record.month}/${record.year}`,
      diff: {
        before: {
          month: record.month, year: record.year,
          orgName: record.orgName, subdivision: record.subdivision,
          doctorCount: record.doctors?.length || 0,
        }
      },
    });

    await record.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/tabel-records/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
