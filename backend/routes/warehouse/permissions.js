/**
 * Права складского модуля: чтение своих и настройка чужих.
 *
 * Настраиваются права не здесь, а в дереве прав карточки пользователя (админка) —
 * тем же механизмом, что у зарплатного модуля. Этот файл только отдаёт каталог
 * прав, текущие значения и принимает новые; своего экрана настройки у модуля
 * больше нет. Прежний экран «Доступ» внутри модуля убран: настройка прав жила в
 * двух местах — в админке для доступа к разделу и внутри модуля для его
 * содержимого, — и найти, где именно человеку не хватает права, было нельзя.
 *
 * Право настраивать права — общее админское (isAdmin), а не своё внутримодульное.
 * Отдельное «canManageAccess» означало бы, что администратор склада может выдать
 * права сам себе, минуя администратора портала.
 */

const express = require('express');
const router = express.Router();
const { User, MedCenter, WhUserPermission, sequelize } = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, resolveAccess } = require('../../services/warehouse/access');
const perms = require('../../services/warehouse/permissions');

const requireAdmin = (req, res, next) => (
  req.user?.isAdmin ? next() : res.status(403).json({ error: 'Нет доступа' })
);

/**
 * Каталог прав для дерева в админке: перечень разделов и отчётов с названиями.
 * Отдаётся сервером, а не дублируется в вёрстке, — иначе новый отчёт пришлось бы
 * добавлять в двух местах и однажды забыть в одном из них.
 */
router.get('/catalogue', authenticate, requireAdmin, async (req, res) => {
  try {
    const medCenters = await MedCenter.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'color'],
      order: [['sortOrder', 'ASC'], ['name', 'ASC']],
    });
    res.json({ ...perms.catalogue(), medCenters });
  } catch (err) {
    console.error('GET warehouse/permissions/catalogue error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Свои права — для экранов, которым нужна разница read/edit внутри вкладки. */
router.get('/my', authenticate, requireWarehouse(), async (req, res) => {
  res.json({
    perms: req.warehouse.perms,
    capabilities: req.warehouse.capabilities,
    tabs: req.warehouse.tabs,
    medCenterIds: req.warehouse.medCenterIds,
  });
});

/** Права конкретного человека — для дерева в его карточке. */
router.get('/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const row = await WhUserPermission.findOne({ where: { userId: req.params.userId } });
    res.json({
      perms: perms.normalize(row?.perms),
      medCenterIds: Array.isArray(row?.medCenterIds) ? row.medCenterIds : [],
    });
  } catch (err) {
    console.error('GET warehouse/permissions/:userId error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Сохранение прав. Значения нормализуются: всё, чего нет в каталоге, отбрасывается,
 * а неизвестный уровень превращается в block. Доверять телу запроса тут нельзя —
 * это ровно та ручка, через которую удобно выдать себе лишнее.
 */
router.put('/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId, { attributes: ['id'] });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const clean = perms.normalize(req.body?.perms);
    const incoming = Array.isArray(req.body?.medCenterIds) ? req.body.medCenterIds : [];
    // Медцентры сверяем со справочником: несуществующий id в области видимости
    // молча сузил бы её до нуля, и человек остался бы без данных без объяснений.
    const known = await MedCenter.findAll({
      where: { id: incoming, isActive: true }, attributes: ['id'],
    });
    const medCenterIds = known.map(m => m.id);

    const [row] = await WhUserPermission.findOrCreate({
      where: { userId: user.id },
      defaults: { userId: user.id, perms: clean, medCenterIds },
    });
    await row.update({ perms: clean, medCenterIds });

    res.json({ perms: clean, medCenterIds });
  } catch (err) {
    console.error('PUT warehouse/permissions/:userId error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Кто и что реально откроет — сводка для админки.
 *
 * Считается тем же кодом, что и на боевых запросах (resolveAccess), а не
 * пересказывается: иначе экран настройки показывал бы одно, а сервер пускал бы
 * по другому, и расхождение обнаружилось бы жалобой.
 */
router.get('/effective/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId, {
      attributes: { exclude: ['password'] },
    });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const access = await resolveAccess(user);
    if (!access.allowed) {
      return res.json({
        user: { id: user.id, displayName: user.displayName, username: user.username },
        allowed: false,
        reason: 'Не включён доступ к разделу «Складской учёт» в карточке пользователя',
      });
    }

    res.json({
      user: {
        id: user.id, displayName: user.displayName, username: user.username,
        isAdmin: user.isAdmin,
      },
      allowed: true,
      isAdmin: access.isAdmin,
      perms: access.perms,
      capabilities: access.capabilities,
      tabs: access.tabs,
      medCenterIds: access.medCenterIds,
      reports: perms.readableReports(access.perms),
    });
  } catch (err) {
    console.error('GET warehouse/permissions/effective error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Пользователи с доступом к разделу — для выбора в админке. */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT u.id, u."displayName", u.username, u."isAdmin"
      FROM users u
      WHERE u."isActive" = TRUE AND (u."isBot" IS NULL OR u."isBot" = FALSE)
        AND (u."isAdmin" = TRUE OR (u."adminAccess" ->> 'warehouse')::bool = TRUE)
      ORDER BY u."displayName" NULLS LAST, u.username
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET warehouse/permissions error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
