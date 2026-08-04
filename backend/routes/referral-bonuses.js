const express = require('express');
const { Op, QueryTypes } = require('sequelize');
const { sequelize, ReferralBonus, RbUserPermission, User, Setting } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logRbActivity } = require('../services/rbLogger');
const { parsePagination } = require('../utils/pagination');
const {
  normalizeRequestedCodes,
  normalizeServiceCode,
  bonusesByServiceCode,
} = require('../utils/referralBonusLookup');

const router = express.Router();

// === Suggests ===
const RB_SUGGESTS_KEY = 'rb_exec_suggests';

router.get('/suggests', authenticate, async (req, res) => {
  try {
    const setting = await Setting.findByPk(RB_SUGGESTS_KEY);
    if (!setting) return res.json({});
    const val = setting.value;
    res.json(typeof val === 'string' ? JSON.parse(val) : val);
  } catch (err) {
    console.error('Get rb suggests error:', err);
    res.status(500).json({ error: 'Ошибка получения подсказок' });
  }
});

router.put('/suggests', authenticate, async (req, res) => {
  try {
    const value = JSON.stringify(req.body);
    let setting = await Setting.findByPk(RB_SUGGESTS_KEY);
    if (setting) {
      await setting.update({ value });
    } else {
      await Setting.create({ key: RB_SUGGESTS_KEY, value, description: 'ReferralBonuses executor suggests' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Save rb suggests error:', err);
    res.status(500).json({ error: 'Ошибка сохранения подсказок' });
  }
});

// Получить все бонусы для врача
router.get('/', authenticate, async (req, res) => {
  try {
    const { misUserId, clinicId } = req.query;
    if (!misUserId) {
      return res.status(400).json({ error: 'misUserId обязателен' });
    }

    const where = { misUserId };
    if (clinicId !== undefined) where.clinicId = String(clinicId).slice(0, 50);

    const compactAttributes = [
      'id', 'misUserId', 'serviceCode', 'serviceName',
      'bonusPercent', 'bonusRub', 'clinicId'
    ];

    // Старые клиенты и расчёт отчётов по-прежнему получают массив.
    // Новый UI явно передаёт limit/offset и получает пагинированный ответ.
    const paginated = req.query.limit !== undefined || req.query.offset !== undefined;
    if (paginated) {
      const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 500 });
      const [{ count, rows }, totalAll] = await Promise.all([
        ReferralBonus.findAndCountAll({
          where,
          attributes: compactAttributes,
          order: [['createdAt', 'ASC']],
          limit,
          offset,
        }),
        ReferralBonus.count({ where: { misUserId } }),
      ]);

      return res.json({ count, totalAll, rows });
    }

    const bonuses = await ReferralBonus.findAll({
      where,
      ...(req.query.compact === 'true' ? { attributes: compactAttributes } : {}),
      order: [['createdAt', 'ASC']]
    });
    res.json(bonuses);
  } catch (err) {
    console.error('Get referral bonuses error:', err);
    res.status(500).json({ error: 'Ошибка получения бонусов' });
  }
});

// Получить все бонусы по услуге
router.get('/by-service', authenticate, async (req, res) => {
  try {
    const { serviceCode } = req.query;
    if (!serviceCode) {
      return res.status(400).json({ error: 'serviceCode обязателен' });
    }
    const bonuses = await ReferralBonus.findAll({
      where: { serviceCode },
      order: [['doctorName', 'ASC']]
    });
    const map = {};
    bonuses.forEach(b => {
      map[b.misUserId] = { id: b.id, bonusPercent: b.bonusPercent, bonusRub: b.bonusRub };
    });
    res.json(map);
  } catch (err) {
    console.error('Get bonuses by-service error:', err);
    res.status(500).json({ error: 'Ошибка получения бонусов' });
  }
});

// Пакетный аналог /by-service для расчёта отчётов.
// Вместо сотен HTTP-запросов UI делает один запрос на пачку кодов.
router.post('/by-services', authenticate, async (req, res) => {
  try {
    if (!Array.isArray(req.body?.serviceCodes)) {
      return res.status(400).json({ error: 'serviceCodes должен быть массивом' });
    }
    const serviceCodes = normalizeRequestedCodes(req.body.serviceCodes);
    const misUserIds = normalizeRequestedCodes(req.body?.misUserIds, 100);

    if (serviceCodes.length > 500) {
      return res.status(400).json({ error: 'Не более 500 кодов услуг за запрос' });
    }
    if (misUserIds.length > 500) {
      return res.status(400).json({ error: 'Не более 500 врачей за запрос' });
    }
    if (!serviceCodes.length) return res.json({});

    const bonuses = await ReferralBonus.findAll({
      where: {
        serviceCode: { [Op.in]: serviceCodes },
        ...(misUserIds.length ? { misUserId: { [Op.in]: misUserIds } } : {}),
      },
      attributes: ['id', 'misUserId', 'serviceCode', 'bonusPercent', 'bonusRub'],
      raw: true,
    });

    res.json(bonusesByServiceCode(serviceCodes, bonuses));
  } catch (err) {
    console.error('Get bonuses by-services error:', err);
    res.status(500).json({ error: 'Ошибка получения бонусов по услугам' });
  }
});

// Возвращает только те правила врача, которые встретились в отчёте.
// Фильтрация после выборки по врачу сохраняет прежнюю нормализацию кодов.
router.post('/by-doctor-services', authenticate, async (req, res) => {
  try {
    const misUserId = String(req.body?.misUserId || '').trim();
    if (!misUserId) return res.status(400).json({ error: 'misUserId обязателен' });
    if (!Array.isArray(req.body?.serviceCodes)) {
      return res.status(400).json({ error: 'serviceCodes должен быть массивом' });
    }
    const serviceCodes = normalizeRequestedCodes(req.body.serviceCodes);
    if (serviceCodes.length > 5000) {
      return res.status(400).json({ error: 'Не более 5000 кодов услуг за запрос' });
    }
    if (!serviceCodes.length) return res.json([]);

    const normalizedCodes = [...new Set(serviceCodes.map(normalizeServiceCode))];
    const bonuses = await sequelize.query(`
      SELECT
        id,
        "misUserId",
        "serviceCode",
        "serviceName",
        "bonusPercent",
        "bonusRub",
        "clinicId"
      FROM referral_bonuses
      WHERE "misUserId" = $misUserId
        AND lower(regexp_replace(btrim("serviceCode"), '\\s+', ' ', 'g')) = ANY($serviceCodes::text[])
    `, {
      bind: { misUserId, serviceCodes: normalizedCodes },
      type: QueryTypes.SELECT,
    });

    res.json(bonuses);
  } catch (err) {
    console.error('Get bonuses by-doctor-services error:', err);
    res.status(500).json({ error: 'Ошибка получения бонусов врача' });
  }
});

// Сохранить/обновить бонус
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, serviceCode, serviceName, bonusPercent, bonusRub } = req.body;
    const clinicId = req.body.clinicId != null ? String(req.body.clinicId).trim().substring(0, 50) : '';

    if (!misUserId || !serviceCode || !serviceName) {
      return res.status(400).json({ error: 'misUserId, serviceCode, serviceName обязательны' });
    }
    if (bonusPercent == null && bonusRub == null) {
      return res.status(400).json({ error: 'Укажите bonusPercent или bonusRub' });
    }

    const existing = await ReferralBonus.findOne({ where: { misUserId, serviceCode, clinicId } });
    const before = existing ? { bonusPercent: existing.bonusPercent, bonusRub: existing.bonusRub } : null;

    const [bonus, created] = await ReferralBonus.upsert({
      misUserId,
      doctorName: doctorName || '',
      serviceCode,
      serviceName,
      bonusPercent: bonusPercent != null ? parseFloat(bonusPercent) : null,
      bonusRub:     bonusRub    != null ? parseFloat(bonusRub)     : null,
      clinicId,
      createdBy: req.user.id
    }, {
      conflictFields: ['misUserId', 'serviceCode', 'clinicId'],
      returning: true
    });

    await logRbActivity({
      userId:     req.user.id,
      tab:        'referrals',
      action:     created ? 'create' : 'update',
      entityType: 'referral_bonus',
      entityId:   bonus.id,
      misUserId,
      doctorName: doctorName || null,
      clinicId:   clinicId || null,
      summary:    `${created ? 'Добавлен' : 'Изменён'} бонус (направления): ${doctorName || misUserId} — ${serviceName}${clinicId ? ` [клиника ${clinicId}]` : ''}`,
      diff: {
        before,
        after: { bonusPercent: bonus.bonusPercent, bonusRub: bonus.bonusRub },
      },
    });

    res.status(created ? 201 : 200).json(bonus);
  } catch (err) {
    console.error('Save referral bonus error:', err);
    res.status(500).json({ error: 'Ошибка сохранения бонуса' });
  }
});

// Массовое сохранение бонусов
router.post('/bulk', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, services } = req.body;
    const clinicId = req.body.clinicId != null ? String(req.body.clinicId).trim().substring(0, 50) : '';
    if (!misUserId || !Array.isArray(services)) {
      return res.status(400).json({ error: 'misUserId и services обязательны' });
    }

    const existingBonuses = await ReferralBonus.findAll({ where: { misUserId, clinicId } });
    const existingNameMap = Object.fromEntries(existingBonuses.map(b => [b.serviceCode, b.serviceName]));
    const oldMap = Object.fromEntries(existingBonuses.map(b => [b.serviceCode, {
      bonusPercent: b.bonusPercent != null ? parseFloat(b.bonusPercent) : null,
      bonusRub:     b.bonusRub     != null ? parseFloat(b.bonusRub)     : null,
    }]));

    const toUpsert = services.filter(s => s.bonusPercent != null || s.bonusRub != null);
    const toDeleteCodes = services
      .filter(s => s.bonusPercent == null && s.bonusRub == null)
      .map(s => s.serviceCode);

    // Удаление пустых правил и upsert новых должны фиксироваться атомарно.
    // Раньше ошибка на любом batch после destroy оставляла врачу частично
    // обновлённую конфигурацию без возможности автоматически откатиться.
    await ReferralBonus.sequelize.transaction(async transaction => {
      if (toDeleteCodes.length) {
        await ReferralBonus.destroy({
          where: { misUserId, serviceCode: toDeleteCodes, clinicId },
          transaction
        });
      }

      if (toUpsert.length) {
        const records = toUpsert.map(s => ({
          misUserId,
          doctorName: doctorName || '',
          serviceCode: String(s.serviceCode || '').slice(0, 100),
          serviceName: String(s.serviceName || '').slice(0, 500),
          bonusPercent: s.bonusPercent != null ? parseFloat(s.bonusPercent) : null,
          bonusRub:     s.bonusRub    != null ? parseFloat(s.bonusRub)     : null,
          clinicId,
          createdBy: req.user.id
        }));

        const BATCH_SIZE = 500;
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          await ReferralBonus.bulkCreate(records.slice(i, i + BATCH_SIZE), {
            updateOnDuplicate: ['doctorName', 'serviceName', 'bonusPercent', 'bonusRub', 'clinicId', 'createdBy', 'updatedAt'],
            conflictAttributes: ['misUserId', 'serviceCode', 'clinicId'],
            transaction
          });
        }
      }
    });

    // Compute changes for diff
    const newNameMap = Object.fromEntries(toUpsert.map(s => [String(s.serviceCode), s.serviceName || s.serviceCode]));
    const newMap = Object.fromEntries(toUpsert.map(s => [String(s.serviceCode), { bonusPercent: s.bonusPercent ?? null, bonusRub: s.bonusRub ?? null }]));
    const fmtBonus = b => b == null ? null : [b.bonusPercent != null ? `${b.bonusPercent}%` : null, b.bonusRub != null ? `${b.bonusRub} ₽` : null].filter(Boolean).join(' / ') || '—';
    const allCodes = new Set([...Object.keys(oldMap), ...toDeleteCodes, ...Object.keys(newMap)]);
    const changes = [];
    for (const code of allCodes) {
      const ov = oldMap[code] || null;
      const nv = toDeleteCodes.includes(code) ? null : (newMap[code] || null);
      if (JSON.stringify(ov) !== JSON.stringify(nv)) {
        changes.push({ serviceCode: code, label: newNameMap[code] || existingNameMap[code] || code, before: fmtBonus(ov), after: fmtBonus(nv) });
      }
    }

    const parts = [];
    if (toUpsert.length > 0)      parts.push(`сохранено: ${toUpsert.length}`);
    if (toDeleteCodes.length > 0) parts.push(`удалено: ${toDeleteCodes.length}`);

    await logRbActivity({
      userId:     req.user.id,
      tab:        'referrals',
      action:     'update',
      entityType: 'referral_bonus',
      misUserId,
      doctorName: doctorName || null,
      clinicId:   clinicId || null,
      summary:    `Бонусы (направления): ${doctorName || misUserId}${clinicId ? ` [клиника ${clinicId}]` : ''} — ${parts.join(', ')}`,
      diff:       changes.length ? { changes } : null,
    });

    res.json({ upserted: toUpsert.length, deleted: toDeleteCodes.length });
  } catch (err) {
    console.error('Bulk save referral bonuses error:', err);
    res.status(500).json({ error: 'Ошибка массового сохранения: ' + err.message });
  }
});

// Удалить бонус
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const bonus = await ReferralBonus.findByPk(req.params.id);
    if (!bonus) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }
    const { doctorName, misUserId, serviceName, clinicId, bonusPercent, bonusRub } = bonus;

    await logRbActivity({
      userId:     req.user.id,
      tab:        'referrals',
      action:     'delete',
      entityType: 'referral_bonus',
      entityId:   bonus.id,
      misUserId,
      doctorName: doctorName || null,
      clinicId:   clinicId || null,
      summary:    `Удалён бонус (направления): ${doctorName || misUserId} — ${serviceName}${clinicId ? ` [клиника ${clinicId}]` : ''}`,
      diff:       { before: { serviceName, bonusPercent, bonusRub } },
    });

    await bonus.destroy();
    res.json({ message: 'Удалено' });
  } catch (err) {
    console.error('Delete referral bonus error:', err);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// ════════════════════════════════════════
// ACCESS PERMISSIONS
// ════════════════════════════════════════

router.get('/permissions/my', authenticate, async (req, res) => {
  try {
    if (req.user.isAdmin) {
      return res.json({ tab1: 'edit', tabWorkTime: 'edit', tabHourNorms: 'edit', tabSchedule: 'edit', tab2: 'edit', tab3: 'edit', tab4: 'edit', tabArchiveHistory: 'edit', tabArchiveKassa: 'edit', tabArchiveTabel: 'edit', tabSummary: 'edit', tabKpi: 'edit', bypassPeriodLock: true, clinics: [], defaultClinic: 'auto' });
    }
    const perm = await RbUserPermission.findOne({ where: { userId: req.user.id } });
    if (!perm) {
      return res.json({ tab1: 'block', tabWorkTime: 'block', tabHourNorms: 'block', tabSchedule: 'block', tab2: 'block', tab3: 'block', tab4: 'block', tabArchiveHistory: 'block', tabArchiveKassa: 'block', tabArchiveTabel: 'block', tabSummary: 'block', tabKpi: 'block', bypassPeriodLock: false, clinics: [], defaultClinic: 'auto' });
    }
    const archiveFallback = perm.tabArchive || 'edit';
    res.json({ tab1: perm.tab1, tabWorkTime: perm.tabWorkTime || 'edit', tabHourNorms: perm.tabHourNorms || 'edit', tabSchedule: perm.tabSchedule || 'edit', tab2: perm.tab2, tab3: perm.tab3, tab4: perm.tab4, tabArchiveHistory: perm.tabArchiveHistory || archiveFallback, tabArchiveKassa: perm.tabArchiveKassa || archiveFallback, tabArchiveTabel: perm.tabArchiveTabel || archiveFallback, tabSummary: perm.tabSummary, tabKpi: perm.tabKpi || 'edit', bypassPeriodLock: !!perm.bypassPeriodLock, clinics: perm.clinics, defaultClinic: perm.defaultClinic || 'auto' });
  } catch (err) {
    console.error('Get rb permissions error:', err);
    res.status(500).json({ error: 'Ошибка получения прав' });
  }
});

router.get('/permissions/users', authenticate, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
  try {
    const users = await User.findAll({
      where: {
        isActive: true,
        isBot: false,
        [Op.or]: [{ isAdmin: true }, { canAccessSalary: true }]
      },
      attributes: ['id', 'username', 'displayName', 'avatar'],
      include: [{ model: RbUserPermission, as: 'rbPermission', required: false }],
      order: [['displayName', 'ASC']]
    });

    res.json(users.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      avatar: u.avatar,
      perm: u.rbPermission
        ? (() => { const af = u.rbPermission.tabArchive || 'edit'; return { tab1: u.rbPermission.tab1, tabWorkTime: u.rbPermission.tabWorkTime || 'edit', tabHourNorms: u.rbPermission.tabHourNorms || 'edit', tabSchedule: u.rbPermission.tabSchedule || 'edit', tab2: u.rbPermission.tab2, tab3: u.rbPermission.tab3, tab4: u.rbPermission.tab4, tabArchiveHistory: u.rbPermission.tabArchiveHistory || af, tabArchiveKassa: u.rbPermission.tabArchiveKassa || af, tabArchiveTabel: u.rbPermission.tabArchiveTabel || af, tabSummary: u.rbPermission.tabSummary, tabKpi: u.rbPermission.tabKpi || 'edit', bypassPeriodLock: !!u.rbPermission.bypassPeriodLock, clinics: u.rbPermission.clinics, defaultClinic: u.rbPermission.defaultClinic || 'auto' }; })()
        : { tab1: 'block', tabWorkTime: 'block', tabHourNorms: 'block', tabSchedule: 'block', tab2: 'block', tab3: 'block', tab4: 'block', tabArchiveHistory: 'block', tabArchiveKassa: 'block', tabArchiveTabel: 'block', tabSummary: 'block', tabKpi: 'block', bypassPeriodLock: false, clinics: [], defaultClinic: 'auto' }
    })));
  } catch (err) {
    console.error('Get rb permissions users error:', err);
    res.status(500).json({ error: 'Ошибка получения пользователей' });
  }
});

// Получить права конкретного пользователя (только admin)
router.get('/permissions/:userId', authenticate, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
  try {
    const perm = await RbUserPermission.findOne({ where: { userId: req.params.userId } });
    const af = perm?.tabArchive || 'edit';
    res.json(perm ? {
      tab1: perm.tab1 || 'block', tabWorkTime: perm.tabWorkTime || af,
      tabHourNorms: perm.tabHourNorms || af, tabSchedule: perm.tabSchedule || af,
      tab2: perm.tab2 || 'block', tab3: perm.tab3 || 'block', tab4: perm.tab4 || 'block',
      tabArchiveHistory: perm.tabArchiveHistory || af, tabArchiveKassa: perm.tabArchiveKassa || af,
      tabArchiveTabel: perm.tabArchiveTabel || af,
      tabSummary: perm.tabSummary || 'block', tabKpi: perm.tabKpi || 'block',
      bypassPeriodLock: !!perm.bypassPeriodLock, clinics: perm.clinics || [],
      defaultClinic: perm.defaultClinic || 'auto',
    } : {
      tab1: 'block', tabWorkTime: 'block', tabHourNorms: 'block', tabSchedule: 'block',
      tab2: 'block', tab3: 'block', tab4: 'block',
      tabArchiveHistory: 'block', tabArchiveKassa: 'block', tabArchiveTabel: 'block',
      tabSummary: 'block', tabKpi: 'block', bypassPeriodLock: false, clinics: [],
      defaultClinic: 'auto',
    });
  } catch (err) {
    console.error('Get user perm error:', err);
    res.status(500).json({ error: 'Ошибка получения прав' });
  }
});

// Сохранить права пользователя (только admin)
router.put('/permissions/:userId', authenticate, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
  try {
    const { userId } = req.params;
    const { tab1, tabWorkTime, tabHourNorms, tabSchedule, tab2, tab3, tab4, tabArchiveHistory, tabArchiveKassa, tabArchiveTabel, tabSummary, tabKpi, bypassPeriodLock, clinics, defaultClinic } = req.body;
    const valid = ['edit', 'read', 'block'];
    for (const v of [tab1, tabWorkTime, tabHourNorms, tabSchedule, tab2, tab3, tab4, tabArchiveHistory, tabArchiveKassa, tabArchiveTabel, tabSummary, tabKpi]) {
      if (v && !valid.includes(v)) return res.status(400).json({ error: `Недопустимое значение: ${v}` });
    }

    const existing = await RbUserPermission.findOne({ where: { userId } });
    const before = existing ? {
      tab1: existing.tab1, tabWorkTime: existing.tabWorkTime, tabHourNorms: existing.tabHourNorms,
      tabSchedule: existing.tabSchedule, tab2: existing.tab2, tab3: existing.tab3, tab4: existing.tab4,
      tabArchiveHistory: existing.tabArchiveHistory, tabArchiveKassa: existing.tabArchiveKassa,
      tabArchiveTabel: existing.tabArchiveTabel, tabSummary: existing.tabSummary, tabKpi: existing.tabKpi,
      bypassPeriodLock: existing.bypassPeriodLock, clinics: existing.clinics, defaultClinic: existing.defaultClinic,
    } : null;

    const data = {
      userId,
      tab1: tab1 || 'edit', tabWorkTime: tabWorkTime || 'edit', tabHourNorms: tabHourNorms || 'edit',
      tabSchedule: tabSchedule || 'edit', tab2: tab2 || 'edit', tab3: tab3 || 'edit', tab4: tab4 || 'edit',
      tabArchiveHistory: tabArchiveHistory || 'edit', tabArchiveKassa: tabArchiveKassa || 'edit',
      tabArchiveTabel: tabArchiveTabel || 'edit', tabSummary: tabSummary || 'edit', tabKpi: tabKpi || 'edit',
      bypassPeriodLock: !!bypassPeriodLock,
      clinics: Array.isArray(clinics) ? clinics : [],
      defaultClinic: (typeof defaultClinic === 'string' && defaultClinic) ? defaultClinic.slice(0, 16) : 'auto',
    };
    const [perm, created] = await RbUserPermission.findOrCreate({ where: { userId }, defaults: data });
    if (!created) await perm.update(data);

    const targetUser = await User.findByPk(userId, { attributes: ['displayName', 'username'] });
    const targetName = targetUser?.displayName || targetUser?.username || userId;

    await logRbActivity({
      userId:     req.user.id,
      tab:        'schedule',
      action:     created ? 'create' : 'update',
      entityType: 'user_permission',
      entityId:   userId,
      summary:    `${created ? 'Назначены' : 'Изменены'} права доступа: ${targetName}`,
      diff:       { before, after: { tab1: data.tab1, tabWorkTime: data.tabWorkTime, tabHourNorms: data.tabHourNorms, tabSchedule: data.tabSchedule, tab2: data.tab2, tab3: data.tab3, tab4: data.tab4, tabArchiveHistory: data.tabArchiveHistory, tabArchiveKassa: data.tabArchiveKassa, tabArchiveTabel: data.tabArchiveTabel, tabSummary: data.tabSummary, tabKpi: data.tabKpi, bypassPeriodLock: data.bypassPeriodLock, clinics: data.clinics, defaultClinic: data.defaultClinic } },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Update rb permissions error:', err);
    res.status(500).json({ error: 'Ошибка сохранения прав' });
  }
});

module.exports = router;
