const express = require('express');
const { Op } = require('sequelize');
const { ReferralBonus, Page, PageHistory, RbUserPermission, User, Setting } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const REFERRAL_BONUSES_PAGE_SLUG = 'rb-referrals';

// === HELPER: Запись в историю страницы ===
async function recordHistory(pageSlug, userId, summary, changes = []) {
  try {
    const page = await Page.findOne({ where: { slug: pageSlug } });
    await PageHistory.create({
      pageId: page ? page.id : null,
      userId,
      action: 'updated',
      changesSummary: summary,
      metadata: { changes, pageSlug }
    });
  } catch (err) {
    console.error('History record error:', err.message);
  }
}

// === Suggests (подсказки автозаполнения) ===
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
    const { misUserId } = req.query;
    if (!misUserId) {
      return res.status(400).json({ error: 'misUserId обязателен' });
    }
    const bonuses = await ReferralBonus.findAll({
      where: { misUserId },
      order: [['createdAt', 'ASC']]
    });
    res.json(bonuses);
  } catch (err) {
    console.error('Get referral bonuses error:', err);
    res.status(500).json({ error: 'Ошибка получения бонусов' });
  }
});

// Получить все бонусы по услуге (для всех врачей)
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
    // Возвращаем map: misUserId -> { id, bonusPercent, bonusRub }
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

// Сохранить/обновить бонус для услуги врача
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

    const [bonus, created] = await ReferralBonus.upsert({
      misUserId,
      doctorName: doctorName || '',
      serviceCode,
      serviceName,
      bonusPercent: bonusPercent != null ? parseFloat(bonusPercent) : null,
      bonusRub: bonusRub != null ? parseFloat(bonusRub) : null,
      clinicId,
      createdBy: req.user.id
    }, {
      conflictFields: ['misUserId', 'serviceCode', 'clinicId'],
      returning: true
    });

    await recordHistory(
      REFERRAL_BONUSES_PAGE_SLUG,
      req.user.id,
      created
        ? `Добавлен бонус: ${doctorName || misUserId} — ${serviceName}`
        : `Обновлён бонус: ${doctorName || misUserId} — ${serviceName}`,
      [{ field: 'bonus', label: created ? 'Добавлен бонус' : 'Обновлён бонус',
        to: `${serviceName} (${bonusPercent != null ? bonusPercent + '%' : bonusRub + ' руб.'})` }]
    );

    res.status(created ? 201 : 200).json(bonus);
  } catch (err) {
    console.error('Save referral bonus error:', err);
    res.status(500).json({ error: 'Ошибка сохранения бонуса' });
  }
});

// Массовое сохранение бонусов врача
// services: [{ serviceCode, serviceName, bonusPercent, bonusRub }]
// Если оба поля null — запись удаляется (если была)
router.post('/bulk', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, services } = req.body;
    const clinicId = req.body.clinicId != null ? String(req.body.clinicId).trim().substring(0, 50) : '';
    if (!misUserId || !Array.isArray(services)) {
      return res.status(400).json({ error: 'misUserId и services обязательны' });
    }

    const toUpsert = services.filter(s => s.bonusPercent != null || s.bonusRub != null);
    const toDeleteCodes = services
      .filter(s => s.bonusPercent == null && s.bonusRub == null)
      .map(s => s.serviceCode);

    if (toDeleteCodes.length) {
      await ReferralBonus.destroy({ where: { misUserId, serviceCode: toDeleteCodes, clinicId } });
    }

    if (toUpsert.length) {
      const records = toUpsert.map(s => ({
        misUserId,
        doctorName: doctorName || '',
        serviceCode: String(s.serviceCode || '').slice(0, 100),
        serviceName: String(s.serviceName || '').slice(0, 500),
        bonusPercent: s.bonusPercent != null ? parseFloat(s.bonusPercent) : null,
        bonusRub:     s.bonusRub     != null ? parseFloat(s.bonusRub)     : null,
        clinicId,
        createdBy: req.user.id
      }));

      const BATCH_SIZE = 500;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        await ReferralBonus.bulkCreate(records.slice(i, i + BATCH_SIZE), {
          updateOnDuplicate: ['doctorName', 'serviceName', 'bonusPercent', 'bonusRub', 'clinicId', 'createdBy', 'updatedAt'],
          conflictAttributes: ['misUserId', 'serviceCode', 'clinicId']
        });
      }
    }

    const parts = [];
    if (toUpsert.length > 0) parts.push(`сохранено: ${toUpsert.length}`);
    if (toDeleteCodes.length > 0) parts.push(`удалено: ${toDeleteCodes.length}`);
    await recordHistory(
      REFERRAL_BONUSES_PAGE_SLUG,
      req.user.id,
      `Бонусы врача ${doctorName || misUserId}: ${parts.join(', ')}`,
      [{ field: 'bonusBulk', label: 'Массовое обновление бонусов', to: `${doctorName || misUserId}` }]
    );

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
    const { doctorName, misUserId, serviceName } = bonus;
    await bonus.destroy();

    await recordHistory(
      REFERRAL_BONUSES_PAGE_SLUG,
      req.user.id,
      `Удалён бонус: ${doctorName || misUserId} — ${serviceName}`,
      [{ field: 'bonus', label: 'Удалён бонус', from: serviceName }]
    );

    res.json({ message: 'Удалено' });
  } catch (err) {
    console.error('Delete referral bonus error:', err);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

// ════════════════════════════════════════
// ACCESS PERMISSIONS
// ════════════════════════════════════════

// Получить свои права доступа
router.get('/permissions/my', authenticate, async (req, res) => {
  try {
    if (req.user.isAdmin) {
      return res.json({ tab1: 'edit', tabWorkTime: 'edit', tabHourNorms: 'edit', tabSchedule: 'edit', tab2: 'edit', tab3: 'edit', tab4: 'edit', tabArchiveHistory: 'edit', tabArchiveKassa: 'edit', tabArchiveTabel: 'edit', tabSummary: 'edit', tabKpi: 'edit', clinics: [] });
    }
    const perm = await RbUserPermission.findOne({ where: { userId: req.user.id } });
    if (!perm) {
      return res.json({ tab1: 'block', tabWorkTime: 'block', tabHourNorms: 'block', tabSchedule: 'block', tab2: 'block', tab3: 'block', tab4: 'block', tabArchiveHistory: 'block', tabArchiveKassa: 'block', tabArchiveTabel: 'block', tabSummary: 'block', tabKpi: 'block', clinics: [] });
    }
    const archiveFallback = perm.tabArchive || 'edit';
    res.json({ tab1: perm.tab1, tabWorkTime: perm.tabWorkTime || 'edit', tabHourNorms: perm.tabHourNorms || 'edit', tabSchedule: perm.tabSchedule || 'edit', tab2: perm.tab2, tab3: perm.tab3, tab4: perm.tab4, tabArchiveHistory: perm.tabArchiveHistory || archiveFallback, tabArchiveKassa: perm.tabArchiveKassa || archiveFallback, tabArchiveTabel: perm.tabArchiveTabel || archiveFallback, tabSummary: perm.tabSummary, tabKpi: perm.tabKpi || 'edit', clinics: perm.clinics });
  } catch (err) {
    console.error('Get rb permissions error:', err);
    res.status(500).json({ error: 'Ошибка получения прав' });
  }
});

// Получить список пользователей с доступом к разделу зарплаты + их права (только admin)
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
        ? (() => { const af = u.rbPermission.tabArchive || 'edit'; return { tab1: u.rbPermission.tab1, tabWorkTime: u.rbPermission.tabWorkTime || 'edit', tabHourNorms: u.rbPermission.tabHourNorms || 'edit', tabSchedule: u.rbPermission.tabSchedule || 'edit', tab2: u.rbPermission.tab2, tab3: u.rbPermission.tab3, tab4: u.rbPermission.tab4, tabArchiveHistory: u.rbPermission.tabArchiveHistory || af, tabArchiveKassa: u.rbPermission.tabArchiveKassa || af, tabArchiveTabel: u.rbPermission.tabArchiveTabel || af, tabSummary: u.rbPermission.tabSummary, tabKpi: u.rbPermission.tabKpi || 'edit', clinics: u.rbPermission.clinics }; })()
        : { tab1: 'block', tabWorkTime: 'block', tabHourNorms: 'block', tabSchedule: 'block', tab2: 'block', tab3: 'block', tab4: 'block', tabArchiveHistory: 'block', tabArchiveKassa: 'block', tabArchiveTabel: 'block', tabSummary: 'block', tabKpi: 'block', clinics: [] }
    })));
  } catch (err) {
    console.error('Get rb permissions users error:', err);
    res.status(500).json({ error: 'Ошибка получения пользователей' });
  }
});

// Сохранить права пользователя (только admin)
router.put('/permissions/:userId', authenticate, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
  try {
    const { userId } = req.params;
    const { tab1, tabWorkTime, tabHourNorms, tabSchedule, tab2, tab3, tab4, tabArchiveHistory, tabArchiveKassa, tabArchiveTabel, tabSummary, tabKpi, clinics } = req.body;
    const valid = ['edit', 'read', 'block'];
    for (const v of [tab1, tabWorkTime, tabHourNorms, tabSchedule, tab2, tab3, tab4, tabArchiveHistory, tabArchiveKassa, tabArchiveTabel, tabSummary, tabKpi]) {
      if (v && !valid.includes(v)) return res.status(400).json({ error: `Недопустимое значение: ${v}` });
    }
    const data = {
      userId,
      tab1: tab1 || 'edit',
      tabWorkTime: tabWorkTime || 'edit',
      tabHourNorms: tabHourNorms || 'edit',
      tabSchedule: tabSchedule || 'edit',
      tab2: tab2 || 'edit',
      tab3: tab3 || 'edit',
      tab4: tab4 || 'edit',
      tabArchiveHistory: tabArchiveHistory || 'edit',
      tabArchiveKassa: tabArchiveKassa || 'edit',
      tabArchiveTabel: tabArchiveTabel || 'edit',
      tabSummary: tabSummary || 'edit',
      tabKpi: tabKpi || 'edit',
      clinics: Array.isArray(clinics) ? clinics : [],
    };
    const [perm, created] = await RbUserPermission.findOrCreate({ where: { userId }, defaults: data });
    if (!created) await perm.update(data);
    res.json({ success: true });
  } catch (err) {
    console.error('Update rb permissions error:', err);
    res.status(500).json({ error: 'Ошибка сохранения прав' });
  }
});

module.exports = router;
