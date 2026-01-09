const express = require('express');
const { body, validationResult } = require('express-validator');
const { Folder, Page, User } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Получить содержимое папки (или корня)
router.get('/browse', authenticate, async (req, res) => {
  try {
    const { parentId } = req.query;
    
    // Получаем подпапки - сортировка только по алфавиту
    const folders = await Folder.findAll({
      where: { parentId: parentId || null },
      include: [{ model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] }],
      order: [['title', 'ASC']]
    });

    // Получаем страницы в этой папке - сортировка только по алфавиту
    const pages = await Page.findAll({
      where: { folderId: parentId || null },
      include: [{ model: User, as: 'author', attributes: ['id', 'username', 'displayName'] }],
      order: [['title', 'ASC']]
    });

    // Получаем путь (хлебные крошки)
    let breadcrumbs = [];
    if (parentId) {
      let currentFolder = await Folder.findByPk(parentId);
      while (currentFolder) {
        breadcrumbs.unshift({ id: currentFolder.id, title: currentFolder.title });
        if (currentFolder.parentId) {
          currentFolder = await Folder.findByPk(currentFolder.parentId);
        } else {
          currentFolder = null;
        }
      }
    }

    res.json({ folders, pages, breadcrumbs });
  } catch (error) {
    console.error('Browse folders error:', error);
    res.status(500).json({ error: 'Failed to browse folders' });
  }
});

// Получить дерево папок (для выбора в модалках)
router.get('/tree', authenticate, async (req, res) => {
  try {
    const buildTree = async (parentId = null, level = 0) => {
      if (level >= 2) return []; // Максимум 2 уровня
      
      const folders = await Folder.findAll({
        where: { parentId },
        order: [['title', 'ASC']]
      });

      const result = [];
      for (const folder of folders) {
        const children = await buildTree(folder.id, level + 1);
        result.push({
          id: folder.id,
          title: folder.title,
          icon: folder.icon,
          level,
          children
        });
      }
      return result;
    };

    const tree = await buildTree();
    res.json(tree);
  } catch (error) {
    console.error('Get folder tree error:', error);
    res.status(500).json({ error: 'Failed to get folder tree' });
  }
});

// Получить папку по ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const folder = await Folder.findByPk(req.params.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] },
        { model: Folder, as: 'parent', attributes: ['id', 'title'] }
      ]
    });

    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    res.json(folder);
  } catch (error) {
    console.error('Get folder error:', error);
    res.status(500).json({ error: 'Failed to get folder' });
  }
});

// Создать папку
router.post('/', authenticate, requirePermission('pages', 'write'), [
  body('title').notEmpty().withMessage('Title is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, icon, parentId, description } = req.body;

    // Проверяем уровень вложенности (максимум 2)
    if (parentId) {
      const parent = await Folder.findByPk(parentId);
      if (!parent) {
        return res.status(400).json({ error: 'Parent folder not found' });
      }
      // Если у родителя есть свой родитель — это уже 2-й уровень
      if (parent.parentId) {
        return res.status(400).json({ error: 'Максимальная вложенность — 2 уровня' });
      }
    }

    // Получаем максимальный sortOrder
    const maxOrder = await Folder.max('sortOrder', { 
      where: { parentId: parentId || null } 
    });

    const folder = await Folder.create({
      title,
      icon: icon || 'folder',
      parentId: parentId || null,
      description,
      sortOrder: (maxOrder || 0) + 1,
      createdBy: req.user.id
    });

    const created = await Folder.findByPk(folder.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] }]
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Обновить папку
router.put('/:id', authenticate, requirePermission('pages', 'write'), async (req, res) => {
  try {
    const folder = await Folder.findByPk(req.params.id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const { title, icon, parentId, description, sortOrder } = req.body;

    // Проверяем уровень вложенности при смене родителя
    if (parentId !== undefined && parentId !== folder.parentId) {
      if (parentId) {
        // Нельзя переместить папку в саму себя
        if (parentId === folder.id) {
          return res.status(400).json({ error: 'Нельзя переместить папку в саму себя' });
        }
        
        const parent = await Folder.findByPk(parentId);
        if (!parent) {
          return res.status(400).json({ error: 'Parent folder not found' });
        }
        if (parent.parentId) {
          return res.status(400).json({ error: 'Максимальная вложенность — 2 уровня' });
        }
        
        // Проверяем, что не перемещаем в свою же дочернюю папку
        const children = await Folder.findAll({ where: { parentId: folder.id } });
        if (children.some(c => c.id === parentId)) {
          return res.status(400).json({ error: 'Нельзя переместить папку в дочернюю папку' });
        }
      }
    }

    await folder.update({
      ...(title && { title }),
      ...(icon !== undefined && { icon }),
      ...(parentId !== undefined && { parentId: parentId || null }),
      ...(description !== undefined && { description }),
      ...(sortOrder !== undefined && { sortOrder })
    });

    const updated = await Folder.findByPk(folder.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] }]
    });

    res.json(updated);
  } catch (error) {
    console.error('Update folder error:', error);
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

// Переместить элементы (папки/страницы)
router.post('/move', authenticate, requirePermission('pages', 'write'), async (req, res) => {
  try {
    const { items } = req.body; // [{ id, type: 'folder'|'page', targetFolderId }]

    for (const item of items) {
      if (item.type === 'folder') {
        const folder = await Folder.findByPk(item.id);
        if (!folder) continue;
        await folder.update({ parentId: item.targetFolderId || null });
      } else if (item.type === 'page') {
        const page = await Page.findByPk(item.id);
        if (!page) continue;
        await page.update({ folderId: item.targetFolderId || null });
      }
    }

    res.json({ message: 'Items moved' });
  } catch (error) {
    console.error('Move items error:', error);
    res.status(500).json({ error: 'Failed to move items' });
  }
});

// Изменить порядок
router.post('/reorder', authenticate, requirePermission('pages', 'write'), async (req, res) => {
  try {
    const { folders, pages } = req.body;

    if (folders) {
      for (const item of folders) {
        await Folder.update({ sortOrder: item.sortOrder }, { where: { id: item.id } });
      }
    }

    if (pages) {
      for (const item of pages) {
        await Page.update({ sortOrder: item.sortOrder }, { where: { id: item.id } });
      }
    }

    res.json({ message: 'Reorder successful' });
  } catch (error) {
    console.error('Reorder error:', error);
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

// Удалить папку (каскадно)
router.delete('/:id', authenticate, requirePermission('pages', 'delete'), async (req, res) => {
  try {
    const folder = await Folder.findByPk(req.params.id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Рекурсивное удаление
    const deleteRecursively = async (folderId) => {
      // Удаляем страницы в этой папке
      await Page.destroy({ where: { folderId } });
      
      // Находим дочерние папки
      const children = await Folder.findAll({ where: { parentId: folderId } });
      
      // Рекурсивно удаляем дочерние
      for (const child of children) {
        await deleteRecursively(child.id);
      }
      
      // Удаляем саму папку
      await Folder.destroy({ where: { id: folderId } });
      
      // Удаляем связанные элементы сайдбара
      const { SidebarItem } = require('../models');
      await SidebarItem.destroy({ where: { folderId } });
    };

    await deleteRecursively(folder.id);

    res.json({ message: 'Folder and contents deleted' });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

module.exports = router;