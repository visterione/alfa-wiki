const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { KanbanTask, User } = require('../models');
const { authenticate } = require('../middleware/auth');

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
 * Проверка прав доступа к Канбану
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
 * Получение всех задач Канбана
 */
router.get('/tasks', authenticate, async (req, res) => {
  try {
    // Проверяем права доступа на чтение
    const hasAccess = checkKanbanAccess(req.user, 'read');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const tasks = await KanbanTask.findAll({
      where: { archived: false },
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
    const hasAccess = checkKanbanAccess(req.user, 'read');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const task = await KanbanTask.findByPk(req.params.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'displayName', 'username', 'avatar'] }
      ]
    });

    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
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
    const hasAccess = checkKanbanAccess(req.user, 'write');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Только определенные роли могут создавать задачи.' });
    }

    const { title, description, status, priority, assigneeIds, tags, dueDate, sortOrder, metadata, attachments } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'Название задачи обязательно' });
    }

    const task = await KanbanTask.create({
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
    const hasAccess = checkKanbanAccess(req.user, 'write');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Только определенные роли могут редактировать задачи.' });
    }

    const task = await KanbanTask.findByPk(req.params.id);
    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
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
    const hasAccess = checkKanbanAccess(req.user, 'write');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен. Только определенные роли могут удалять задачи.' });
    }

    const task = await KanbanTask.findByPk(req.params.id);
    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
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
    const hasAccess = checkKanbanAccess(req.user, 'write');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const task = await KanbanTask.findByPk(req.params.id);
    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
    }

    const { status, sortOrder } = req.body;

    await task.update({
      status: status !== undefined ? status : task.status,
      sortOrder: sortOrder !== undefined ? sortOrder : task.sortOrder
    });

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
 * Получение всех архивных задач
 */
router.get('/archive', authenticate, async (req, res) => {
  try {
    const hasAccess = checkKanbanAccess(req.user, 'write'); // Только с правами редактирования
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const tasks = await KanbanTask.findAll({
      where: { archived: true },
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
 * POST /api/kanban/auto-archive
 * Автоматическая архивация завершенных задач старше 1 дня
 */
router.post('/auto-archive', authenticate, async (req, res) => {
  try {
    // Только админы могут запускать авто-архивацию
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const tasksToArchive = await KanbanTask.findAll({
      where: {
        status: 'done',
        archived: false,
        completedAt: {
          [require('sequelize').Op.lte]: oneDayAgo
        }
      }
    });

    const archivedCount = tasksToArchive.length;

    await Promise.all(tasksToArchive.map(task =>
      task.update({
        archived: true,
        archivedAt: new Date()
      })
    ));

    res.json({
      message: `Архивировано задач: ${archivedCount}`,
      count: archivedCount
    });
  } catch (error) {
    console.error('Error auto-archiving tasks:', error);
    res.status(500).json({ message: 'Ошибка при архивации задач' });
  }
});

/**
 * POST /api/kanban/tasks/:id/restore
 * Восстановление задачи из архива
 */
router.post('/tasks/:id/restore', authenticate, async (req, res) => {
  try {
    const hasAccess = checkKanbanAccess(req.user, 'write');
    if (!hasAccess) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const task = await KanbanTask.findByPk(req.params.id);
    if (!task) {
      return res.status(404).json({ message: 'Задача не найдена' });
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
    const fileData = {
      id: uuidv4(),
      filename: originalName,
      path: req.file.path.replace(/\\/g, '/'),
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

module.exports = router;
