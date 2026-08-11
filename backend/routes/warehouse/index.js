/**
 * Складской учёт (ver. 6.68) — сборка подроутеров.
 *
 * Модуль разложен по файлам, а не сделан одним routes/warehouse.js на несколько
 * тысяч строк: в остальном проекте один файл на модуль, но здесь модулей внутри
 * модуля семь, и общий файл пришлось бы читать поиском.
 *
 * Публичные карточки по QR (routes/warehouse/public.js) сюда НЕ включены: они
 * монтируются в server.js отдельно и без authenticate. Держать их рядом с
 * защищёнными маршрутами — верный способ однажды закрыть их авторизацией и
 * сломать сканирование, не заметив этого.
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../../middleware/auth');
const { resolveLevel, rolePermissions, hasModuleAccess } = require('../../services/warehouse/access');

/**
 * Что этому пользователю доступно в модуле. Клиент дёргает первым делом и по
 * ответу решает, какие вкладки и кнопки показывать.
 */
router.get('/access', authenticate, async (req, res) => {
  try {
    if (!hasModuleAccess(req.user)) {
      return res.json({ allowed: false, level: 'none' });
    }
    const level = await resolveLevel(req.user);
    res.json({
      allowed: true,
      level,
      perms: rolePermissions(req.user),
      capabilities: {
        canEditLocations: level === 'admin',
        canEditPlans:     level === 'admin',
        canManageAssets:  ['admin', 'warehouse'].includes(level),
        canIssue:         ['admin', 'warehouse', 'department'].includes(level),
        canInventory:     ['admin', 'warehouse', 'department'].includes(level),
        canPrintLabels:   ['admin', 'warehouse'].includes(level),
        canSeeCosts:      ['admin', 'warehouse'].includes(level),
      },
      // Обмена с 1С нет — сообщаем это один раз здесь, чтобы каждый экран не
      // выяснял отдельно и не рисовал пустые блоки сверки.
      integrations: { oneC: { enabled: false, reason: 'Контракт со стороны 1С не определён' } },
    });
  } catch (err) {
    console.error('GET warehouse/access error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.use('/locations',  require('./locations'));
router.use('/catalog',    require('./catalog'));
router.use('/assets',     require('./assets'));
router.use('/operations', require('./operations'));
router.use('/reports',    require('./reports'));
router.use('/analytics',  require('./analytics'));

module.exports = router;
