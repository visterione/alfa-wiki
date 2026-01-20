const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { KanbanTask, KanbanBoard, BoardPermission, User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { Op } = require('sequelize');

// ============================================================================
// MULTER CONFIGURATION
// ============================================================================

// Функция для правильного декодирования имени файла
const decodeFileName = (filename) => {
  try {
    return Buffer.from(filename, 'latin1').toString('utf8');
  } catch (e) {
    return filename;
  }
};

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'kanban', new Date().toISOString().slice(0, 7));
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
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

/**
 * Проверка прав доступа к Канбану (устаревшая функция, оставлена для совместимости)
 */
function checkKanbanAccess(user, accessType = 'read') {
  // Админы всегда имеют полный доступ
  if (user.isAdmin) return true;

  if (accessType === 'read') {
    // Чтение доступно всем пользователям
    return true;
  }

  if (accessType === 'write') {
    // Редактирование доступно только пользователям с adminAccess.kanban === true
    return user.adminAccess?.kanban === true;
  }

  return false;
}

/**
 * Проверка прав доступа к конкретной доске
 * @param {Object} board - Объект доски
 * @param {string} userId - ID пользователя
 * @param {string} requiredRole - Требуемая роль: 'viewer', 'editor', 'owner'
 * @returns {Promise<Object|null>} - Возвращает permission объект или null
 */
async function checkBoardAccess(board, userId, requiredRole = 'viewer') {
  // Владелец имеет полный доступ
  if (board.ownerId === userId) {
    return { role: 'owner', hasAccess: true };
  }

  // Проверяем разрешения
  const permission = await BoardPermission.findOne({
    where: {
      boardId: board.id,
      userId: userId
    }
  });

  if (!permission) {
    return null;
  }

  // Проверяем достаточность прав
  const roleHierarchy = { viewer: 1, editor: 2, owner: 3 };
  const hasAccess = roleHierarchy[permission.role] >= roleHierarchy[requiredRole];

  return { role: permission.role, hasAccess };
}

/**
 * Получение данных исполнителей для задачи
 */
async function getAssigneesData(assigneeIds) {
  if (!Array.isArray(assigneeIds) || assigneeIds.length === 0) {
    return [];
  }

  const assignees = await User.findAll({
    where: { id: assigneeIds },
    attributes: ['id', 'displayName', 'username', 'avatar']
  });

  return assignees;
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/kanban/tasks
 * Получение всех задач конкретной доски
 * Требует параметр boardId
 */
router.get('/tasks', authenticate, async (req, res) => {
  try {
    const { boardId } = req.query;

    if (!boardId) {
      return res.status(400).json({ message: 'boardId обязателен' });
    }

    // Проверяем существование доски и права доступа
    const board = await KanbanBoard.findByPk(boardId);
    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    const access = await checkBoardAccess(board, req.user.id, 'viewer');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ к доске запрещен' });
    }

    const tasks = await KanbanTask.findAll({
      where: {
        boardId: boardId,
        archived: false
      },
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ],
      order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']]
    });

    // Добавляем данные исполнителей для каждой задачи
    const tasksWithAssignees = await Promise.all(tasks.map(async (task) => {
      const taskData = task.toJSON();
      taskData.assignees = await getAssigneesData(taskData.assigneeIds);
      return taskData;
    }));

    res.json(tasksWithAssignees);
  } catch (error) {
    console.error('Error fetching kanban tasks:', error);
    res.status(500).json({ message: 'Ошибка при получении задач' });
  }
});

/**
 * GET /api/kanban/tasks/:id
 * Получение одной задачи по ID
 */
router.get('/tasks/:id', authenticate, async (req, res) => {
  try {
    const task = await KanbanTask.findByPk(req.params.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] },
        { model: KanbanBoard, as: 'board' }
      ]
    });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    // Проверяем права доступа к доске
    const access = await checkBoardAccess(task.board, req.user.id, 'viewer');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ к доске запрещен' });
    }

    const taskData = task.toJSON();
    taskData.assignees = await getAssigneesData(taskData.assigneeIds);

    res.json(taskData);
  } catch (error) {
    console.error('Error fetching kanban task:', error);
    res.status(500).json({ message: 'Ошибка при получении задачи' });
  }
});

/**
 * POST /api/kanban/tasks
 * Создание новой задачи
 */
router.post('/tasks', authenticate, async (req, res) => {
  try {
    const { boardId, title, description, status, priority, assigneeIds, tags, dueDate, sortOrder, metadata, attachments } = req.body;

    if (!boardId) {
      return res.status(400).json({ message: 'boardId обязателен' });
    }

    if (!title) {
      return res.status(400).json({ message: 'Название задачи обязательно' });
    }

    // Проверяем существование доски и права доступа (editor или owner)
    const board = await KanbanBoard.findByPk(boardId);
    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    const access = await checkBoardAccess(board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Требуются права редактора.' });
    }

    const task = await KanbanTask.create({
      boardId,
      title,
      description,
      status: status || 'backlog',
      priority: priority || 'medium',
      assigneeIds: assigneeIds || [],
      createdBy: req.user.id,
      tags: tags || [],
      dueDate,
      sortOrder: sortOrder || 0,
      metadata: metadata || {},
      attachments: attachments || []
    });

    const taskWithRelations = await KanbanTask.findByPk(task.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    const taskData = taskWithRelations.toJSON();
    taskData.assignees = await getAssigneesData(taskData.assigneeIds);

    res.status(201).json(taskData);
  } catch (error) {
    console.error('Error creating kanban task:', error);
    res.status(500).json({ message: 'Ошибка при создании задачи' });
  }
});

/**
 * PUT /api/kanban/tasks/:id
 * Обновление задачи
 */
router.put('/tasks/:id', authenticate, async (req, res) => {
  try {
    const task = await KanbanTask.findByPk(req.params.id, {
      include: [{ model: KanbanBoard, as: 'board' }]
    });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    // Проверяем права доступа к доске (editor или owner)
    const access = await checkBoardAccess(task.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Требуются права редактора.' });
    }

    const { title, description, status, priority, assigneeIds, tags, dueDate, sortOrder, metadata, attachments } = req.body;

    const updateData = {
      title: title !== undefined ? title : task.title,
      description: description !== undefined ? description : task.description,
      status: status !== undefined ? status : task.status,
      priority: priority !== undefined ? priority : task.priority,
      assigneeIds: assigneeIds !== undefined ? assigneeIds : task.assigneeIds,
      tags: tags !== undefined ? tags : task.tags,
      dueDate: dueDate !== undefined ? dueDate : task.dueDate,
      sortOrder: sortOrder !== undefined ? sortOrder : task.sortOrder,
      metadata: metadata !== undefined ? metadata : task.metadata,
      attachments: attachments !== undefined ? attachments : task.attachments
    };

    // Отслеживаем переход в статус done
    if (status === 'done' && task.status !== 'done') {
      updateData.completedAt = new Date();
    } else if (status !== 'done' && task.status === 'done') {
      updateData.completedAt = null;
    }

    await task.update(updateData);

    const updatedTask = await KanbanTask.findByPk(task.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    const taskData = updatedTask.toJSON();
    taskData.assignees = await getAssigneesData(taskData.assigneeIds);

    res.json(taskData);
  } catch (error) {
    console.error('Error updating kanban task:', error);
    res.status(500).json({ message: 'Ошибка при обновлении задачи' });
  }
});

/**
 * DELETE /api/kanban/tasks/:id
 * Удаление задачи
 */
router.delete('/tasks/:id', authenticate, async (req, res) => {
  try {
    const task = await KanbanTask.findByPk(req.params.id, {
      include: [{ model: KanbanBoard, as: 'board' }]
    });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    // Проверяем права доступа к доске (editor или owner)
    const access = await checkBoardAccess(task.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Требуются права редактора.' });
    }

    await task.destroy();
    res.json({ message: 'Задача успешно удалена' });
  } catch (error) {
    console.error('Error deleting kanban task:', error);
    res.status(500).json({ message: 'Ошибка при удалении задачи' });
  }
});

/**
 * POST /api/kanban/tasks/:id/move
 * Перемещение задачи между колонками с обновлением порядка
 */
router.post('/tasks/:id/move', authenticate, async (req, res) => {
  try {
    const task = await KanbanTask.findByPk(req.params.id, {
      include: [{ model: KanbanBoard, as: 'board' }]
    });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    // Проверяем права доступа к доске (editor или owner)
    const access = await checkBoardAccess(task.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Требуются права редактора.' });
    }

    const { status, sortOrder } = req.body;

    const updateData = {
      status: status !== undefined ? status : task.status,
      sortOrder: sortOrder !== undefined ? sortOrder : task.sortOrder
    };

    // Отслеживаем переход в статус done при перемещении
    if (status === 'done' && task.status !== 'done') {
      updateData.completedAt = new Date();
    } else if (status !== 'done' && task.status === 'done') {
      updateData.completedAt = null;
    }

    await task.update(updateData);

    const updatedTask = await KanbanTask.findByPk(task.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    const taskData = updatedTask.toJSON();
    taskData.assignees = await getAssigneesData(taskData.assigneeIds);

    res.json(taskData);
  } catch (error) {
    console.error('Error moving kanban task:', error);
    res.status(500).json({ message: 'Ошибка при перемещении задачи' });
  }
});

/**
 * GET /api/kanban/check-access
 * Проверка доступа текущего пользователя
 */
router.get('/check-access', authenticate, async (req, res) => {
  try {
    const canRead = checkKanbanAccess(req.user, 'read');
    const canWrite = checkKanbanAccess(req.user, 'write');

    res.json({ canRead, canWrite });
  } catch (error) {
    console.error('Error checking kanban access:', error);
    res.status(500).json({ message: 'Ошибка при проверке доступа' });
  }
});

/**
 * GET /api/kanban/archive
 * Получение всех архивных задач конкретной доски
 * Требует параметр boardId
 */
router.get('/archive', authenticate, async (req, res) => {
  try {
    const { boardId } = req.query;

    if (!boardId) {
      return res.status(400).json({ message: 'boardId обязателен' });
    }

    // Проверяем существование доски и права доступа
    const board = await KanbanBoard.findByPk(boardId);
    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    const access = await checkBoardAccess(board, req.user.id, 'viewer');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ к доске запрещен' });
    }

    const tasks = await KanbanTask.findAll({
      where: {
        boardId: boardId,
        archived: true
      },
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ],
      order: [['archivedAt', 'DESC']]
    });

    const tasksWithAssignees = await Promise.all(tasks.map(async (task) => {
      const taskData = task.toJSON();
      taskData.assignees = await getAssigneesData(taskData.assigneeIds);
      return taskData;
    }));

    res.json(tasksWithAssignees);
  } catch (error) {
    console.error('Error fetching archived tasks:', error);
    res.status(500).json({ message: 'Ошибка при получении архивных задач' });
  }
});

/**
 * POST /api/kanban/tasks/:id/archive
 * Ручная архивация задачи
 */
router.post('/tasks/:id/archive', authenticate, async (req, res) => {
  try {
    const task = await KanbanTask.findByPk(req.params.id, {
      include: [{ model: KanbanBoard, as: 'board' }]
    });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    // Проверяем права доступа к доске (editor или owner)
    const access = await checkBoardAccess(task.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Требуются права редактора.' });
    }

    await task.update({
      archived: true,
      archivedAt: new Date()
    });

    const archivedTask = await KanbanTask.findByPk(task.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    const taskData = archivedTask.toJSON();
    taskData.assignees = await getAssigneesData(taskData.assigneeIds);

    res.json(taskData);
  } catch (error) {
    console.error('Error archiving task:', error);
    res.status(500).json({ message: 'Ошибка при архивации задачи' });
  }
});

/**
 * POST /api/kanban/tasks/:id/restore
 * Восстановление задачи из архива
 */
router.post('/tasks/:id/restore', authenticate, async (req, res) => {
  try {
    const task = await KanbanTask.findByPk(req.params.id, {
      include: [{ model: KanbanBoard, as: 'board' }]
    });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    // Проверяем права доступа к доске (editor или owner)
    const access = await checkBoardAccess(task.board, req.user.id, 'editor');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Требуются права редактора.' });
    }

    await task.update({
      archived: false,
      archivedAt: null
    });

    const restoredTask = await KanbanTask.findByPk(task.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    const taskData = restoredTask.toJSON();
    taskData.assignees = await getAssigneesData(taskData.assigneeIds);

    res.json(taskData);
  } catch (error) {
    console.error('Error restoring task:', error);
    res.status(500).json({ message: 'Ошибка при восстановлении задачи' });
  }
});

/**
 * POST /api/kanban/upload
 * Загрузка файла для прикрепления к задаче
 */
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    const hasAccess = checkKanbanAccess(req.user, 'write');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Файл не загружен' });
    }

    const originalName = decodeFileName(req.file.originalname);
    // Получаем относительный путь от корня backend (uploads/kanban/...)
    const relativePath = path.relative(__dirname, req.file.path).replace(/\\/g, '/');
    const fileData = {
      id: uuidv4(),
      filename: originalName,
      path: relativePath,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user.id
    };

    res.json(fileData);
  } catch (error) {
    console.error('Error uploading kanban file:', error);
    res.status(500).json({ message: 'Ошибка при загрузке файла' });
  }
});

/**
 * DELETE /api/kanban/files/:fileId
 * Удаление файла с задачи
 */
router.delete('/files/:fileId', authenticate, async (req, res) => {
  try {
    const hasAccess = checkKanbanAccess(req.user, 'write');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const { taskId } = req.query;
    if (!taskId) {
      return res.status(400).json({ message: 'taskId обязателен' });
    }

    const task = await KanbanTask.findByPk(taskId);
    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    const fileToDelete = task.attachments.find(f => f.id === req.params.fileId);
    if (!fileToDelete) {
      return res.status(404).json({ message: 'Файл не найден' });
    }

    // Удаляем файл с диска
    try {
      await fs.unlink(fileToDelete.path);
    } catch (err) {
      console.error('Error deleting file from disk:', err);
    }

    // Удаляем из БД
    const newAttachments = task.attachments.filter(f => f.id !== req.params.fileId);
    await task.update({ attachments: newAttachments });

    res.json({ message: 'Файл успешно удален' });
  } catch (error) {
    console.error('Error deleting kanban file:', error);
    res.status(500).json({ message: 'Ошибка при удалении файла' });
  }
});

// ============================================================================
// BOARD MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/kanban/boards
 * Получить список всех досок, доступных пользователю
 */
router.get('/boards', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Получаем доски, где пользователь является владельцем
    const ownedBoards = await KanbanBoard.findAll({
      where: {
        ownerId: userId,
        archived: false
      },
      include: [
        {
          model: User,
          as: 'owner',
          attributes: ['id', 'displayName', 'email']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Получаем доски, к которым у пользователя есть доступ через permissions
    const sharedPermissions = await BoardPermission.findAll({
      where: { userId },
      include: [
        {
          model: KanbanBoard,
          as: 'board',
          where: { archived: false },
          include: [
            {
              model: User,
              as: 'owner',
              attributes: ['id', 'displayName', 'email']
            }
          ]
        }
      ]
    });

    const sharedBoards = sharedPermissions.map(p => ({
      ...p.board.toJSON(),
      userRole: p.role
    }));

    // Объединяем и добавляем статистику
    const allBoards = [
      ...ownedBoards.map(b => ({ ...b.toJSON(), userRole: 'owner' })),
      ...sharedBoards
    ];

    // Добавляем количество задач для каждой доски
    for (let board of allBoards) {
      const taskCount = await KanbanTask.count({
        where: {
          boardId: board.id,
          archived: false
        }
      });
      board.taskCount = taskCount;
    }

    res.json(allBoards);
  } catch (error) {
    console.error('Error fetching boards:', error);
    res.status(500).json({ message: 'Ошибка при получении списка досок' });
  }
});

/**
 * POST /api/kanban/boards
 * Создать новую доску
 */
router.post('/boards', authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ message: 'Название доски обязательно' });
    }

    const board = await KanbanBoard.create({
      name: name.trim(),
      description: description?.trim() || null,
      ownerId: req.user.id
    });

    const boardWithOwner = await KanbanBoard.findByPk(board.id, {
      include: [
        {
          model: User,
          as: 'owner',
          attributes: ['id', 'displayName', 'email']
        }
      ]
    });

    res.status(201).json({
      ...boardWithOwner.toJSON(),
      userRole: 'owner',
      taskCount: 0
    });
  } catch (error) {
    console.error('Error creating board:', error);
    res.status(500).json({ message: 'Ошибка при создании доски' });
  }
});

/**
 * GET /api/kanban/boards/:id
 * Получить конкретную доску
 */
router.get('/boards/:id', authenticate, async (req, res) => {
  try {
    const board = await KanbanBoard.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'owner',
          attributes: ['id', 'displayName', 'email']
        }
      ]
    });

    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Проверяем права доступа
    const access = await checkBoardAccess(board, req.user.id, 'viewer');
    if (!access || !access.hasAccess) {
      return res.status(403).json({ message: 'Доступ к доске запрещен' });
    }

    const taskCount = await KanbanTask.count({
      where: {
        boardId: board.id,
        archived: false
      }
    });

    res.json({
      ...board.toJSON(),
      userRole: access.role,
      taskCount
    });
  } catch (error) {
    console.error('Error fetching board:', error);
    res.status(500).json({ message: 'Ошибка при получении доски' });
  }
});

/**
 * PUT /api/kanban/boards/:id
 * Обновить доску (только владелец)
 */
router.put('/boards/:id', authenticate, async (req, res) => {
  try {
    const board = await KanbanBoard.findByPk(req.params.id);

    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Только владелец может редактировать
    if (board.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Только владелец может редактировать доску' });
    }

    const { name, description } = req.body;

    if (name !== undefined) {
      if (!name || name.trim() === '') {
        return res.status(400).json({ message: 'Название доски не может быть пустым' });
      }
      board.name = name.trim();
    }

    if (description !== undefined) {
      board.description = description?.trim() || null;
    }

    await board.save();

    const updatedBoard = await KanbanBoard.findByPk(board.id, {
      include: [
        {
          model: User,
          as: 'owner',
          attributes: ['id', 'displayName', 'email']
        }
      ]
    });

    res.json({
      ...updatedBoard.toJSON(),
      userRole: 'owner'
    });
  } catch (error) {
    console.error('Error updating board:', error);
    res.status(500).json({ message: 'Ошибка при обновлении доски' });
  }
});

/**
 * DELETE /api/kanban/boards/:id
 * Удалить доску (только владелец)
 * Удаляет доску и все связанные задачи (CASCADE)
 */
router.delete('/boards/:id', authenticate, async (req, res) => {
  try {
    const board = await KanbanBoard.findByPk(req.params.id);

    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Только владелец может удалить
    if (board.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Только владелец может удалить доску' });
    }

    await board.destroy();

    res.json({ message: 'Доска успешно удалена' });
  } catch (error) {
    console.error('Error deleting board:', error);
    res.status(500).json({ message: 'Ошибка при удалении доски' });
  }
});

// ============================================================================
// BOARD PERMISSIONS ENDPOINTS
// ============================================================================

/**
 * GET /api/kanban/boards/:id/permissions
 * Получить список всех разрешений для доски
 */
router.get('/boards/:id/permissions', authenticate, async (req, res) => {
  try {
    const board = await KanbanBoard.findByPk(req.params.id);

    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Только владелец может просматривать разрешения
    if (board.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const permissions = await BoardPermission.findAll({
      where: { boardId: req.params.id },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'displayName', 'email']
        }
      ],
      order: [['createdAt', 'ASC']]
    });

    res.json(permissions);
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ message: 'Ошибка при получении разрешений' });
  }
});

/**
 * POST /api/kanban/boards/:id/permissions
 * Добавить пользователю доступ к доске
 */
router.post('/boards/:id/permissions', authenticate, async (req, res) => {
  try {
    const board = await KanbanBoard.findByPk(req.params.id);

    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Только владелец может добавлять разрешения
    if (board.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const { userId, role } = req.body;

    if (!userId || !role) {
      return res.status(400).json({ message: 'userId и role обязательны' });
    }

    if (!['editor', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Роль должна быть editor или viewer' });
    }

    // Проверяем существование пользователя
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    // Нельзя добавить владельца
    if (userId === board.ownerId) {
      return res.status(400).json({ message: 'Владелец уже имеет полный доступ' });
    }

    // Проверяем, нет ли уже разрешения
    const existing = await BoardPermission.findOne({
      where: {
        boardId: req.params.id,
        userId: userId
      }
    });

    if (existing) {
      return res.status(409).json({ message: 'Пользователь уже имеет доступ к этой доске' });
    }

    const permission = await BoardPermission.create({
      boardId: req.params.id,
      userId,
      role
    });

    const permissionWithUser = await BoardPermission.findByPk(permission.id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'displayName', 'email']
        }
      ]
    });

    res.status(201).json(permissionWithUser);
  } catch (error) {
    console.error('Error creating permission:', error);
    res.status(500).json({ message: 'Ошибка при добавлении разрешения' });
  }
});

/**
 * PUT /api/kanban/boards/:boardId/permissions/:permId
 * Изменить роль пользователя
 */
router.put('/boards/:boardId/permissions/:permId', authenticate, async (req, res) => {
  try {
    const board = await KanbanBoard.findByPk(req.params.boardId);

    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Только владелец может изменять разрешения
    if (board.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const permission = await BoardPermission.findByPk(req.params.permId);

    if (!permission || permission.boardId !== req.params.boardId) {
      return res.status(404).json({ message: 'Разрешение не найдено' });
    }

    const { role } = req.body;

    if (!role || !['editor', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Роль должна быть editor или viewer' });
    }

    permission.role = role;
    await permission.save();

    const updatedPermission = await BoardPermission.findByPk(permission.id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'displayName', 'email']
        }
      ]
    });

    res.json(updatedPermission);
  } catch (error) {
    console.error('Error updating permission:', error);
    res.status(500).json({ message: 'Ошибка при обновлении разрешения' });
  }
});

/**
 * DELETE /api/kanban/boards/:boardId/permissions/:permId
 * Удалить доступ пользователя к доске
 */
router.delete('/boards/:boardId/permissions/:permId', authenticate, async (req, res) => {
  try {
    const board = await KanbanBoard.findByPk(req.params.boardId);

    if (!board) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Только владелец может удалять разрешения
    if (board.ownerId !== req.user.id) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const permission = await BoardPermission.findByPk(req.params.permId);

    if (!permission || permission.boardId !== req.params.boardId) {
      return res.status(404).json({ message: 'Разрешение не найдено' });
    }

    await permission.destroy();

    res.json({ message: 'Доступ успешно удален' });
  } catch (error) {
    console.error('Error deleting permission:', error);
    res.status(500).json({ message: 'Ошибка при удалении разрешения' });
  }
});

module.exports = router;
