const express = require('express');
const { MedCenter } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { isValidBadgeColor } = require('../utils/chatBadgeIcons');
const userChatBadge = require('../services/userChatBadge');

const router = express.Router();

// Список клиник с цветами. Читают и админка ролей, и карточка пользователя,
// поэтому доступ даём по любому из двух прав.
router.get('/', authenticate, async (req, res) => {
  try {
    const hasAccess = req.user.isAdmin ||
                      req.user.adminAccess?.roles ||
                      req.user.adminAccess?.users;
    if (!hasAccess) return res.status(403).json({ error: 'Access denied to med centers' });

    const medCenters = await MedCenter.findAll({ order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
    res.json(medCenters);
  } catch (error) {
    console.error('Get med centers error:', error);
    res.status(500).json({ error: 'Ошибка загрузки медицинских центров' });
  }
});

// Цвет клиники и её приоритет при выборе цвета метки.
router.put('/:id', authenticate, requireAdminAccess('roles'), async (req, res) => {
  try {
    const medCenter = await MedCenter.findByPk(req.params.id);
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });

    const { color, sortOrder } = req.body;

    if (color !== undefined && color !== null && color !== '' && !isValidBadgeColor(color)) {
      return res.status(400).json({ error: 'Цвет должен быть в формате #rrggbb' });
    }

    await medCenter.update({
      ...(color !== undefined && { color: color || null }),
      ...(sortOrder !== undefined && { sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 100 })
    });

    await userChatBadge.recomputeForMedCenter(medCenter.id);

    res.json(medCenter);
  } catch (error) {
    console.error('Update med center error:', error);
    res.status(500).json({ error: 'Ошибка обновления медцентра' });
  }
});

module.exports = router;
