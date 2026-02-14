const express = require('express');
const router = express.Router();
const { Page, User, Folder } = require('../models');
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

module.exports = router;
