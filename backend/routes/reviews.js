const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const {
  Review,
  ReviewBoard,
  ReviewBoardPermission,
  ReviewBoardRole,
  ReviewPlatform,
  ReviewHistory,
  User
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { Op, Sequelize } = require('sequelize');
const {
  REVIEW_STATUSES,
  DECISION_CATEGORIES,
  REVIEW_ROLES,
  HISTORY_ACTIONS,
  isValidTransition,
  getStatusById
} = require('../config/reviewStatuses');

// ============================================================================
// MULTER CONFIGURATION
// ============================================================================

const decodeFileName = (filename) => {
  try {
    return Buffer.from(filename, 'latin1').toString('utf8');
  } catch (e) {
    return filename;
  }
};

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'reviews', new Date().toISOString().slice(0, 7));
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/ogg',
    'audio/mpeg', 'audio/ogg', 'audio/wav',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed'
  ];

  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Неподдерживаемый тип файла'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Проверка прав доступа к доске отзывов
 */
async function checkReviewBoardAccess(board, userId, requiredRole = 'viewer') {
  // Владелец имеет полный доступ
  if (board.ownerId === userId) {
    return { role: 'owner', hasAccess: true };
  }

  // Проверяем разрешения
  const permission = await ReviewBoardPermission.findOne({
    where: { boardId: board.id, userId: userId }
  });

  if (!permission) {
    return null;
  }

  const roleHierarchy = { viewer: 1, editor: 2, owner: 3 };
  const hasAccess = roleHierarchy[permission.role] >= roleHierarchy[requiredRole];

  return { role: permission.role, hasAccess };
}

/**
 * Получение данных пользователей по массиву ID
 */
async function getUsersData(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return [];
  }

  const users = await User.findAll({
    where: { id: userIds },
    attributes: ['id', 'displayName', 'username', 'avatar']
  });

  return users;
}

/**
 * Получение пользователей для уведомлений на основе настроек доски
 */
async function getNotificationRecipients(board, eventType) {
  const settings = board.notificationSettings || {};
  const eventSettings = settings[eventType] || { roles: [], users: [] };

  const recipientIds = new Set(eventSettings.users || []);

  // Получаем пользователей с указанными ролями
  if (eventSettings.roles && eventSettings.roles.length > 0) {
    const roleUsers = await ReviewBoardRole.findAll({
      where: {
        boardId: board.id,
        roleName: { [Op.in]: eventSettings.roles }
      }
    });
    roleUsers.forEach(ru => recipientIds.add(ru.userId));
  }

  return Array.from(recipientIds);
}

/**
 * Добавление записи в историю отзыва
 */
async function addHistoryEntry(reviewId, userId, action, data = {}) {
  return await ReviewHistory.create({
    reviewId,
    userId,
    action,
    oldValue: data.oldValue || null,
    newValue: data.newValue || null,
    comment: data.comment || null,
    attachments: data.attachments || []
  });
}

// ============================================================================
// PLATFORMS ROUTES
// ============================================================================

/**
 * GET /api/reviews/platforms
 * Получение списка площадок
 */
router.get('/platforms', authenticate, async (req, res) => {
  try {
    const platforms = await ReviewPlatform.findAll({
      where: { isActive: true },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json(platforms);
  } catch (error) {
    console.error('Error fetching platforms:', error);
    res.status(500).json({ error: 'Ошибка при получении списка площадок' });
  }
});

/**
 * POST /api/reviews/platforms
 * Создание площадки (только админ)
 */
router.post('/platforms', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Только администраторы могут создавать площадки' });
    }

    const { name, sortOrder } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Название площадки обязательно' });
    }

    const platform = await ReviewPlatform.create({
      name,
      sortOrder: sortOrder || 0,
      isActive: true
    });

    res.status(201).json(platform);
  } catch (error) {
    console.error('Error creating platform:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Площадка с таким названием уже существует' });
    }
    res.status(500).json({ error: 'Ошибка при создании площадки' });
  }
});

/**
 * PUT /api/reviews/platforms/:id
 * Обновление площадки (только админ)
 */
router.put('/platforms/:id', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Только администраторы могут редактировать площадки' });
    }

    const platform = await ReviewPlatform.findByPk(req.params.id);
    if (!platform) {
      return res.status(404).json({ error: 'Площадка не найдена' });
    }

    const { name, sortOrder, isActive } = req.body;
    await platform.update({
      name: name !== undefined ? name : platform.name,
      sortOrder: sortOrder !== undefined ? sortOrder : platform.sortOrder,
      isActive: isActive !== undefined ? isActive : platform.isActive
    });

    res.json(platform);
  } catch (error) {
    console.error('Error updating platform:', error);
    res.status(500).json({ error: 'Ошибка при обновлении площадки' });
  }
});

/**
 * DELETE /api/reviews/platforms/:id
 * Удаление площадки (только админ)
 */
router.delete('/platforms/:id', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Только администраторы могут удалять площадки' });
    }

    const platform = await ReviewPlatform.findByPk(req.params.id);
    if (!platform) {
      return res.status(404).json({ error: 'Площадка не найдена' });
    }

    // Проверяем, используется ли площадка
    const reviewsCount = await Review.count({ where: { platformId: platform.id } });
    if (reviewsCount > 0) {
      // Деактивируем вместо удаления
      await platform.update({ isActive: false });
      return res.json({ message: 'Площадка деактивирована (есть связанные отзывы)' });
    }

    await platform.destroy();
    res.json({ message: 'Площадка удалена' });
  } catch (error) {
    console.error('Error deleting platform:', error);
    res.status(500).json({ error: 'Ошибка при удалении площадки' });
  }
});

// ============================================================================
// BOARDS ROUTES
// ============================================================================

/**
 * GET /api/reviews/boards
 * Получение списка досок пользователя
 */
router.get('/boards', authenticate, async (req, res) => {
  try {
    // Получаем доски, где пользователь владелец или есть разрешения
    const ownedBoards = await ReviewBoard.findAll({
      where: { ownerId: req.user.id, archived: false },
      include: [
        { model: User, as: 'owner', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    const permissions = await ReviewBoardPermission.findAll({
      where: { userId: req.user.id },
      include: [
        {
          model: ReviewBoard,
          as: 'board',
          where: { archived: false },
          include: [
            { model: User, as: 'owner', attributes: ['id', 'displayName', 'username', 'avatar'] }
          ]
        }
      ]
    });

    // Объединяем и добавляем роль пользователя
    const boardsMap = new Map();

    ownedBoards.forEach(board => {
      boardsMap.set(board.id, {
        ...board.toJSON(),
        userRole: 'owner'
      });
    });

    permissions.forEach(perm => {
      if (!boardsMap.has(perm.board.id)) {
        boardsMap.set(perm.board.id, {
          ...perm.board.toJSON(),
          userRole: perm.role
        });
      }
    });

    // Добавляем статистику для каждой доски (считаем ВСЕ отзывы, включая архивные)
    const boards = await Promise.all(
      Array.from(boardsMap.values()).map(async (board) => {
        const reviewCount = await Review.count({
          where: { boardId: board.id }
        });
        const avgRating = await Review.findOne({
          where: { boardId: board.id },
          attributes: [[Sequelize.fn('AVG', Sequelize.col('rating')), 'avgRating']]
        });

        return {
          ...board,
          reviewCount,
          avgRating: avgRating?.dataValues?.avgRating
            ? parseFloat(avgRating.dataValues.avgRating).toFixed(1)
            : null
        };
      })
    );

    res.json(boards);
  } catch (error) {
    console.error('Error fetching boards:', error);
    res.status(500).json({ error: 'Ошибка при получении досок' });
  }
});

/**
 * POST /api/reviews/boards
 * Создание новой доски
 */
router.post('/boards', authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Название доски обязательно' });
    }

    const board = await ReviewBoard.create({
      name: name.trim(),
      description: description || null,
      ownerId: req.user.id
    });

    // Добавляем владельца в permissions
    await ReviewBoardPermission.create({
      boardId: board.id,
      userId: req.user.id,
      role: 'owner'
    });

    const result = await ReviewBoard.findByPk(board.id, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    res.status(201).json({ ...result.toJSON(), userRole: 'owner' });
  } catch (error) {
    console.error('Error creating board:', error);
    res.status(500).json({ error: 'Ошибка при создании доски' });
  }
});

/**
 * GET /api/reviews/boards/:id
 * Получение доски по ID
 */
router.get('/boards/:id', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    const access = await checkReviewBoardAccess(board, req.user.id);
    if (!access) {
      return res.status(403).json({ error: 'Нет доступа к этой доске' });
    }

    // Статистика (считаем ВСЕ отзывы, включая архивные)
    const reviewCount = await Review.count({ where: { boardId: board.id } });
    const avgRating = await Review.findOne({
      where: { boardId: board.id },
      attributes: [[Sequelize.fn('AVG', Sequelize.col('rating')), 'avgRating']]
    });

    res.json({
      ...board.toJSON(),
      userRole: access.role,
      reviewCount,
      avgRating: avgRating?.dataValues?.avgRating
        ? parseFloat(avgRating.dataValues.avgRating).toFixed(1)
        : null
    });
  } catch (error) {
    console.error('Error fetching board:', error);
    res.status(500).json({ error: 'Ошибка при получении доски' });
  }
});

/**
 * PUT /api/reviews/boards/:id
 * Обновление доски (только владелец)
 */
router.put('/boards/:id', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может редактировать доску' });
    }

    const { name, description, archived } = req.body;
    await board.update({
      name: name !== undefined ? name.trim() : board.name,
      description: description !== undefined ? description : board.description,
      archived: archived !== undefined ? archived : board.archived
    });

    res.json(board);
  } catch (error) {
    console.error('Error updating board:', error);
    res.status(500).json({ error: 'Ошибка при обновлении доски' });
  }
});

/**
 * DELETE /api/reviews/boards/:id
 * Удаление доски (только владелец)
 */
router.delete('/boards/:id', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может удалить доску' });
    }

    await board.destroy();
    res.json({ message: 'Доска удалена' });
  } catch (error) {
    console.error('Error deleting board:', error);
    res.status(500).json({ error: 'Ошибка при удалении доски' });
  }
});

// ============================================================================
// BOARD PERMISSIONS ROUTES
// ============================================================================

/**
 * GET /api/reviews/boards/:id/permissions
 * Получение прав доступа к доске
 */
router.get('/boards/:id/permissions', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может просматривать права доступа' });
    }

    const permissions = await ReviewBoardPermission.findAll({
      where: { boardId: board.id },
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    res.json(permissions);
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ error: 'Ошибка при получении прав доступа' });
  }
});

/**
 * POST /api/reviews/boards/:id/permissions
 * Добавление пользователя к доске
 */
router.post('/boards/:id/permissions', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может управлять доступом' });
    }

    const { userId, role } = req.body;
    if (!userId || !role) {
      return res.status(400).json({ error: 'userId и role обязательны' });
    }

    if (!['viewer', 'editor'].includes(role)) {
      return res.status(400).json({ error: 'Недопустимая роль' });
    }

    // Проверяем, что пользователь существует
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Проверяем, нет ли уже разрешения
    const existing = await ReviewBoardPermission.findOne({
      where: { boardId: board.id, userId }
    });

    if (existing) {
      return res.status(400).json({ error: 'У пользователя уже есть доступ к этой доске' });
    }

    const permission = await ReviewBoardPermission.create({
      boardId: board.id,
      userId,
      role
    });

    const result = await ReviewBoardPermission.findByPk(permission.id, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding permission:', error);
    res.status(500).json({ error: 'Ошибка при добавлении прав доступа' });
  }
});

/**
 * PUT /api/reviews/boards/:boardId/permissions/:permId
 * Изменение роли пользователя
 */
router.put('/boards/:boardId/permissions/:permId', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.boardId);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может управлять доступом' });
    }

    const permission = await ReviewBoardPermission.findByPk(req.params.permId);
    if (!permission || permission.boardId !== board.id) {
      return res.status(404).json({ error: 'Разрешение не найдено' });
    }

    const { role } = req.body;
    if (!['viewer', 'editor'].includes(role)) {
      return res.status(400).json({ error: 'Недопустимая роль' });
    }

    await permission.update({ role });

    const result = await ReviewBoardPermission.findByPk(permission.id, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    res.json(result);
  } catch (error) {
    console.error('Error updating permission:', error);
    res.status(500).json({ error: 'Ошибка при обновлении прав доступа' });
  }
});

/**
 * DELETE /api/reviews/boards/:boardId/permissions/:permId
 * Удаление доступа пользователя
 */
router.delete('/boards/:boardId/permissions/:permId', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.boardId);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может управлять доступом' });
    }

    const permission = await ReviewBoardPermission.findByPk(req.params.permId);
    if (!permission || permission.boardId !== board.id) {
      return res.status(404).json({ error: 'Разрешение не найдено' });
    }

    // Нельзя удалить владельца
    if (permission.role === 'owner') {
      return res.status(400).json({ error: 'Нельзя удалить владельца доски' });
    }

    await permission.destroy();
    res.json({ message: 'Доступ удален' });
  } catch (error) {
    console.error('Error deleting permission:', error);
    res.status(500).json({ error: 'Ошибка при удалении прав доступа' });
  }
});

// ============================================================================
// BOARD ROLES ROUTES
// ============================================================================

/**
 * GET /api/reviews/boards/:id/roles
 * Получение ролей доски
 */
router.get('/boards/:id/roles', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    const access = await checkReviewBoardAccess(board, req.user.id);
    if (!access) {
      return res.status(403).json({ error: 'Нет доступа к этой доске' });
    }

    const roles = await ReviewBoardRole.findAll({
      where: { boardId: board.id },
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    // Группируем по ролям
    const groupedRoles = {};
    REVIEW_ROLES.forEach(r => {
      groupedRoles[r.id] = {
        ...r,
        users: roles.filter(role => role.roleName === r.id).map(role => ({
          id: role.id,
          user: role.user
        }))
      };
    });

    res.json(groupedRoles);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Ошибка при получении ролей' });
  }
});

/**
 * POST /api/reviews/boards/:id/roles
 * Назначение пользователя на роль
 */
router.post('/boards/:id/roles', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может назначать роли' });
    }

    const { userId, roleName } = req.body;
    if (!userId || !roleName) {
      return res.status(400).json({ error: 'userId и roleName обязательны' });
    }

    if (!REVIEW_ROLES.find(r => r.id === roleName)) {
      return res.status(400).json({ error: 'Недопустимая роль' });
    }

    // Проверяем существование пользователя
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Проверяем, нет ли уже такого назначения
    const existing = await ReviewBoardRole.findOne({
      where: { boardId: board.id, userId, roleName }
    });

    if (existing) {
      return res.status(400).json({ error: 'Пользователь уже имеет эту роль' });
    }

    const role = await ReviewBoardRole.create({
      boardId: board.id,
      userId,
      roleName
    });

    const result = await ReviewBoardRole.findByPk(role.id, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding role:', error);
    res.status(500).json({ error: 'Ошибка при назначении роли' });
  }
});

/**
 * DELETE /api/reviews/boards/:boardId/roles/:roleId
 * Удаление роли пользователя
 */
router.delete('/boards/:boardId/roles/:roleId', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.boardId);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может управлять ролями' });
    }

    const role = await ReviewBoardRole.findByPk(req.params.roleId);
    if (!role || role.boardId !== board.id) {
      return res.status(404).json({ error: 'Роль не найдена' });
    }

    await role.destroy();
    res.json({ message: 'Роль удалена' });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({ error: 'Ошибка при удалении роли' });
  }
});

// ============================================================================
// BOARD SETTINGS ROUTES
// ============================================================================

/**
 * GET /api/reviews/boards/:id/settings
 * Получение настроек уведомлений доски
 */
router.get('/boards/:id/settings', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может просматривать настройки' });
    }

    res.json({
      notificationSettings: board.notificationSettings,
      availableRoles: REVIEW_ROLES
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Ошибка при получении настроек' });
  }
});

/**
 * PUT /api/reviews/boards/:id/settings
 * Обновление настроек уведомлений доски
 */
router.put('/boards/:id/settings', authenticate, async (req, res) => {
  try {
    const board = await ReviewBoard.findByPk(req.params.id);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    if (board.ownerId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Только владелец может изменять настройки' });
    }

    const { notificationSettings } = req.body;
    await board.update({ notificationSettings });

    res.json({ notificationSettings: board.notificationSettings });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Ошибка при обновлении настроек' });
  }
});

// ============================================================================
// STATIC ROUTES (MUST BE BEFORE /:id ROUTES)
// ============================================================================

/**
 * GET /api/reviews/archive
 * Универсальный архив со всех досок
 */
router.get('/archive', authenticate, async (req, res) => {
  try {
    const { boardId, platformId, rating, doctor, dateFrom, dateTo, search, page = 1, limit = 20 } = req.query;

    // Получаем доски, к которым есть доступ
    const ownedBoardIds = (await ReviewBoard.findAll({
      where: { ownerId: req.user.id },
      attributes: ['id']
    })).map(b => b.id);

    const permittedBoardIds = (await ReviewBoardPermission.findAll({
      where: { userId: req.user.id },
      attributes: ['boardId']
    })).map(p => p.boardId);

    const accessibleBoardIds = [...new Set([...ownedBoardIds, ...permittedBoardIds])];

    if (accessibleBoardIds.length === 0) {
      return res.json({ reviews: [], total: 0 });
    }

    // Строим условия фильтрации - показываем финализированные ИЛИ архивированные
    const where = {
      [Op.or]: [
        { status: 'final' },
        { archived: true }
      ],
      boardId: boardId ? parseInt(boardId) : { [Op.in]: accessibleBoardIds }
    };

    if (platformId) where.platformId = parseInt(platformId);
    if (rating) where.rating = parseInt(rating);
    if (doctor) where.doctorName = { [Op.iLike]: `%${doctor}%` };
    if (search) {
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push({
        [Op.or]: [
          { patientName: { [Op.iLike]: `%${search}%` } },
          { reviewText: { [Op.iLike]: `%${search}%` } },
          { doctorName: { [Op.iLike]: `%${search}%` } }
        ]
      });
    }
    if (dateFrom) where.reviewDate = { ...where.reviewDate, [Op.gte]: dateFrom };
    if (dateTo) where.reviewDate = { ...where.reviewDate, [Op.lte]: dateTo };

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows: reviews, count: total } = await Review.findAndCountAll({
      where,
      include: [
        { model: ReviewBoard, as: 'board', attributes: ['id', 'name'] },
        { model: ReviewPlatform, as: 'platform' },
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] },
        { model: User, as: 'finalizer', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ],
      order: [['finalizedAt', 'DESC'], ['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    res.json({ reviews, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('Error fetching archive:', error);
    res.status(500).json({ error: 'Ошибка при получении архива' });
  }
});

/**
 * GET /api/reviews/stats
 * Статистика по доске
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    const { boardId, from, to } = req.query;

    if (!boardId) {
      return res.status(400).json({ error: 'boardId обязателен' });
    }

    const board = await ReviewBoard.findByPk(boardId);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    const access = await checkReviewBoardAccess(board, req.user.id);
    if (!access) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Определяем период
    const dateFrom = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const dateTo = to ? new Date(to) : new Date();
    dateTo.setHours(23, 59, 59, 999);

    const whereBase = {
      boardId: parseInt(boardId),
      reviewDate: { [Op.between]: [dateFrom, dateTo] }
    };

    // Общее количество
    const total = await Review.count({ where: whereBase });

    // Средняя оценка
    const avgRatingResult = await Review.findOne({
      where: whereBase,
      attributes: [[Sequelize.fn('AVG', Sequelize.col('rating')), 'avgRating']]
    });
    const avgRating = avgRatingResult?.dataValues?.avgRating
      ? parseFloat(avgRatingResult.dataValues.avgRating)
      : null;

    // Финализированные
    const finalized = await Review.count({
      where: { ...whereBase, status: 'final' }
    });

    // В работе (не финализированы и не архивированы)
    const pending = await Review.count({
      where: {
        boardId: parseInt(boardId),
        archived: false,
        status: { [Op.ne]: 'final' }
      }
    });

    // По статусам
    const statusCounts = await Review.findAll({
      where: { boardId: parseInt(boardId), archived: false },
      attributes: [
        'status',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    const byStatus = {};
    statusCounts.forEach(s => {
      byStatus[s.status] = parseInt(s.dataValues.count);
    });

    // По площадкам
    const platformCounts = await Review.findAll({
      where: whereBase,
      attributes: [
        'platformId',
        [Sequelize.fn('COUNT', Sequelize.col('Review.id')), 'count']
      ],
      group: ['platformId']
    });

    const byPlatform = {};
    platformCounts.forEach(p => {
      byPlatform[p.platformId] = parseInt(p.dataValues.count);
    });

    // По оценкам
    const ratingCounts = await Review.findAll({
      where: whereBase,
      attributes: [
        'rating',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
      ],
      group: ['rating']
    });

    const byRating = {};
    ratingCounts.forEach(r => {
      byRating[r.rating] = parseInt(r.dataValues.count);
    });

    // По решениям
    const decisionCounts = await Review.findAll({
      where: { ...whereBase, status: 'final', decisionCategory: { [Op.ne]: null } },
      attributes: [
        'decisionCategory',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
      ],
      group: ['decisionCategory']
    });

    const decisions = {};
    decisionCounts.forEach(d => {
      decisions[d.decisionCategory] = parseInt(d.dataValues.count);
    });

    // Топ врачей
    const topDoctors = await Review.findAll({
      where: { ...whereBase, doctorName: { [Op.ne]: null } },
      attributes: [
        'doctorName',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'count'],
        [Sequelize.fn('AVG', Sequelize.col('rating')), 'avgRating']
      ],
      group: ['doctorName'],
      order: [[Sequelize.literal('count'), 'DESC']],
      limit: 10
    });

    res.json({
      total,
      avgRating,
      finalized,
      pending,
      byStatus,
      byPlatform,
      byRating,
      decisions,
      topDoctors: topDoctors.map(d => ({
        name: d.doctorName,
        count: parseInt(d.dataValues.count),
        avgRating: parseFloat(d.dataValues.avgRating)
      }))
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Ошибка при получении статистики' });
  }
});

/**
 * GET /api/reviews/doctors/suggest
 * Автодополнение врачей
 */
router.get('/doctors/suggest', authenticate, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json([]);
    }

    const doctors = await Review.findAll({
      where: {
        doctorName: { [Op.iLike]: `%${q}%` }
      },
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('doctorName')), 'doctorName']],
      limit: 10
    });

    res.json(doctors.map(d => d.doctorName).filter(Boolean));
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({ error: 'Ошибка при поиске врачей' });
  }
});

// ============================================================================
// REVIEWS ROUTES
// ============================================================================

/**
 * GET /api/reviews
 * Получение отзывов доски
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { boardId } = req.query;
    if (!boardId) {
      return res.status(400).json({ error: 'boardId обязателен' });
    }

    const board = await ReviewBoard.findByPk(boardId);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    const access = await checkReviewBoardAccess(board, req.user.id);
    if (!access) {
      return res.status(403).json({ error: 'Нет доступа к этой доске' });
    }

    const reviews = await Review.findAll({
      where: { boardId, archived: false },
      include: [
        { model: ReviewPlatform, as: 'platform' },
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ],
      order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']]
    });

    // Добавляем данные назначенных пользователей
    const reviewsWithAssignees = await Promise.all(
      reviews.map(async (review) => {
        const assignees = await getUsersData(review.assigneeIds || []);
        return {
          ...review.toJSON(),
          assignees
        };
      })
    );

    res.json(reviewsWithAssignees);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Ошибка при получении отзывов' });
  }
});

/**
 * POST /api/reviews
 * Создание отзыва
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      boardId, patientName, reviewDate, platformId,
      doctorName, rating, reviewText, additionalInfo
    } = req.body;

    // Валидация
    if (!boardId || !patientName || !reviewDate || !platformId || !rating || !reviewText) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
    }

    const board = await ReviewBoard.findByPk(boardId);
    if (!board) {
      return res.status(404).json({ error: 'Доска не найдена' });
    }

    const access = await checkReviewBoardAccess(board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на создание отзывов' });
    }

    // Проверяем площадку
    const platform = await ReviewPlatform.findByPk(platformId);
    if (!platform) {
      return res.status(404).json({ error: 'Площадка не найдена' });
    }

    // Получаем максимальный sortOrder
    const maxSortOrder = await Review.max('sortOrder', { where: { boardId, status: 'new' } }) || 0;

    const review = await Review.create({
      boardId,
      patientName: patientName.trim(),
      reviewDate,
      platformId,
      doctorName: doctorName?.trim() || null,
      rating,
      reviewText: reviewText.trim(),
      additionalInfo: additionalInfo?.trim() || null,
      status: 'new',
      createdBy: req.user.id,
      sortOrder: maxSortOrder + 1
    });

    // Добавляем запись в историю
    await addHistoryEntry(review.id, req.user.id, HISTORY_ACTIONS.CREATED);

    // Получаем полные данные отзыва
    const result = await Review.findByPk(review.id, {
      include: [
        { model: ReviewPlatform, as: 'platform' },
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    // Отправляем уведомления
    try {
      const notificationService = require('../services/notificationService');
      const recipientIds = await getNotificationRecipients(board, 'newReview');

      if (recipientIds.length > 0) {
        const ratingStars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
        const messageText = `📝 Новый отзыв на доске "${board.name}"\n\n` +
          `Пациент: ${patientName}\n` +
          `Оценка: ${ratingStars} (${rating}/5)\n` +
          `Площадка: ${platform.name}\n` +
          `${doctorName ? `Врач: ${doctorName}\n` : ''}` +
          `\n${reviewText.substring(0, 200)}${reviewText.length > 200 ? '...' : ''}`;

        for (const userId of recipientIds) {
          if (userId !== req.user.id) {
            await notificationService.sendMessageToUser(userId, messageText, {
              type: 'review_created',
              reviewId: review.id,
              boardId: board.id
            });
          }
        }
      }
    } catch (notifError) {
      console.error('Error sending notifications:', notifError);
    }

    res.status(201).json({ ...result.toJSON(), assignees: [] });
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ error: 'Ошибка при создании отзыва' });
  }
});

/**
 * GET /api/reviews/:id
 * Получение отзыва с историей
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [
        { model: ReviewBoard, as: 'board' },
        { model: ReviewPlatform, as: 'platform' },
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] },
        { model: User, as: 'finalizer', attributes: ['id', 'displayName', 'username', 'avatar'] },
        {
          model: ReviewHistory,
          as: 'history',
          include: [
            { model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }
          ],
          order: [['createdAt', 'ASC']]
        }
      ]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id);
    if (!access) {
      return res.status(403).json({ error: 'Нет доступа к этому отзыву' });
    }

    const assignees = await getUsersData(review.assigneeIds || []);

    res.json({
      ...review.toJSON(),
      assignees,
      userRole: access.role
    });
  } catch (error) {
    console.error('Error fetching review:', error);
    res.status(500).json({ error: 'Ошибка при получении отзыва' });
  }
});

/**
 * PUT /api/reviews/:id
 * Обновление отзыва
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [{ model: ReviewBoard, as: 'board' }]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на редактирование' });
    }

    // Нельзя редактировать финализированные отзывы
    if (review.status === 'final') {
      return res.status(400).json({ error: 'Нельзя редактировать финализированный отзыв' });
    }

    const {
      patientName, reviewDate, platformId,
      doctorName, rating, reviewText, additionalInfo
    } = req.body;

    await review.update({
      patientName: patientName !== undefined ? patientName.trim() : review.patientName,
      reviewDate: reviewDate !== undefined ? reviewDate : review.reviewDate,
      platformId: platformId !== undefined ? platformId : review.platformId,
      doctorName: doctorName !== undefined ? (doctorName?.trim() || null) : review.doctorName,
      rating: rating !== undefined ? rating : review.rating,
      reviewText: reviewText !== undefined ? reviewText.trim() : review.reviewText,
      additionalInfo: additionalInfo !== undefined ? (additionalInfo?.trim() || null) : review.additionalInfo
    });

    const result = await Review.findByPk(review.id, {
      include: [
        { model: ReviewPlatform, as: 'platform' },
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    const assignees = await getUsersData(review.assigneeIds || []);

    res.json({ ...result.toJSON(), assignees });
  } catch (error) {
    console.error('Error updating review:', error);
    res.status(500).json({ error: 'Ошибка при обновлении отзыва' });
  }
});

/**
 * DELETE /api/reviews/:id
 * Удаление отзыва
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [{ model: ReviewBoard, as: 'board' }]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на удаление' });
    }

    await review.destroy();
    res.json({ message: 'Отзыв удален' });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ error: 'Ошибка при удалении отзыва' });
  }
});

/**
 * POST /api/reviews/:id/move
 * Перемещение отзыва (смена статуса)
 */
router.post('/:id/move', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [{ model: ReviewBoard, as: 'board' }]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на перемещение' });
    }

    const { status, sortOrder } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'status обязателен' });
    }

    // Проверяем допустимость статуса
    const validStatus = REVIEW_STATUSES.find(s => s.id === status);
    if (!validStatus) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }

    const oldStatus = review.status;

    await review.update({
      status,
      sortOrder: sortOrder !== undefined ? sortOrder : review.sortOrder
    });

    // Добавляем запись в историю
    if (oldStatus !== status) {
      const oldStatusLabel = getStatusById(oldStatus)?.label || oldStatus;
      const newStatusLabel = validStatus.label;

      await addHistoryEntry(review.id, req.user.id, HISTORY_ACTIONS.STATUS_CHANGE, {
        oldValue: oldStatusLabel,
        newValue: newStatusLabel
      });

      // Отправляем уведомления
      try {
        const notificationService = require('../services/notificationService');
        const recipientIds = await getNotificationRecipients(review.board, 'statusChange');

        if (recipientIds.length > 0) {
          const messageText = `🔄 Изменен статус отзыва\n\n` +
            `Пациент: ${review.patientName}\n` +
            `${oldStatusLabel} → ${newStatusLabel}\n` +
            `Изменил: ${req.user.displayName || req.user.username}`;

          for (const userId of recipientIds) {
            if (userId !== req.user.id) {
              await notificationService.sendMessageToUser(userId, messageText, {
                type: 'review_status_changed',
                reviewId: review.id,
                oldStatus,
                newStatus: status
              });
            }
          }
        }
      } catch (notifError) {
        console.error('Error sending notifications:', notifError);
      }
    }

    res.json(review);
  } catch (error) {
    console.error('Error moving review:', error);
    res.status(500).json({ error: 'Ошибка при перемещении отзыва' });
  }
});

/**
 * POST /api/reviews/:id/assign
 * Назначение ответственных
 */
router.post('/:id/assign', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [{ model: ReviewBoard, as: 'board' }]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на назначение' });
    }

    const { assigneeIds } = req.body;
    if (!Array.isArray(assigneeIds)) {
      return res.status(400).json({ error: 'assigneeIds должен быть массивом' });
    }

    await review.update({ assigneeIds });

    // Добавляем запись в историю
    const assignees = await getUsersData(assigneeIds);
    const assigneeNames = assignees.map(a => a.displayName || a.username).join(', ');

    await addHistoryEntry(review.id, req.user.id, HISTORY_ACTIONS.ASSIGNMENT, {
      newValue: assigneeNames || 'Нет назначенных'
    });

    // Отправляем уведомления назначенным
    if (assigneeIds.length > 0) {
      try {
        const notificationService = require('../services/notificationService');
        const messageText = `👤 Вам назначен отзыв для обработки\n\n` +
          `Пациент: ${review.patientName}\n` +
          `Доска: ${review.board.name}\n` +
          `Назначил: ${req.user.displayName || req.user.username}\n\n` +
          `Пожалуйста, соберите необходимые сведения.`;

        for (const userId of assigneeIds) {
          if (userId !== req.user.id) {
            await notificationService.sendMessageToUser(userId, messageText, {
              type: 'review_assigned',
              reviewId: review.id,
              boardId: review.boardId
            });
          }
        }
      } catch (notifError) {
        console.error('Error sending notifications:', notifError);
      }
    }

    res.json({ ...review.toJSON(), assignees });
  } catch (error) {
    console.error('Error assigning review:', error);
    res.status(500).json({ error: 'Ошибка при назначении ответственных' });
  }
});

/**
 * POST /api/reviews/:id/comment
 * Добавление комментария/файла
 */
router.post('/:id/comment', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [{ model: ReviewBoard, as: 'board' }]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на добавление комментариев' });
    }

    const { comment, attachments } = req.body;

    if (!comment && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'Комментарий или файлы обязательны' });
    }

    // Добавляем запись в историю
    const historyEntry = await addHistoryEntry(
      review.id,
      req.user.id,
      attachments && attachments.length > 0 ? HISTORY_ACTIONS.FILE_UPLOAD : HISTORY_ACTIONS.COMMENT,
      {
        comment: comment || null,
        attachments: attachments || []
      }
    );

    // Если были файлы, добавляем их к отзыву
    if (attachments && attachments.length > 0) {
      const currentAttachments = review.attachments || [];
      await review.update({
        attachments: [...currentAttachments, ...attachments]
      });
    }

    const result = await ReviewHistory.findByPk(historyEntry.id, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Ошибка при добавлении комментария' });
  }
});

/**
 * POST /api/reviews/:id/finalize
 * Финализация отзыва с генерацией PDF
 */
router.post('/:id/finalize', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [
        { model: ReviewBoard, as: 'board' },
        { model: ReviewPlatform, as: 'platform' },
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] },
        {
          model: ReviewHistory,
          as: 'history',
          include: [
            { model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'avatar'] }
          ],
          order: [['createdAt', 'ASC']]
        }
      ]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на финализацию' });
    }

    if (review.status === 'final') {
      return res.status(400).json({ error: 'Отзыв уже финализирован' });
    }

    const { decisionCategory, decisionDescription } = req.body;

    if (!decisionCategory) {
      return res.status(400).json({ error: 'Категория решения обязательна' });
    }

    if (!DECISION_CATEGORIES.find(c => c.id === decisionCategory)) {
      return res.status(400).json({ error: 'Недопустимая категория решения' });
    }

    // Генерируем PDF
    let pdfPath = null;
    try {
      const pdfService = require('../services/pdfService');
      pdfPath = await pdfService.generateReviewPdf(review, review.board, review.history);
    } catch (pdfError) {
      console.error('Error generating PDF:', pdfError);
      // Продолжаем без PDF
    }

    // Обновляем отзыв
    await review.update({
      status: 'final',
      decisionCategory,
      decisionDescription: decisionDescription || null,
      finalizedAt: new Date(),
      finalizedBy: req.user.id,
      reportPdfPath: pdfPath
    });

    // Добавляем запись в историю
    const categoryLabel = DECISION_CATEGORIES.find(c => c.id === decisionCategory)?.label || decisionCategory;
    await addHistoryEntry(review.id, req.user.id, HISTORY_ACTIONS.FINALIZED, {
      newValue: categoryLabel,
      comment: decisionDescription
    });

    const result = await Review.findByPk(review.id, {
      include: [
        { model: ReviewPlatform, as: 'platform' },
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] },
        { model: User, as: 'finalizer', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    res.json(result);
  } catch (error) {
    console.error('Error finalizing review:', error);
    res.status(500).json({ error: 'Ошибка при финализации отзыва' });
  }
});

/**
 * GET /api/reviews/:id/pdf
 * Скачивание PDF отчета
 */
router.get('/:id/pdf', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [{ model: ReviewBoard, as: 'board' }]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id);
    if (!access) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    if (!review.reportPdfPath) {
      return res.status(404).json({ error: 'PDF отчет не найден' });
    }

    const pdfFullPath = path.join(__dirname, '..', review.reportPdfPath);

    try {
      await fs.access(pdfFullPath);
    } catch {
      return res.status(404).json({ error: 'Файл PDF не найден на сервере' });
    }

    res.download(pdfFullPath, `review-${review.id}.pdf`);
  } catch (error) {
    console.error('Error downloading PDF:', error);
    res.status(500).json({ error: 'Ошибка при скачивании PDF' });
  }
});

// ============================================================================
// ARCHIVE ROUTES
// ============================================================================

/**
 * POST /api/reviews/:id/archive
 * Архивация отзыва
 */
router.post('/:id/archive', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [{ model: ReviewBoard, as: 'board' }]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на архивацию' });
    }

    await review.update({
      archived: true,
      archivedAt: new Date()
    });

    res.json(review);
  } catch (error) {
    console.error('Error archiving review:', error);
    res.status(500).json({ error: 'Ошибка при архивации отзыва' });
  }
});

/**
 * POST /api/reviews/:id/restore
 * Восстановление из архива
 */
router.post('/:id/restore', authenticate, async (req, res) => {
  try {
    const review = await Review.findByPk(req.params.id, {
      include: [{ model: ReviewBoard, as: 'board' }]
    });

    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }

    const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ error: 'Нет прав на восстановление' });
    }

    await review.update({
      archived: false,
      archivedAt: null
    });

    res.json(review);
  } catch (error) {
    console.error('Error restoring review:', error);
    res.status(500).json({ error: 'Ошибка при восстановлении отзыва' });
  }
});

// ============================================================================
// FILE ROUTES
// ============================================================================

/**
 * POST /api/reviews/upload
 * Загрузка файла
 */
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const relativePath = path.relative(
      path.join(__dirname, '..'),
      req.file.path
    ).replace(/\\/g, '/');

    const fileData = {
      id: uuidv4(),
      filename: decodeFileName(req.file.originalname),
      path: relativePath,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user.id
    };

    res.json(fileData);
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Ошибка при загрузке файла' });
  }
});

/**
 * DELETE /api/reviews/files/:fileId
 * Удаление файла
 */
router.delete('/files/:fileId', authenticate, async (req, res) => {
  try {
    const { reviewId } = req.query;

    if (reviewId) {
      const review = await Review.findByPk(reviewId, {
        include: [{ model: ReviewBoard, as: 'board' }]
      });

      if (!review) {
        return res.status(404).json({ error: 'Отзыв не найден' });
      }

      const access = await checkReviewBoardAccess(review.board, req.user.id, 'editor');
      if (!access || !access.hasAccess) {
        return res.status(403).json({ error: 'Нет прав на удаление файлов' });
      }

      // Удаляем файл из массива attachments
      const attachments = review.attachments || [];
      const fileToDelete = attachments.find(f => f.id === req.params.fileId);

      if (fileToDelete) {
        // Удаляем физический файл
        try {
          const filePath = path.join(__dirname, '..', fileToDelete.path);
          await fs.unlink(filePath);
        } catch (e) {
          console.error('Error deleting physical file:', e);
        }

        // Обновляем массив
        await review.update({
          attachments: attachments.filter(f => f.id !== req.params.fileId)
        });
      }
    }

    res.json({ message: 'Файл удален' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Ошибка при удалении файла' });
  }
});

module.exports = router;
