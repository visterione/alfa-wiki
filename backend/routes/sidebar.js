const express = require('express');
const { body, validationResult } = require('express-validator');
const { SidebarItem, Page } = require('../models');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get sidebar items (filtered by user role)
router.get('/', authenticate, async (req, res) => {
  try {
    const items = await SidebarItem.findAll({
      where: { parentId: null },
      include: [
        { model: Page, as: 'page', attributes: ['id', 'slug', 'title', 'isPublished'] },
        { 
          model: SidebarItem, 
          as: 'children',
          include: [{ model: Page, as: 'page', attributes: ['id', 'slug', 'title', 'isPublished'] }],
          order: [['sortOrder', 'ASC']]
        }
      ],
      order: [['sortOrder', 'ASC']]
    });

    // Filter by role access
    const filterByRole = (items) => {
      return items.filter(item => {
        if (!item.isVisible) return false;
        if (req.user.isAdmin) return true;
        if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
        return item.allowedRoles.includes(req.user.roleId);
      }).map(item => {
        if (item.children) {
          item.children = filterByRole(item.children);
        }
        return item;
      });
    };

    res.json(filterByRole(items));
  } catch (error) {
    console.error('Get sidebar error:', error);
    res.status(500).json({ error: 'Failed to fetch sidebar' });
  }
});

// Get all sidebar items (admin)
router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const items = await SidebarItem.findAll({
      include: [
        { model: Page, as: 'page', attributes: ['id', 'slug', 'title'] },
        { model: SidebarItem, as: 'children' }
      ],
      order: [['sortOrder', 'ASC']]
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sidebar items' });
  }
});

// Create sidebar item
router.post('/', authenticate, requireAdmin, [
  body('type').isIn(['page', 'divider', 'link', 'header']).withMessage('Invalid type'),
  body('title').if(body('type').not().equals('divider')).notEmpty().withMessage('Title required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { type, title, icon, pageId, externalUrl, parentId, sortOrder, allowedRoles, isVisible } = req.body;

    // Get max sort order if not provided
    let order = sortOrder;
    if (order === undefined) {
      const maxOrder = await SidebarItem.max('sortOrder', { where: { parentId: parentId || null } });
      order = (maxOrder || 0) + 1;
    }

    const item = await SidebarItem.create({
      type,
      title,
      icon,
      pageId: type === 'page' ? pageId : null,
      externalUrl: type === 'link' ? externalUrl : null,
      parentId,
      sortOrder: order,
      allowedRoles: allowedRoles || [],
      isVisible: isVisible !== false
    });

    const created = await SidebarItem.findByPk(item.id, {
      include: [{ model: Page, as: 'page', attributes: ['id', 'slug', 'title'] }]
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

    const { type, title, icon, pageId, externalUrl, parentId, sortOrder, allowedRoles, isVisible, isExpanded } = req.body;

    await item.update({
      ...(type && { type }),
      ...(title !== undefined && { title }),
      ...(icon !== undefined && { icon }),
      ...(pageId !== undefined && { pageId }),
      ...(externalUrl !== undefined && { externalUrl }),
      ...(parentId !== undefined && { parentId }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(allowedRoles && { allowedRoles }),
      ...(isVisible !== undefined && { isVisible }),
      ...(isExpanded !== undefined && { isExpanded })
    });

    const updated = await SidebarItem.findByPk(item.id, {
      include: [{ model: Page, as: 'page', attributes: ['id', 'slug', 'title'] }]
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
    const { items } = req.body; // Array of { id, sortOrder, parentId }
    
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

// Delete sidebar item
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const item = await SidebarItem.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Sidebar item not found' });
    }

    // Also delete children
    await SidebarItem.destroy({ where: { parentId: item.id } });
    await item.destroy();

    res.json({ message: 'Sidebar item deleted' });
  } catch (error) {
    console.error('Delete sidebar item error:', error);
    res.status(500).json({ error: 'Failed to delete sidebar item' });
  }
});

module.exports = router;