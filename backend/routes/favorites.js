const express = require('express');
const { UserFavorite, Page, User } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get user's favorites
router.get('/', authenticate, async (req, res) => {
  try {
    const favorites = await UserFavorite.findAll({
      where: { userId: req.user.id },
      include: [{
        model: Page,
        as: 'page',
        attributes: ['id', 'slug', 'title', 'description', 'icon', 'isPublished', 'allowedRoles', 'updatedAt'],
        include: [
          { model: User, as: 'author', attributes: ['id', 'displayName', 'username'] }
        ]
      }],
      order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']]
    });

    // Filter out pages user doesn't have access to
    const accessibleFavorites = favorites.filter(fav => {
      if (!fav.page) return false;
      if (!fav.page.isPublished && !req.user.isAdmin) return false;
      if (req.user.isAdmin) return true;
      if (!fav.page.allowedRoles || fav.page.allowedRoles.length === 0) return true;
      return fav.page.allowedRoles.includes(req.user.roleId);
    });

    res.json(accessibleFavorites);
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// Check if page is in favorites
router.get('/check/:pageId', authenticate, async (req, res) => {
  try {
    const favorite = await UserFavorite.findOne({
      where: { 
        userId: req.user.id, 
        pageId: req.params.pageId 
      }
    });
    res.json({ isFavorite: !!favorite });
  } catch (error) {
    console.error('Check favorite error:', error);
    res.status(500).json({ error: 'Failed to check favorite status' });
  }
});

// Add to favorites
router.post('/:pageId', authenticate, async (req, res) => {
  try {
    const { pageId } = req.params;

    // Check if page exists
    const page = await Page.findByPk(pageId);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // Check if already in favorites
    const existing = await UserFavorite.findOne({
      where: { userId: req.user.id, pageId }
    });

    if (existing) {
      return res.json({ isFavorite: true, message: 'Already in favorites' });
    }

    // Get max sortOrder
    const maxOrder = await UserFavorite.max('sortOrder', {
      where: { userId: req.user.id }
    });

    await UserFavorite.create({
      userId: req.user.id,
      pageId,
      sortOrder: (maxOrder || 0) + 1
    });

    res.json({ isFavorite: true, message: 'Added to favorites' });
  } catch (error) {
    console.error('Add favorite error:', error);
    res.status(500).json({ error: 'Failed to add to favorites' });
  }
});

// Remove from favorites
router.delete('/:pageId', authenticate, async (req, res) => {
  try {
    const { pageId } = req.params;

    const deleted = await UserFavorite.destroy({
      where: { 
        userId: req.user.id, 
        pageId 
      }
    });

    if (deleted === 0) {
      return res.status(404).json({ error: 'Favorite not found' });
    }

    res.json({ isFavorite: false, message: 'Removed from favorites' });
  } catch (error) {
    console.error('Remove favorite error:', error);
    res.status(500).json({ error: 'Failed to remove from favorites' });
  }
});

// Toggle favorite
router.post('/:pageId/toggle', authenticate, async (req, res) => {
  try {
    const { pageId } = req.params;

    // Check if page exists
    const page = await Page.findByPk(pageId);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // Check if in favorites
    const existing = await UserFavorite.findOne({
      where: { userId: req.user.id, pageId }
    });

    if (existing) {
      await existing.destroy();
      res.json({ isFavorite: false });
    } else {
      const maxOrder = await UserFavorite.max('sortOrder', {
        where: { userId: req.user.id }
      });
      
      await UserFavorite.create({
        userId: req.user.id,
        pageId,
        sortOrder: (maxOrder || 0) + 1
      });
      res.json({ isFavorite: true });
    }
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Reorder favorites
router.put('/reorder', authenticate, async (req, res) => {
  try {
    const { order } = req.body; // Array of pageIds in new order

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'Order must be an array' });
    }

    // Update sort order for each favorite
    await Promise.all(
      order.map((pageId, index) => 
        UserFavorite.update(
          { sortOrder: index },
          { where: { userId: req.user.id, pageId } }
        )
      )
    );

    res.json({ message: 'Order updated' });
  } catch (error) {
    console.error('Reorder favorites error:', error);
    res.status(500).json({ error: 'Failed to reorder favorites' });
  }
});

module.exports = router;