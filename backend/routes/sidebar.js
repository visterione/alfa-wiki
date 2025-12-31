const express = require('express');
const { body, validationResult } = require('express-validator');
const { SidebarItem, Page, Folder } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get sidebar items for display (filtered by user role)
router.get('/', authenticate, async (req, res) => {
  try {
    const items = await SidebarItem.findAll({
      where: { parentId: null },
      include: [
        { model: Page, as: 'page', attributes: ['id', 'slug', 'title', 'icon', 'isPublished', 'createdBy'] },
        { 
          model: Folder, 
          as: 'folder', 
          attributes: ['id', 'title', 'icon'],
          include: [{ 
            model: Page, 
            as: 'pages', 
            attributes: ['id', 'slug', 'title', 'icon', 'isPublished', 'sortOrder'],
            order: [['sortOrder', 'ASC']]
          }]
        },
        { 
          model: SidebarItem, 
          as: 'children',
          include: [
            { model: Page, as: 'page', attributes: ['id', 'slug', 'title', 'icon', 'isPublished', 'createdBy'] }
          ],
          separate: true,
          order: [['sortOrder', 'ASC']]
        }
      ],
      order: [['sortOrder', 'ASC']]
    });

    // Filter by role and visibility
    const filterItems = (items, parentHidden = false) => {
      return items.filter(item => {
        if (parentHidden || !item.isVisible) return false;
        
        // Role check
        if (!req.user.isAdmin && item.allowedRoles?.length > 0) {
          if (!item.allowedRoles.includes(req.user.roleId)) return false;
        }
        
        // Draft check for pages
        if (item.type === 'page' && item.page && !item.page.isPublished) {
          const canView = req.user.isAdmin || 
                          item.page.createdBy === req.user.id ||
                          req.user.permissions?.pages?.write;
          if (!canView) return false;
        }
        
        return true;
      }).map(item => {
        const data = item.toJSON ? item.toJSON() : { ...item };
        
        // Для папки из проводника - подставляем страницы как children
        if (data.type === 'folder' && data.folder?.pages) {
          data.folderPages = data.folder.pages
            .filter(p => p.isPublished || req.user.isAdmin)
            .sort((a, b) => a.sortOrder - b.sortOrder);
        }
        
        if (data.children?.length > 0) {
          data.children = filterItems(data.children);
        }
        
        return data;
      });
    };

    res.json(filterItems(items));
  } catch (error) {
    console.error('Get sidebar error:', error);
    res.status(500).json({ error: 'Failed to fetch sidebar' });
  }
});

// Get all sidebar items (admin)
router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const items = await SidebarItem.findAll({
      where: { parentId: null },
      include: [
        { model: Page, as: 'page', attributes: ['id', 'slug', 'title', 'icon'] },
        { 
          model: Folder, 
          as: 'folder', 
          attributes: ['id', 'title', 'icon'],
          include: [{ 
            model: Page, 
            as: 'pages', 
            attributes: ['id', 'slug', 'title', 'icon', 'sortOrder']
          }]
        },
        { 
          model: SidebarItem, 
          as: 'children',
          include: [{ model: Page, as: 'page', attributes: ['id', 'slug', 'title', 'icon'] }],
          separate: true,
          order: [['sortOrder', 'ASC']]
        }
      ],
      order: [['sortOrder', 'ASC']]
    });
    res.json(items);
  } catch (error) {
    console.error('Get all sidebar error:', error);
    res.status(500).json({ error: 'Failed to fetch sidebar items' });
  }
});

// Create sidebar item
router.post('/', authenticate, requireAdmin, [
  body('type').isIn(['page', 'folder', 'header', 'link', 'divider']).withMessage('Invalid type'),
  body('title').if(body('type').isIn(['header', 'link'])).notEmpty().withMessage('Title required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { type, title, icon, pageId, folderId, externalUrl, parentId, sortOrder, allowedRoles, isVisible } = req.body;

    // Validation
    if (type === 'page' && !pageId) {
      return res.status(400).json({ error: 'Выберите страницу' });
    }
    if (type === 'folder' && !folderId) {
      return res.status(400).json({ error: 'Выберите папку' });
    }
    if (type === 'link' && !externalUrl) {
      return res.status(400).json({ error: 'Введите URL' });
    }

    // Get max sort order
    let order = sortOrder;
    if (order === undefined) {
      const maxOrder = await SidebarItem.max('sortOrder', { where: { parentId: parentId || null } });
      order = (maxOrder || 0) + 1;
    }

    const item = await SidebarItem.create({
      type,
      title: title || null,
      icon: icon || null,
      pageId: type === 'page' ? pageId : null,
      folderId: type === 'folder' ? folderId : null,
      externalUrl: type === 'link' ? externalUrl : null,
      parentId: parentId || null,
      sortOrder: order,
      allowedRoles: allowedRoles || [],
      isVisible: isVisible !== false
    });

    const created = await SidebarItem.findByPk(item.id, {
      include: [
        { model: Page, as: 'page', attributes: ['id', 'slug', 'title', 'icon'] },
        { model: Folder, as: 'folder', attributes: ['id', 'title', 'icon'] }
      ]
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create sidebar item error:', error);
    res.status(500).json({ error: 'Failed to create sidebar item' });
  }
});

// Update sidebar item
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const item = await SidebarItem.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Sidebar item not found' });
    }

    const { type, title, icon, pageId, folderId, externalUrl, parentId, sortOrder, allowedRoles, isVisible, isExpanded } = req.body;

    await item.update({
      ...(type && { type }),
      ...(title !== undefined && { title }),
      ...(icon !== undefined && { icon }),
      ...(pageId !== undefined && { pageId }),
      ...(folderId !== undefined && { folderId }),
      ...(externalUrl !== undefined && { externalUrl }),
      ...(parentId !== undefined && { parentId: parentId || null }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(allowedRoles && { allowedRoles }),
      ...(isVisible !== undefined && { isVisible }),
      ...(isExpanded !== undefined && { isExpanded })
    });

    const updated = await SidebarItem.findByPk(item.id, {
      include: [
        { model: Page, as: 'page', attributes: ['id', 'slug', 'title', 'icon'] },
        { model: Folder, as: 'folder', attributes: ['id', 'title', 'icon'] }
      ]
    });

    res.json(updated);
  } catch (error) {
    console.error('Update sidebar item error:', error);
    res.status(500).json({ error: 'Failed to update sidebar item' });
  }
});

// Reorder sidebar items
router.post('/reorder', authenticate, requireAdmin, async (req, res) => {
  try {
    const { items } = req.body;
    
    for (const item of items) {
      await SidebarItem.update(
        { sortOrder: item.sortOrder, parentId: item.parentId || null },
        { where: { id: item.id } }
      );
    }

    res.json({ message: 'Reorder successful' });
  } catch (error) {
    console.error('Reorder sidebar error:', error);
    res.status(500).json({ error: 'Failed to reorder sidebar' });
  }
});

// Reorder pages within a folder (for sidebar display)
router.post('/reorder-folder-pages', authenticate, requireAdmin, async (req, res) => {
  try {
    const { folderId, pages } = req.body; // pages: [{ id, sortOrder }]
    
    for (const page of pages) {
      await Page.update(
        { sortOrder: page.sortOrder },
        { where: { id: page.id, folderId } }
      );
    }

    res.json({ message: 'Folder pages reordered' });
  } catch (error) {
    console.error('Reorder folder pages error:', error);
    res.status(500).json({ error: 'Failed to reorder folder pages' });
  }
});

// Delete sidebar item
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const item = await SidebarItem.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Sidebar item not found' });
    }

    // Delete children too
    await SidebarItem.destroy({ where: { parentId: item.id } });
    await item.destroy();

    res.json({ message: 'Sidebar item deleted' });
  } catch (error) {
    console.error('Delete sidebar item error:', error);
    res.status(500).json({ error: 'Failed to delete sidebar item' });
  }
});

module.exports = router;