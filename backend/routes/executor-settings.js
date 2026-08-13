const express = require('express');
const { ExecutorSettings, RbScheduleCategory, RbResetBackup, RbUserPermission, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity, diffExecSettings } = require('../services/rbLogger');
const { AUP_CLINIC_ID, canSeeAup, settingsHasAup, stripAupSettings, mergeAupBack } = require('../services/aupFilter');
const { buildResetPreview, resetSettings } = require('../services/executorSettingsReset');
const {
  snapshotRecords, stampWritten, createBackup, describeBackup, restoreBackup, listBackups,
} = require('../services/executorSettingsBackup');

const router = express.Router();

// GET /api/executor-settings?misUserId=xxx
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId } = req.query;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });
    const record = await ExecutorSettings.findOne({ where: { misUserId } });
    let settings = record ? record.settings : {};
    // АУП скрыт от всех без флага (даже от админов).
    if (!canSeeAup(req.user)) settings = stripAupSettings(settings);
    res.json(settings || {});
  } catch (err) {
    console.error('Get executor settings error:', err);
    res.status(500).json({ error: 'Ошибка получения настроек' });
  }
});

// GET /api/executor-settings/disabled-clinics — returns { [misUserId]: string[] } for all doctors
router.get('/disabled-clinics', authenticate, async (req, res) => {
  try {
    const all = await ExecutorSettings.findAll({ attributes: ['misUserId', 'settings'] });
    const result = {};
    const seeAup = canSeeAup(req.user);
    all.forEach(record => {
      let dc = record.settings?.disabledClinics;
      if (Array.isArray(dc) && dc.length > 0) {
        if (!seeAup) dc = dc.filter(id => String(id) !== AUP_CLINIC_ID);
        if (dc.length > 0) result[record.misUserId] = dc.map(String);
      }
    });
    res.json(result);
  } catch (err) {
    console.error('Get disabled clinics error:', err);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// GET /api/executor-settings/schedule-fill — returns { [misUserId]: 1|2 } for all doctors
// Ручной статус заполнения расписания по сотруднику (0 опускаем).
router.get('/schedule-fill', authenticate, async (req, res) => {
  try {
    const all = await ExecutorSettings.findAll({ attributes: ['misUserId', 'settings'] });
    const result = {};
    all.forEach(record => {
      const s = record.settings?.scheduleFillStatus;
      if (s === 1 || s === 2) result[record.misUserId] = s;
    });
    res.json(result);
  } catch (err) {
    console.error('Get schedule-fill error:', err);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// GET /api/executor-settings/aup-members — { misUserId, doctorName }[] участников клиники АУП.
// Только для пользователей с флагом; остальным — пустой список (даже админам).
router.get('/aup-members', authenticate, async (req, res) => {
  try {
    if (!canSeeAup(req.user)) return res.json([]);
    const all = await ExecutorSettings.findAll({ attributes: ['misUserId', 'doctorName', 'settings'] });
    const members = all
      .filter(r => settingsHasAup(r.settings))
      .map(r => ({ misUserId: String(r.misUserId), doctorName: r.doctorName || '' }));
    res.json(members);
  } catch (err) {
    console.error('Get aup-members error:', err);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// POST /api/executor-settings/schedule-fill — { misUserId, doctorName, status }
// Точечно обновляет только scheduleFillStatus, не затирая остальные настройки.
router.post('/schedule-fill', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, status } = req.body;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });
    const st = [0, 1, 2].includes(status) ? status : 0;

    const existing = await ExecutorSettings.findOne({ where: { misUserId } });
    const settings = { ...(existing ? existing.settings : {}), scheduleFillStatus: st };

    await ExecutorSettings.upsert({
      misUserId,
      doctorName: doctorName || (existing ? existing.doctorName : '') || '',
      settings,
      updatedBy: req.user.id,
    }, { conflictFields: ['misUserId'] });

    res.json({ ok: true });
  } catch (err) {
    console.error('Save schedule-fill error:', err);
    res.status(500).json({ error: 'Ошибка сохранения' });
  }
});

// POST /api/executor-settings
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, settings, clinicNames } = req.body;
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });

    const existing = await ExecutorSettings.findOne({ where: { misUserId } });
    const oldSettings = existing ? existing.settings : null;

    // Пользователь без флага не получал клинику АУП в GET — значит в его payload её нет.
    // Подмешиваем сохранённый блок АУП обратно, чтобы сохранение не затёрло секретные данные.
    let incoming = settings || {};
    if (!canSeeAup(req.user)) incoming = mergeAupBack(incoming, oldSettings);

    await ExecutorSettings.upsert({
      misUserId,
      doctorName: doctorName || '',
      settings: incoming,
      updatedBy: req.user.id
    }, { conflictFields: ['misUserId'] });

    const categories = await RbScheduleCategory.findAll({ attributes: ['id', 'name'] });
    const roleNames = Object.fromEntries(categories.map(c => [String(c.id), c.name]));

    // Изменения по клинике АУП не попадают в общий журнал (он виден админам без флага).
    const rawDiff = oldSettings ? diffExecSettings(oldSettings, incoming, clinicNames || {}, roleNames) : null;
    const diff = rawDiff ? rawDiff.filter(c => String(c.clinicId) !== AUP_CLINIC_ID) : null;
    const hasDiff = diff && diff.length > 0;

    await logRbActivity({
      userId:     req.user.id,
      tab:        'executors',
      action:     existing ? 'update' : 'create',
      entityType: 'executor_settings',
      entityId:   misUserId,
      doctorName: doctorName || '',
      misUserId,
      summary:    existing
        ? `Изменены настройки сотрудника: ${doctorName || misUserId}${hasDiff ? ` (${diff.length} изм.)` : ''}`
        : `Добавлен сотрудник: ${doctorName || misUserId}`,
      diff: hasDiff ? { changes: diff } : null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Save executor settings error:', err);
    res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

// Сброс и откат переписывают зарплатные данные чужих сотрудников, а раньше кнопку
// прятал только клиент (isStepReadOnly в интерфейсе). Для необратимых операций
// этого мало: сервер требует то же право «Сотрудники: редактирование», по которому
// кнопка вообще показывается.
async function requireExecutorsEdit(req, res, next) {
  try {
    if (req.user.isAdmin) return next();
    const perm = await RbUserPermission.findOne({ where: { userId: req.user.id } });
    if (perm && perm.tab1 === 'edit') return next();
    return res.status(403).json({ error: 'Нет прав на изменение данных сотрудников' });
  } catch (err) {
    console.error('Executors edit permission check error:', err);
    return res.status(500).json({ error: 'Ошибка проверки прав' });
  }
}

// Снимок содержит settings целиком, поэтому в нём есть и блок клиники АУП. Сам
// список наружу отдаёт только счётчики, но показывать пользователю без флага сам
// факт сброса по АУП всё равно нельзя — из него читается состав клиники.
function backupVisible(backup, user) {
  if (canSeeAup(user)) return true;
  return !(backup.clinicIds || []).map(String).includes(AUP_CLINIC_ID);
}

function selectedResetClinics(req) {
  const raw = req.method === 'GET' ? String(req.query.clinicIds || '').split(',') : req.body?.clinicIds;
  if (!Array.isArray(raw)) return [];
  const clinicIds = [...new Set(raw.map(String).map(id => id.trim()).filter(Boolean))];
  return canSeeAup(req.user) ? clinicIds : clinicIds.filter(id => id !== AUP_CLINIC_ID);
}

// GET /api/executor-settings/reset-preview?clinicIds=2,4
router.get('/reset-preview', authenticate, requireExecutorsEdit, async (req, res) => {
  try {
    const clinicIds = selectedResetClinics(req);
    if (!clinicIds.length) return res.status(400).json({ error: 'Выберите хотя бы одну клинику' });
    const all = await ExecutorSettings.findAll({ attributes: ['misUserId', 'doctorName', 'settings'] });
    res.json(buildResetPreview(all, clinicIds));
  } catch (err) {
    console.error('Reset preview executor settings error:', err);
    res.status(500).json({ error: 'Ошибка предварительного просмотра сброса' });
  }
});

// POST /api/executor-settings/reset-all — body: { clinicIds: string[] }
router.post('/reset-all', authenticate, requireExecutorsEdit, async (req, res) => {
  try {
    const clinicIds = selectedResetClinics(req);
    if (!clinicIds.length) return res.status(400).json({ error: 'Выберите хотя бы одну клинику' });

    // Снимок и сама запись — в одной транзакции. Раньше строки переписывались
    // параллельным Promise.all без транзакции, и сбой на середине оставлял часть
    // сотрудников сброшенной, часть нет. Теперь либо сброс с точкой возврата
    // целиком, либо ничего.
    const { preview, backupId } = await sequelize.transaction(async (transaction) => {
      const all = await ExecutorSettings.findAll({ transaction });
      const preview = buildResetPreview(all, clinicIds);
      const selected = new Set(clinicIds);
      const affectedIds = new Set(preview.employees.map(employee => employee.misUserId));
      const affected = all.filter(record => affectedIds.has(String(record.misUserId)));

      const payload = snapshotRecords(affected);

      for (const record of affected) {
        await record.update({ settings: resetSettings(record.settings, selected) }, { transaction });
      }

      const backup = affected.length
        ? await createBackup({
            kind:          'reset',
            userId:        req.user.id,
            clinicIds,
            employeeCount: preview.employeeCount,
            changeCount:   preview.changeCount,
            payload:       stampWritten(payload, affected),
          }, transaction)
        : null;

      return { preview, backupId: backup ? backup.id : null };
    });

    await logRbActivity({
      userId:  req.user.id,
      tab:     'executors',
      action:  'reset',
      entityType: 'executor_settings_all',
      summary: `Сброс незафиксированных данных по клиникам ${clinicIds.join(', ')} (${preview.employeeCount} сотр.)`,
      diff: { clinicIds, employeeCount: preview.employeeCount, changeCount: preview.changeCount, backupId },
    });

    res.json({ ok: true, count: preview.employeeCount, changeCount: preview.changeCount, backupId });
  } catch (err) {
    console.error('Reset-all executor settings error:', err);
    res.status(500).json({ error: 'Ошибка сброса настроек' });
  }
});

// GET /api/executor-settings/reset-backups — пять последних точек возврата
router.get('/reset-backups', authenticate, requireExecutorsEdit, async (req, res) => {
  try {
    const backups = await listBackups();
    res.json(backups.filter(backup => backupVisible(backup, req.user)));
  } catch (err) {
    console.error('List reset backups error:', err);
    res.status(500).json({ error: 'Ошибка получения списка резервных копий' });
  }
});

// GET /api/executor-settings/reset-backups/:id — состав снимка без самих данных
router.get('/reset-backups/:id', authenticate, requireExecutorsEdit, async (req, res) => {
  try {
    const backup = await RbResetBackup.findByPk(req.params.id);
    if (!backup || !backupVisible(backup, req.user)) return res.status(404).json({ error: 'Резервная копия не найдена' });
    res.json(await describeBackup(backup));
  } catch (err) {
    console.error('Describe reset backup error:', err);
    res.status(500).json({ error: 'Ошибка получения резервной копии' });
  }
});

// POST /api/executor-settings/reset-backups/:id/restore
router.post('/reset-backups/:id/restore', authenticate, requireExecutorsEdit, async (req, res) => {
  try {
    const backup = await RbResetBackup.findByPk(req.params.id);
    if (!backup || !backupVisible(backup, req.user)) return res.status(404).json({ error: 'Резервная копия не найдена' });

    const result = await restoreBackup({ backup, userId: req.user.id });

    await logRbActivity({
      userId:     req.user.id,
      tab:        'executors',
      action:     'restore',
      entityType: 'executor_settings_all',
      entityId:   backup.id,
      summary:    `Восстановление данных из копии от ${new Date(backup.createdAt).toLocaleString('ru-RU')} (${result.restored} сотр.)`,
      diff: {
        backupId:     backup.id,
        clinicIds:    backup.clinicIds || [],
        restored:     result.restored,
        missing:      result.missing,
        changedSince: result.changedSince,
      },
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Restore reset backup error:', err);
    res.status(500).json({ error: 'Ошибка восстановления данных' });
  }
});

module.exports = router;
