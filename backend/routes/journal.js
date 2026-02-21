const express = require('express');
const router = express.Router();
const { Page, User, Folder, PageHistory } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { Op } = require('sequelize');

// Рекурсивная функция построения пути папки
async function buildFolderPath(folder) {
  if (!folder) return '';

  let path = folder.title;
  let current = folder;

  while (current.parentId) {
    const parent = await Folder.findByPk(current.parentId, {
      attributes: ['id', 'title', 'parentId']
    });
    if (!parent) break;
    path = `${parent.title} / ${path}`;
    current = parent;
  }

  return path;
}

// GET /api/journal - получить список всех страниц с фильтрацией
router.get('/', authenticate, requireAdminAccess('journal'), async (req, res) => {
  try {
    const {
      search,
      contentType,
      dateFrom,
      dateTo,
      folderId,
      createdBy,
      isPublished,
      limit = 50,
      offset = 0
    } = req.query;

    const where = {};

    // Поиск по названию страницы
    if (search) {
      where.title = { [Op.iLike]: `%${search}%` };
    }

    // Фильтр по типу страницы
    if (contentType) {
      where.contentType = contentType;
    }

    // Фильтр по дате последнего изменения
    if (dateFrom || dateTo) {
      where.updatedAt = {};
      if (dateFrom) where.updatedAt[Op.gte] = new Date(dateFrom);
      if (dateTo) where.updatedAt[Op.lte] = new Date(dateTo);
    }

    // Фильтр по папке
    if (folderId !== undefined) {
      where.folderId = folderId === 'null' ? null : folderId;
    }

    // Фильтр по автору
    if (createdBy) {
      where.createdBy = createdBy;
    }

    // Фильтр по статусу публикации
    if (isPublished !== undefined) {
      where.isPublished = isPublished === 'true';
    }

    const pages = await Page.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'displayName', 'username']
        },
        {
          model: User,
          as: 'editor',
          attributes: ['id', 'displayName', 'username']
        },
        {
          model: Folder,
          as: 'folder',
          attributes: ['id', 'title', 'parentId']
        }
      ],
      order: [['updatedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
      attributes: ['id', 'title', 'slug', 'contentType', 'isPublished',
                   'createdAt', 'updatedAt', 'folderId', 'createdBy', 'updatedBy']
    });

    // Для каждой страницы получаем полный путь папки
    const pagesWithPath = await Promise.all(pages.rows.map(async (page) => {
      let folderPath = '';
      if (page.folder) {
        folderPath = await buildFolderPath(page.folder);
      }

      return {
        ...page.toJSON(),
        folderPath
      };
    }));

    res.json({
      count: pages.count,
      rows: pagesWithPath
    });
  } catch (error) {
    console.error('Get journal error:', error);
    res.status(500).json({ error: 'Failed to fetch journal data' });
  }
});

// Человекочитаемые названия модулей по slug
const MODULE_LABELS = {
  'accreditations': 'Аккредитации',
  'archive-accreditations': 'Архив аккредитаций',
  'analyses': 'Анализы',
  'vehicles': 'Транспорт',
  'archive-vehicles': 'Архив транспорта',
  'map': 'Карта',
  'price-compare': 'Сравнение цен',
  'refferal-bonuses': 'Реферальные бонусы',
};

// GET /api/journal/activities - история действий в специализированных модулях
// Показывает ВСЕ записи, где в metadata есть pageSlug (= записаны из маршрутов модулей)
router.get('/activities', authenticate, requireAdminAccess('journal'), async (req, res) => {
  try {
    const {
      pageSlug,
      userId: userIdFilter,
      dateFrom,
      dateTo,
      limit = 100,
      offset = 0
    } = req.query;

    const { Sequelize } = require('../models');

    // Базовый фильтр: только записи от модульных маршрутов (имеют metadata.pageSlug)
    const andConditions = [
      Sequelize.literal(`metadata->>'pageSlug' IS NOT NULL`)
    ];

    if (pageSlug) {
      // Slugs are always alphanumeric + hyphens/underscores — safe to embed directly
      const safeSlug = String(pageSlug).replace(/[^a-zA-Z0-9_-]/g, '');
      andConditions.push(Sequelize.literal(`metadata->>'pageSlug' = '${safeSlug}'`));
    }

    const where = { [Op.and]: andConditions };
    if (userIdFilter) where.userId = userIdFilter;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo) where.createdAt[Op.lte] = new Date(dateTo + 'T23:59:59.999Z');
    }

    const { count, rows } = await PageHistory.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'displayName', 'username', 'avatar']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const result = rows.map(entry => ({
      ...entry.toJSON(),
      moduleLabel: MODULE_LABELS[entry.metadata?.pageSlug] || entry.metadata?.pageSlug || 'Неизвестный модуль'
    }));

    res.json({ count, rows: result });
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// GET /api/journal/activity-modules - получить список уникальных модулей с активностью
router.get('/activity-modules', authenticate, requireAdminAccess('journal'), async (req, res) => {
  try {
    const { sequelize } = require('../models');
    const { QueryTypes } = require('sequelize');

    const rows = await sequelize.query(`
      SELECT DISTINCT metadata->>'pageSlug' as "pageSlug", COUNT(*) as cnt
      FROM page_history
      WHERE metadata->>'pageSlug' IS NOT NULL
      GROUP BY metadata->>'pageSlug'
      ORDER BY cnt DESC
    `, { type: QueryTypes.SELECT });

    const modules = rows.map(r => ({
      slug: r.pageSlug,
      label: MODULE_LABELS[r.pageSlug] || r.pageSlug,
      count: parseInt(r.cnt)
    }));

    res.json(modules);
  } catch (error) {
    console.error('Get activity modules error:', error);
    res.status(500).json({ error: 'Failed to fetch activity modules' });
  }
});

module.exports = router;
