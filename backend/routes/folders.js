const express = require('express');
const { body, validationResult } = require('express-validator');
const { Folder, Page, User, Media } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Вспомогательная функция для проверки доступа к странице
function canAccessPage(page, userRoleIds, isAdmin) {
  // Админы видят всё
  if (isAdmin) return true;

  // Если у страницы пустой allowedRoles, она доступна всем
  if (!page.allowedRoles || page.allowedRoles.length === 0) {
    return true;
  }

  // Проверяем, есть ли у пользователя нужная роль
  return userRoleIds.some(roleId => page.allowedRoles.includes(roleId));
}

// Та же проверка доступа, но для папок
function canAccessFolder(folder, userRoleIds, isAdmin) {
  if (isAdmin) return true;
  if (!folder.allowedRoles || folder.allowedRoles.length === 0) return true;
  return userRoleIds.some(roleId => folder.allowedRoles.includes(roleId));
}

// Транслитерация названия в slug (как у страниц)
function generateSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[а-яё]/gi, char => {
      const ru = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
      const en = ['a','b','v','g','d','e','yo','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','c','ch','sh','sch','','y','','e','yu','ya'];
      const idx = ru.indexOf(char.toLowerCase());
      return idx >= 0 ? en[idx] : char;
    })
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Уникальный slug среди папок-сестёр (один и тот же parentId)
async function uniqueFolderSlug(title, parentId, excludeId = null) {
  let base = generateSlug(title) || 'folder';
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { parentId: parentId || null, slug };
    if (excludeId) where.id = { [require('sequelize').Op.ne]: excludeId };
    const clash = await Folder.findOne({ where });
    if (!clash) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

// Общая загрузка содержимого папки (или корня) с учётом прав доступа.
// Возвращает { folderId, folders, pages, breadcrumbs }.
async function getFolderContents(parentId, req) {
  const userRoleIds = req.user.roles?.map(r => r.id) || [];
  const isAdmin = req.user.isAdmin;

  const allFolders = await Folder.findAll({
    where: { parentId: parentId || null },
    include: [{ model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] }],
    order: [['title', 'ASC']]
  });

  const folders = allFolders.filter(f => canAccessFolder(f, userRoleIds, isAdmin));

  const allPages = await Page.findAll({
    where: { folderId: parentId || null },
    include: [
      { model: User, as: 'author', attributes: ['id', 'username', 'displayName'] },
      { model: Media, as: 'mediaFile', attributes: ['id', 'originalName', 'mimeType', 'size', 'path'], required: false }
    ],
    order: [['title', 'ASC']]
  });

  const pages = allPages.filter(page => canAccessPage(page, userRoleIds, isAdmin));

  // Хлебные крошки со slug — чтобы фронт мог собрать URL папки
  let breadcrumbs = [];
  if (parentId) {
    let currentFolder = await Folder.findByPk(parentId);
    while (currentFolder) {
      breadcrumbs.unshift({ id: currentFolder.id, title: currentFolder.title, slug: currentFolder.slug });
      currentFolder = currentFolder.parentId ? await Folder.findByPk(currentFolder.parentId) : null;
    }
  }

  const foldersWithCounts = await Promise.all(folders.map(async (folder) => {
    const [childCount, pageCount] = await Promise.all([
      Folder.count({ where: { parentId: folder.id } }),
      Page.count({ where: { folderId: folder.id } }),
    ]);
    return { ...folder.toJSON(), childCount, pageCount };
  }));

  return { type: 'folder', folderId: parentId || null, folders: foldersWithCounts, pages, breadcrumbs };
}


// Получить содержимое папки (или корня) по ID
router.get('/browse', authenticate, async (req, res) => {
  try {
    const { parentId } = req.query;
    const result = await getFolderContents(parentId, req);
    res.json(result);
  } catch (error) {
    console.error('Browse folders error:', error);
    res.status(500).json({ error: 'Failed to browse folders' });
  }
});

// Получить содержимое папки по slug-пути (например ?path=marketing/reports).
// Нужно для постоянных ссылок на папки.
router.get('/resolve', authenticate, async (req, res) => {
  try {
    const raw = String(req.query.path || '').trim();
    const segments = raw.split('/').map(s => s.trim()).filter(Boolean);

    if (!segments.length) {
      // Пустой путь — корень
      return res.json(await getFolderContents(null, req));
    }

    const userRoleIds = req.user.roles?.map(r => r.id) || [];
    const isAdmin = req.user.isAdmin;

    // Идём по сегментам сверху вниз, сопоставляя slug + parentId.
    // Последний сегмент может оказаться не папкой, а страницей.
    let parentId = null;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const folder = await Folder.findOne({ where: { parentId: parentId || null, slug: segment } });

      if (folder) {
        if (!canAccessFolder(folder, userRoleIds, isAdmin)) {
          return res.status(404).json({ error: 'Folder not found' });
        }
        parentId = folder.id;
        continue;
      }

      // Не папка. Если это последний сегмент — пробуем страницу в текущей папке.
      if (isLast) {
        const page = await Page.findOne({ where: { slug: segment, folderId: parentId || null } });
        if (page && canAccessPage(page, userRoleIds, isAdmin)) {
          return res.json({ type: 'page', pageSlug: page.slug });
        }
      }
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(await getFolderContents(parentId, req));
  } catch (error) {
    console.error('Resolve folder path error:', error);
    res.status(500).json({ error: 'Failed to resolve folder path' });
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

    const { title, icon, parentId, description, allowedRoles } = req.body;

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

    const slug = await uniqueFolderSlug(title, parentId);

    const folder = await Folder.create({
      title,
      slug,
      icon: icon || 'folder',
      parentId: parentId || null,
      description,
      allowedRoles: allowedRoles || [],
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

    const { title, icon, parentId, description, sortOrder, allowedRoles } = req.body;

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

    // При смене родителя slug может конфликтовать с сестринской папкой —
    // перегенерируем уникальный в пределах нового родителя.
    let nextSlug;
    if (parentId !== undefined && (parentId || null) !== folder.parentId) {
      nextSlug = await uniqueFolderSlug(folder.slug || title || folder.title, parentId, folder.id);
    }

    await folder.update({
      ...(title && { title }),
      ...(nextSlug && { slug: nextSlug }),
      ...(icon !== undefined && { icon }),
      ...(parentId !== undefined && { parentId: parentId || null }),
      ...(description !== undefined && { description }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(allowedRoles !== undefined && { allowedRoles: allowedRoles || [] })
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
        const target = item.targetFolderId || null;
        const update = { parentId: target };
        if (target !== folder.parentId) {
          update.slug = await uniqueFolderSlug(folder.slug || folder.title, target, folder.id);
        }
        await folder.update(update);
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