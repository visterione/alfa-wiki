const express = require('express');
const { Op } = require('sequelize');
const { ReferralBonus, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const REFERRAL_BONUSES_PAGE_SLUG = 'refferal-bonuses';

// === HELPER: Запись в историю страницы ===
async function recordHistory(pageSlug, userId, summary, changes = []) {
  try {
    const page = await Page.findOne({ where: { slug: pageSlug } });
    if (!page) return;
    await PageHistory.create({
      pageId: page.id,
      userId,
      action: 'updated',
      changesSummary: summary,
      metadata: { changes }
    });
  } catch (err) {
    console.error('History record error:', err.message);
  }
}

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

// Сохранить/обновить бонус для услуги врача
router.post('/', authenticate, async (req, res) => {
  try {
    const { misUserId, doctorName, serviceCode, serviceName, bonusPercent, bonusRub } = req.body;

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
      createdBy: req.user.id
    }, {
      conflictFields: ['misUserId', 'serviceCode'],
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
    if (!misUserId || !Array.isArray(services)) {
      return res.status(400).json({ error: 'misUserId и services обязательны' });
    }

    const toUpsert = services.filter(s => s.bonusPercent != null || s.bonusRub != null);
    const toDeleteCodes = services
      .filter(s => s.bonusPercent == null && s.bonusRub == null)
      .map(s => s.serviceCode);

    if (toDeleteCodes.length) {
      await ReferralBonus.destroy({ where: { misUserId, serviceCode: toDeleteCodes } });
    }

    if (toUpsert.length) {
      const records = toUpsert.map(s => ({
        misUserId,
        doctorName: doctorName || '',
        serviceCode: String(s.serviceCode || '').slice(0, 100),
        serviceName: String(s.serviceName || '').slice(0, 500),
        bonusPercent: s.bonusPercent != null ? parseFloat(s.bonusPercent) : null,
        bonusRub:     s.bonusRub     != null ? parseFloat(s.bonusRub)     : null,
        createdBy: req.user.id
      }));

      const BATCH_SIZE = 500;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        await ReferralBonus.bulkCreate(records.slice(i, i + BATCH_SIZE), {
          updateOnDuplicate: ['doctorName', 'serviceName', 'bonusPercent', 'bonusRub', 'createdBy', 'updatedAt'],
          conflictAttributes: ['misUserId', 'serviceCode']
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

module.exports = router;
