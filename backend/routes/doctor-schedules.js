const express = require('express');
const router  = express.Router();
const { DoctorSchedule, MisScheduleCategoryMap, RbScheduleCategory, User, ExecutorSettings, RbUserPermission } = require('../models');
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

// Whether this request may write into a frozen half-period. Admins always can;
// other users only with the per-user `bypassPeriodLock` permission flag.
async function canBypassLock(req) {
  if (req.user?.isAdmin) return true;
  if (!req.user?.id) return false;
  const perm = await RbUserPermission.findOne({
    where: { userId: req.user.id },
    attributes: ['bypassPeriodLock'],
  });
  return !!perm?.bypassPeriodLock;
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
    // Non-admins may not start a schedule inside a frozen half-period,
    // unless granted the bypassPeriodLock permission.
    if (isDateFrozen(dateFrom) && !(await canBypassLock(req))) {
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
    if (dateFrom !== undefined && dateFrom !== row.dateFrom && isDateFrozen(dateFrom) && !(await canBypassLock(req))) {
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
      // Exception kinds: cancel { date, code } | override { date, timeFrom, timeTo }
      const norm = (arr) => new Map((arr || []).map(e => {
        if (typeof e === 'string') return [e, { kind: 'cancel', code: 'ОТ' }];
        if (e.timeFrom && e.timeTo && !e.code) return [e.date, { kind: 'override', timeFrom: e.timeFrom, timeTo: e.timeTo }];
        return [e.date, { kind: 'cancel', code: e.code || 'ОТ' }];
      }));
      const desc = (v) => v.kind === 'override' ? `${v.timeFrom}–${v.timeTo}` : v.code;
      const oldExMap = norm(oldExceptions);
      const newExMap = norm(newExceptions);
      const exChanges = [];
      for (const [date, v] of newExMap) {
        const ov = oldExMap.get(date);
        if (!ov) {
          exChanges.push({ field: 'exception_added', label: v.kind === 'override' ? 'Изменены часы дня' : 'Отменён день', before: null, after: `${date} (${desc(v)})` });
        } else if (ov.kind !== v.kind || desc(ov) !== desc(v)) {
          exChanges.push({ field: 'exception_changed', label: 'Изменён день', before: `${date} (${desc(ov)})`, after: `${date} (${desc(v)})` });
        }
      }
      for (const [date, v] of oldExMap) {
        if (!newExMap.has(date)) exChanges.push({ field: 'exception_removed', label: v.kind === 'override' ? 'Сброшены часы дня' : 'Восстановлен день', before: `${date} (${desc(v)})`, after: null });
      }
      if (exChanges.length > 0) {
        diff = { changes: exChanges };
        const onlyKind = exChanges.every(c => c.field === exChanges[0].field) ? exChanges[0] : null;
        if (onlyKind) {
          const dates = exChanges.map(c => c.after || c.before).join(', ');
          summary = `${onlyKind.label} в расписании: ${resolvedName || row.misUserId}, ${dates}`;
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

    // Non-admins may not delete a chain that reaches into a frozen half-period.
    // Frozen dates are a contiguous prefix, so a frozen start ⇒ the chain overlaps
    // the lock. The frontend instead shrinks such entries (PUT) to keep frozen days.
    if (isDateFrozen(row.dateFrom) && !(await canBypassLock(req))) {
      return res.status(403).json({ error: 'Этот период закрыт для редактирования' });
    }

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
