const express = require('express');
const router  = express.Router();
const { DoctorSchedule, MisScheduleCategoryMap, RbScheduleCategory, User, ExecutorSettings } = require('../models');
const { authenticate } = require('../middleware/auth');
const { importForUser } = require('../services/misScheduleImport');
const { logRbActivity } = require('../services/rbLogger');

async function resolveDoctorName(misUserId, providedName) {
  if (providedName) return providedName;
  if (!misUserId) return null;
  const s = await ExecutorSettings.findOne({ where: { misUserId }, attributes: ['doctorName'] });
  return s?.doctorName || null;
}

// ── Half-period lock (server-side enforcement) ───────────────────────────────
// Mirrors the frontend rule (TabelTable / StepSchedule): a date is frozen for
// non-admins once its half-month passes the cutoff — the 1st half closes on the
// 18th of its own month, the 2nd half on the 3rd of the next month. The frontend
// clamps ranges so a legitimate request never starts on a frozen date; this guard
// rejects direct API calls that try to write a schedule into a frozen half.
function parseYMD(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isDateFrozen(dateStr) {
  const d = parseYMD(dateStr);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const halfSize = Math.floor(new Date(y, m, 0).getDate() / 2);
  if (day <= halfSize) return today >= new Date(y, m - 1, 18);
  return today >= new Date(y, m, 3);
}

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
    const { misUserId, clinicId, dateFrom, dateTo, pattern, timeFrom, timeTo, exceptions, categoryId, cabinetId, roleTitle, doctorName } = req.body;
    if (!misUserId || !clinicId || !dateFrom || !dateTo || !pattern) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Non-admins may not start a schedule inside a frozen half-period.
    if (!req.user?.isAdmin && isDateFrozen(dateFrom)) {
      return res.status(403).json({ error: 'Этот период закрыт для редактирования' });
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
      roleTitle:  roleTitle  || null,
      createdBy:  req.user?.id || null,
    });

    const resolvedName = await resolveDoctorName(misUserId, doctorName);
    await logRbActivity({
      userId:     req.user?.id,
      tab:        'schedule',
      action:     'create',
      entityType: 'schedule',
      entityId:   row.id,
      misUserId,
      doctorName: resolvedName,
      clinicId,
      summary:    `Создано расписание: ${resolvedName || misUserId}, ${dateFrom} — ${dateTo}`,
      diff: {
        after: { dateFrom, dateTo, pattern, timeFrom: timeFrom || '09:00', timeTo: timeTo || '18:00', roleTitle, clinicId }
      },
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

    const before = {
      dateFrom: row.dateFrom, dateTo: row.dateTo, pattern: row.pattern,
      timeFrom: row.timeFrom, timeTo: row.timeTo, roleTitle: row.roleTitle,
      categoryId: row.categoryId, cabinetId: row.cabinetId, clinicId: row.clinicId,
    };
    const oldExceptions = Array.isArray(row.exceptions) ? [...row.exceptions] : [];

    const { clinicId, dateFrom, dateTo, pattern, timeFrom, timeTo, exceptions, categoryId, cabinetId, roleTitle, doctorName } = req.body;
    // Non-admins may not move a schedule's start into a frozen half-period.
    // Only enforced when dateFrom actually changes — shrinking/splitting an entry
    // that legitimately predates the lock keeps its original (possibly frozen) start.
    if (!req.user?.isAdmin && dateFrom !== undefined && dateFrom !== row.dateFrom && isDateFrozen(dateFrom)) {
      return res.status(403).json({ error: 'Этот период закрыт для редактирования' });
    }
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
      ...(roleTitle   !== undefined && { roleTitle:  roleTitle  || null }),
    });
    await row.reload();

    const after = {
      dateFrom: row.dateFrom, dateTo: row.dateTo, pattern: row.pattern,
      timeFrom: row.timeFrom, timeTo: row.timeTo, roleTitle: row.roleTitle,
      categoryId: row.categoryId, cabinetId: row.cabinetId, clinicId: row.clinicId,
    };

    // Build diff: detect exception (day cancel/restore) vs schedule field changes
    let diff;
    let summary;
    const resolvedName = await resolveDoctorName(row.misUserId, doctorName);
    if (exceptions !== undefined) {
      const newExceptions = Array.isArray(row.exceptions) ? row.exceptions : [];
      const oldExMap = new Map(oldExceptions.map(e => [e.date, e.code || 'ОТ']));
      const newExMap = new Map(newExceptions.map(e => [e.date, e.code || 'ОТ']));
      const exChanges = [];
      for (const [date, code] of newExMap) {
        if (!oldExMap.has(date)) exChanges.push({ field: 'exception_added', label: 'Отменён день', before: null, after: `${date} (${code})` });
      }
      for (const [date, code] of oldExMap) {
        if (!newExMap.has(date)) exChanges.push({ field: 'exception_removed', label: 'Восстановлен день', before: `${date} (${code})`, after: null });
      }
      if (exChanges.length > 0) {
        diff = { changes: exChanges };
        const addedDates  = exChanges.filter(c => c.field === 'exception_added').map(c => c.after);
        const removedDates = exChanges.filter(c => c.field === 'exception_removed').map(c => c.before);
        if (addedDates.length > 0 && removedDates.length === 0) {
          summary = `Отменён день в расписании: ${resolvedName || row.misUserId}, ${addedDates.join(', ')}`;
        } else if (removedDates.length > 0 && addedDates.length === 0) {
          summary = `Восстановлен день в расписании: ${resolvedName || row.misUserId}, ${removedDates.join(', ')}`;
        } else {
          summary = `Изменены дни расписания: ${resolvedName || row.misUserId}`;
        }
      } else {
        diff = { before, after };
        summary = `Изменено расписание: ${resolvedName || row.misUserId}, ${row.dateFrom} — ${row.dateTo}`;
      }
    } else {
      diff = { before, after };
      summary = `Изменено расписание: ${resolvedName || row.misUserId}, ${row.dateFrom} — ${row.dateTo}`;
    }

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'schedule',
      action:     'update',
      entityType: 'schedule',
      entityId:   row.id,
      misUserId:  row.misUserId,
      doctorName: resolvedName,
      clinicId:   row.clinicId,
      summary,
      diff,
    });

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

    const resolvedName = await resolveDoctorName(row.misUserId, null);
    await logRbActivity({
      userId:     req.user?.id,
      tab:        'schedule',
      action:     'delete',
      entityType: 'schedule',
      entityId:   row.id,
      misUserId:  row.misUserId,
      doctorName: resolvedName,
      clinicId:   row.clinicId,
      summary:    `Удалено расписание: ${resolvedName || row.misUserId}, ${row.dateFrom} — ${row.dateTo}`,
      diff: {
        before: {
          dateFrom: row.dateFrom, dateTo: row.dateTo, pattern: row.pattern,
          timeFrom: row.timeFrom, timeTo: row.timeTo, clinicId: row.clinicId,
        }
      },
    });

    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE doctor-schedules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/doctor-schedules/import-from-mis
router.post('/import-from-mis', authenticate, async (req, res) => {
  try {
    const { misUserId, month, doctorName } = req.body;
    if (!misUserId) return res.status(400).json({ error: 'misUserId required' });

    const now      = new Date();
    const useMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const result = await importForUser(misUserId, useMonth);

    await logRbActivity({
      userId:     req.user?.id,
      tab:        'schedule',
      action:     'import',
      entityType: 'schedule',
      misUserId,
      doctorName: doctorName || null,
      summary:    `Импорт расписания из МИС: ${doctorName || misUserId}, месяц ${useMonth}`,
      diff:       result ? { after: result } : null,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST import-from-mis error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// GET /api/doctor-schedules/mis-category-map
router.get('/mis-category-map', authenticate, async (req, res) => {
  try {
    const rows = await MisScheduleCategoryMap.findAll({
      include: [{ model: RbScheduleCategory, as: 'rbCategory', attributes: ['id', 'name', 'color'] }],
      order:   [['misCategoryId', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    console.error('GET mis-category-map error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/doctor-schedules/mis-category-map/for-rb-category/:rbCategoryId
router.put('/mis-category-map/for-rb-category/:rbCategoryId', authenticate, async (req, res) => {
  try {
    const { misCategoryId } = req.body;
    const rbCategoryId = req.params.rbCategoryId;

    await MisScheduleCategoryMap.destroy({ where: { rbCategoryId } });

    if (misCategoryId != null && misCategoryId !== '') {
      await MisScheduleCategoryMap.upsert({
        misCategoryId: parseInt(misCategoryId, 10),
        rbCategoryId,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT mis-category-map/for-rb-category error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/doctor-schedules/mis-import/for-user/:misUserId
router.delete('/mis-import/for-user/:misUserId', authenticate, async (req, res) => {
  try {
    const count = await DoctorSchedule.destroy({
      where: { misUserId: req.params.misUserId, source: 'mis_import' },
    });
    res.json({ ok: true, deleted: count });
  } catch (err) {
    console.error('DELETE mis-import/for-user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/doctor-schedules/mis-category-map/:misId
router.put('/mis-category-map/:misId', authenticate, async (req, res) => {
  try {
    const { rbCategoryId } = req.body;
    const row = await MisScheduleCategoryMap.findOne({
      where: { misCategoryId: parseInt(req.params.misId, 10) },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.update({ rbCategoryId: rbCategoryId || null });
    res.json(row);
  } catch (err) {
    console.error('PUT mis-category-map error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
