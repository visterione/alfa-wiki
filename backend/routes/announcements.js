const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Announcement, User, Role, MedCenter } = require('../models');
const { authenticate } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

const ITEMS_PER_PAGE = 10;

// Проверяет, должен ли пользователь видеть объявление
function canUserSeeAnnouncement(announcement, currentUser) {
  // Администраторы видят все объявления
  if (currentUser.isAdmin) return true;

  const { targetRoles, targetMedCenterIds, targetUserIds } = announcement;

  const isForAll = targetRoles.length === 0 && targetMedCenterIds.length === 0 && targetUserIds.length === 0;
  if (isForAll) return true;

  // Конкретные пользователи — всегда видят
  if (targetUserIds.length > 0 && targetUserIds.includes(currentUser.id)) return true;

  const userRoleIds = (currentUser.roles || []).map(r => r.id);
  const userMedCenterIds = (currentUser.medCenters || []).map(m => m.id);

  const rolesMatch = targetRoles.length === 0 || targetRoles.some(rId => userRoleIds.includes(rId));
  const medCentersMatch = targetMedCenterIds.length === 0 || targetMedCenterIds.some(mId => userMedCenterIds.includes(mId));

  return rolesMatch && medCentersMatch;
}

// GET /api/announcements — список объявлений для текущего пользователя
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search?.trim() || '';

    const currentUser = await User.findByPk(req.user.id, {
      include: [
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] } }
      ]
    });

    const dateOrder = req.query.order === 'asc' ? 'ASC' : 'DESC';

    const where = {};
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { body: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const allAnnouncements = await Announcement.findAll({
      where,
      include: [{ model: User, as: 'author', attributes: ['id', 'displayName', 'username', 'avatar'] }],
      order: [['pinned', 'DESC'], ['createdAt', dateOrder]]
    });

    // Фильтрация по таргетингу
    const visible = allAnnouncements.filter(a => canUserSeeAnnouncement(a, currentUser));

    const total = visible.length;
    const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
    const paginated = visible.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    res.json({ announcements: paginated, total, totalPages, page });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// POST /api/announcements — создать объявление
router.post('/', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin && !req.user.adminAccess?.announcements) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { title, body, pinned, targetRoles, targetMedCenterIds, targetUserIds } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const announcement = await Announcement.create({
      title: title.trim(),
      body: body.trim(),
      authorId: req.user.id,
      pinned: pinned || false,
      targetRoles: targetRoles || [],
      targetMedCenterIds: targetMedCenterIds || [],
      targetUserIds: targetUserIds || []
    });

    const result = await Announcement.findByPk(announcement.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'displayName', 'username', 'avatar'] }]
    });

    // Рассылаем уведомление по сокету целевым пользователям
    try {
      const allUsers = await User.findAll({
        where: { isActive: true },
        include: [
          { model: Role, as: 'roles', through: { attributes: [] } },
          { model: MedCenter, as: 'medCenters', through: { attributes: [] } }
        ],
        attributes: ['id']
      });
      const recipientIds = allUsers
        .filter(u => canUserSeeAnnouncement(result, u))
        .map(u => u.id)
        .filter(id => id !== req.user.id); // автору не показываем
      notificationService.emitAnnouncement(result, recipientIds);
    } catch (e) {
      console.error('Announcement socket emit error:', e.message);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// PUT /api/announcements/:id — редактировать объявление
router.put('/:id', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin && !req.user.adminAccess?.announcements) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const announcement = await Announcement.findByPk(req.params.id);
    if (!announcement) return res.status(404).json({ error: 'Not found' });

    const { title, body, pinned, targetRoles, targetMedCenterIds, targetUserIds } = req.body;

    await announcement.update({
      title: title?.trim() ?? announcement.title,
      body: body?.trim() ?? announcement.body,
      pinned: pinned !== undefined ? pinned : announcement.pinned,
      targetRoles: targetRoles ?? announcement.targetRoles,
      targetMedCenterIds: targetMedCenterIds ?? announcement.targetMedCenterIds,
      targetUserIds: targetUserIds ?? announcement.targetUserIds
    });

    const result = await Announcement.findByPk(announcement.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'displayName', 'username', 'avatar'] }]
    });

    res.json(result);
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

// DELETE /api/announcements/:id — удалить объявление
router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin && !req.user.adminAccess?.announcements) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const announcement = await Announcement.findByPk(req.params.id);
    if (!announcement) return res.status(404).json({ error: 'Not found' });

    await announcement.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

module.exports = router;
