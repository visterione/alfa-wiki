const express = require('express');
const { MedCenter, UserMedCenter, CourseMedCenter } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { isValidBadgeColor } = require('../utils/chatBadgeIcons');
const userChatBadge = require('../services/userChatBadge');
const medCentersService = require('../services/medCenters');

const router = express.Router();

// Справочник клиник. Раньше маршрут требовал прав на роли или на пользователей —
// и именно поэтому каждый модуль, которому нужны были название, цвет или логотип
// клиники, заводил себе копию списка прямо в коде. Читать справочник может любой
// авторизованный: секретов в нём нет, а альтернатива — девять расходящихся копий.
// Права остались там, где им место: на изменение.
router.get('/', authenticate, async (req, res) => {
  try {
    // «Направители» и «АУП» — служебные группировки зарплатного модуля, а не
    // филиалы. По умолчанию их не отдаём: списки, которые читают этот маршрут,
    // предлагают выбрать медцентр человеку. Админка справочника запросит их явно.
    const medCenters = await medCentersService.list({
      includeVirtual: req.query.includeVirtual === '1',
      includeInactive: req.query.includeInactive === '1'
    });
    res.json(medCenters);
  } catch (error) {
    console.error('Get med centers error:', error);
    res.status(500).json({ error: 'Ошибка загрузки медицинских центров' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const medCenter = await medCentersService.byId(req.params.id);
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });
    res.json(medCenter);
  } catch (error) {
    console.error('Get med center error:', error);
    res.status(500).json({ error: 'Ошибка загрузки медцентра' });
  }
});

// Правка справочника требует своего права. Исключение — цвет и порядок: их с
// ver. 6.64 меняют в «Ролях и правах», где красят метки сотрудников, и отбирать
// это у тех, кто уже там работает, незачем.
function canEdit(req, body) {
  if (req.user.isAdmin || req.user.adminAccess?.medCenters) return true;
  const onlyBadgeFields = Object.keys(body).every(k => k === 'color' || k === 'sortOrder');
  return onlyBadgeFields && !!req.user.adminAccess?.roles;
}

const EDITABLE = [
  'name', 'code', 'displayName', 'description', 'organizationId', 'misClinicIds',
  'botOrgKey', 'importAliases', 'color', 'logoUrl', 'logoSquareUrl', 'address', 'city', 'lat', 'lng',
  'phones', 'email', 'site', 'workingHours', 'workingHoursNote',
  'chiefDoctorUserId', 'chiefDoctorName', 'isVirtual', 'isActive', 'sortOrder'
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Поля, которые пусты по смыслу, кладём как NULL: пустая строка в code сломала бы
// частичный уникальный индекс, а в organizationId — внешний ключ.
const NULLABLE_WHEN_BLANK = new Set([
  'code', 'displayName', 'description', 'organizationId', 'botOrgKey', 'color',
  'logoUrl', 'logoSquareUrl', 'address', 'city', 'email', 'site',
  'workingHoursNote', 'chiefDoctorUserId', 'chiefDoctorName'
]);

function pickFields(body) {
  const data = {};
  for (const key of EDITABLE) {
    if (body[key] === undefined) continue;
    let value = body[key];
    if (typeof value === 'string') value = value.trim();
    if (value === '' && NULLABLE_WHEN_BLANK.has(key)) value = null;
    data[key] = value;
  }

  if (data.misClinicIds !== undefined) {
    // Приводим к строкам и чистим: в форме это поле ввода через запятую, и оттуда
    // легко приезжают пробелы и хвостовая пустая позиция.
    data.misClinicIds = (Array.isArray(data.misClinicIds) ? data.misClinicIds : String(data.misClinicIds).split(','))
      .map(v => String(v).trim())
      .filter(Boolean);
  }
  if (data.importAliases !== undefined) {
    // В нижний регистр сразу: сопоставление при импорте регистронезависимое, и
    // хранить «Альфа Kids» и «альфа kids» как разные варианты смысла нет.
    const seen = new Set();
    data.importAliases = (Array.isArray(data.importAliases) ? data.importAliases : String(data.importAliases).split(','))
      .map(v => String(v).trim().toLowerCase())
      .filter(v => v && !seen.has(v) && seen.add(v));
  }
  for (const key of ['lat', 'lng', 'sortOrder']) {
    if (data[key] === undefined) continue;
    if (data[key] === null || data[key] === '') { data[key] = key === 'sortOrder' ? 100 : null; continue; }
    const num = Number(data[key]);
    data[key] = Number.isFinite(num) ? num : null;
  }
  return data;
}

function validate(data, { partial = false } = {}) {
  if (!partial || data.name !== undefined) {
    if (!data.name || !String(data.name).trim()) return 'Название медцентра обязательно';
  }
  if (data.color && !isValidBadgeColor(data.color)) return 'Цвет должен быть в формате #rrggbb';
  if (data.code && !/^[a-z0-9-]+$/.test(data.code)) {
    return 'Код — только латиница в нижнем регистре, цифры и дефис';
  }
  if (data.misClinicIds && new Set(data.misClinicIds).size !== data.misClinicIds.length) {
    return 'В списке id из МИС есть повторы';
  }
  if (data.phones !== undefined && data.phones !== null && !Array.isArray(data.phones)) {
    return 'Телефоны должны быть массивом';
  }
  if (data.workingHours !== undefined && data.workingHours !== null) {
    if (typeof data.workingHours !== 'object' || Array.isArray(data.workingHours)) {
      return 'График должен быть объектом по дням недели';
    }
    for (const [day, value] of Object.entries(data.workingHours)) {
      if (!DAYS.includes(day)) return `Неизвестный день недели: ${day}`;
      if (value === null) continue; // выходной
      if (!value || !TIME_RE.test(value.from || '') || !TIME_RE.test(value.to || '')) {
        return `Время в ${day} должно быть в формате ЧЧ:ММ`;
      }
    }
  }
  return null;
}

// Триггер в базе не даёт отдать один clinic_id двум клиникам. Ловим его здесь,
// чтобы человек увидел причину, а не «Ошибка сохранения».
function isMisIdConflict(error) {
  const message = error?.parent?.message || error?.message || '';
  return message.includes('уже привязан к другому медцентру') || message.includes('misClinicIds есть повторы');
}

router.post('/', authenticate, requireAdminAccess('medCenters'), async (req, res) => {
  try {
    const data = pickFields(req.body);
    const error = validate(data);
    if (error) return res.status(400).json({ error });

    const medCenter = await MedCenter.create(data);
    medCentersService.invalidate();
    res.status(201).json(medCenter);
  } catch (error) {
    if (isMisIdConflict(error)) return res.status(409).json({ error: error.parent?.message || error.message });
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Медцентр с таким названием или кодом уже есть' });
    }
    console.error('Create med center error:', error);
    res.status(500).json({ error: 'Ошибка создания медцентра' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    if (!canEdit(req, req.body)) {
      return res.status(403).json({ error: 'Access denied to admin section: medCenters' });
    }

    const medCenter = await MedCenter.findByPk(req.params.id);
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });

    const data = pickFields(req.body);
    const error = validate(data, { partial: true });
    if (error) return res.status(400).json({ error });

    // Цвет и порядок решают, какой меткой красить сотрудника, — при их изменении
    // метки надо пересчитать. Остальные поля на метку не влияют.
    const badgeChanged = (data.color !== undefined && data.color !== medCenter.color) ||
                         (data.sortOrder !== undefined && data.sortOrder !== medCenter.sortOrder);

    await medCenter.update(data);

    // Иначе следующие пять минут справочник отдавал бы старые значения.
    medCentersService.invalidate();
    if (badgeChanged) await userChatBadge.recomputeForMedCenter(medCenter.id);

    res.json(medCenter);
  } catch (error) {
    if (isMisIdConflict(error)) return res.status(409).json({ error: error.parent?.message || error.message });
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Медцентр с таким названием или кодом уже есть' });
    }
    console.error('Update med center error:', error);
    res.status(500).json({ error: 'Ошибка обновления медцентра' });
  }
});

// Удаление разрешено, только пока на медцентр никто не сослался. Закрытый филиал
// гасят флагом isActive: на него смотрят зарплата, аккредитации и история, и
// вычистить эти ссылки нельзя — данные за прошлые периоды должны остаться читаемыми.
router.delete('/:id', authenticate, requireAdminAccess('medCenters'), async (req, res) => {
  try {
    const medCenter = await MedCenter.findByPk(req.params.id);
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });

    const [users, courses] = await Promise.all([
      UserMedCenter.count({ where: { medCenterId: medCenter.id } }),
      CourseMedCenter.count({ where: { medCenterId: medCenter.id } })
    ]);
    const blockers = [
      users   ? `сотрудников: ${users}` : null,
      courses ? `курсов: ${courses}`    : null
    ].filter(Boolean);

    if (blockers.length) {
      return res.status(409).json({
        error: `Медцентр используется (${blockers.join(', ')}). Отключите его флагом «Активен» вместо удаления`
      });
    }

    await medCenter.destroy();
    medCentersService.invalidate();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete med center error:', error);
    res.status(500).json({ error: 'Ошибка удаления медцентра' });
  }
});

module.exports = router;
