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
const { resolveAccess, hasModuleAccess } = require('../../services/warehouse/access');
const perms = require('../../services/warehouse/permissions');

/**
 * Что этому пользователю доступно в модуле. Клиент дёргает первым делом и по
 * ответу решает, какие вкладки и кнопки показывать.
 */
router.get('/access', authenticate, async (req, res) => {
  try {
    if (!hasModuleAccess(req.user)) {
      return res.json({ allowed: false, tabs: {}, capabilities: {}, reports: [] });
    }
    const access = await resolveAccess(req.user);

    res.json({
      allowed: true,
      // Вкладки, которые человеку видно: считает сервер по дереву прав, клиент
      // только рисует. До этого состав вкладок клиент выводил сам из ролей.
      tabs: access.tabs,
      capabilities: access.capabilities,
      // Какие отчёты человек вправе открыть: экран отчётов строит по этому списку,
      // а не показывает всё подряд с ошибкой при клике.
      reports: perms.readableReports(access.perms),
      // Полные права построчно — нужны там, где важна разница read/edit внутри
      // одного экрана, а не факт доступа к нему.
      perms: access.perms,
      medCenterIds: access.medCenterIds,
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
router.use('/permissions', require('./permissions'));
router.use('/osv',        require('./osv'));
router.use('/item-rules', require('./itemRules'));
router.use('/placements', require('./placements'));

module.exports = router;
