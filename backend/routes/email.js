const express = require('express');
const { randomUUID } = require('crypto');
const { body, validationResult } = require('express-validator');
const { EmailTemplate, EmailLog, EmailFavoriteRecipient, EmailFavoriteTemplate, User, Role } = require('../models');
const { authenticate } = require('../middleware/auth');
const { sendBulkEmail } = require('../services/emailService');
const { Op } = require('sequelize');
const multer = require('multer');
const XLSX = require('xlsx-js-style');
const { parsePagination } = require('../utils/pagination');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// In-memory store для активных задач рассылки
const sendJobs = new Map();

// Чистим завершённые задачи старше 1 часа
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, job] of sendJobs) {
    if (job.startedAt < cutoff) sendJobs.delete(id);
  }
}, 600_000);

// === EMAIL TEMPLATES ===

// GET /api/email/templates - Получить все шаблоны
router.get('/templates', authenticate, async (req, res) => {
  try {
    const templates = await EmailTemplate.findAll({
      where: {
        [Op.or]: [
          { isPublic: true },
          { createdBy: req.user.id }
        ]
      },
      include: [{ model: User, as: 'creator', attributes: ['id', 'displayName', 'username'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(templates);
  } catch (error) {
    console.error('❌ Error fetching templates:', error);
    res.status(500).json({ error: 'Ошибка загрузки шаблонов' });
  }
});

// POST /api/email/templates - Создать шаблон
router.post('/templates', authenticate, [
  body('name').trim().notEmpty().withMessage('Название обязательно'),
  body('subject').trim().notEmpty().withMessage('Тема обязательна'),
  body('htmlContent').notEmpty().withMessage('Содержимое обязательно')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, subject, htmlContent, isPublic } = req.body;
    const template = await EmailTemplate.create({
      name,
      subject,
      htmlContent,
      createdBy: req.user.id,
      isPublic: isPublic !== false // По умолчанию публичный
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('❌ Error creating template:', error);
    res.status(500).json({ error: 'Ошибка создания шаблона' });
  }
});

// PUT /api/email/templates/:id - Обновить шаблон
router.put('/templates/:id', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findByPk(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Шаблон не найден' });
    }

    // Только создатель может редактировать
    if (template.createdBy !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Нет прав на редактирование' });
    }

    await template.update(req.body);
    res.json(template);
  } catch (error) {
    console.error('❌ Error updating template:', error);
    res.status(500).json({ error: 'Ошибка обновления шаблона' });
  }
});

// DELETE /api/email/templates/:id - Удалить шаблон
router.delete('/templates/:id', authenticate, async (req, res) => {
  try {
    const template = await EmailTemplate.findByPk(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Шаблон не найден' });
    }

    if (template.createdBy !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Нет прав на удаление' });
    }

    await template.destroy();
    res.json({ message: 'Шаблон удален' });
  } catch (error) {
    console.error('❌ Error deleting template:', error);
    res.status(500).json({ error: 'Ошибка удаления шаблона' });
  }
});

// === EMAIL SENDING ===

// POST /api/email/send - Запустить рассылку (возвращает jobId сразу, отправка идёт в фоне)
router.post('/send', authenticate, [
  body('subject').trim().notEmpty().withMessage('Тема обязательна'),
  body('htmlContent').notEmpty().withMessage('Содержимое обязательно'),
  body('recipients').isArray({ min: 1 }).withMessage('Укажите получателей')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { subject, htmlContent, recipients, attachments = [] } = req.body;
  const senderInfo = req.user.displayName || req.user.username;
  const sentBy = req.user.id;

  const jobId = randomUUID();
  sendJobs.set(jobId, {
    status: 'running',
    sent: 0,
    failed: 0,
    total: recipients.length,
    errors: [],
    startedAt: Date.now()
  });

  // Отвечаем клиенту немедленно
  res.json({ jobId, total: recipients.length });

  // Отправка в фоне
  (async () => {
    try {
      const result = await sendBulkEmail({
        subject,
        htmlContent,
        recipients,
        attachments,
        senderInfo,
        onProgress: ({ sent, failed }) => {
          const job = sendJobs.get(jobId);
          if (job) { job.sent = sent; job.failed = failed; }
        }
      });

      const job = sendJobs.get(jobId);
      if (job) {
        job.status = result.failed === 0 ? 'done' : (result.sent === 0 ? 'failed' : 'partial');
        job.sent = result.sent;
        job.failed = result.failed;
        job.errors = result.errors;
      }

      const status = result.failed === 0 ? 'sent' : (result.sent === 0 ? 'failed' : 'partial');
      await EmailLog.create({
        subject,
        htmlContent,
        recipients: recipients.map(r => ({ email: r.email, userId: r.userId, displayName: r.displayName })),
        attachments: attachments.map(a => ({ name: a.name, path: a.path, size: a.size, mimeType: a.mimeType })),
        sentBy,
        status,
        errorDetails: result.errors.length > 0 ? JSON.stringify(result.errors) : null
      });
    } catch (error) {
      console.error('❌ Background email broadcast error:', error);
      const job = sendJobs.get(jobId);
      if (job) { job.status = 'failed'; job.errors = [{ error: error.message }]; }
    }
  })();
});

// GET /api/email/send/status/:jobId - Статус задачи рассылки
router.get('/send/status/:jobId', authenticate, (req, res) => {
  const job = sendJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

// === EMAIL HISTORY ===

// GET /api/email/history - История рассылок
router.get('/history', authenticate, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    // Админы видят все, обычные пользователи - только свои
    const where = req.user.isAdmin ? {} : { sentBy: req.user.id };

    const { count, rows } = await EmailLog.findAndCountAll({
      where,
      include: [{ model: User, as: 'sender', attributes: ['id', 'displayName', 'username'] }],
      order: [['sentAt', 'DESC']],
      limit,
      offset
    });

    res.json({ total: count, logs: rows });
  } catch (error) {
    console.error('❌ Error fetching email history:', error);
    res.status(500).json({ error: 'Ошибка загрузки истории' });
  }
});

// GET /api/email/history/:id - Детали рассылки
router.get('/history/:id', authenticate, async (req, res) => {
  try {
    const log = await EmailLog.findByPk(req.params.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'displayName', 'username'] }]
    });

    if (!log) {
      return res.status(404).json({ error: 'Лог не найден' });
    }

    // Проверка прав доступа
    if (!req.user.isAdmin && log.sentBy !== req.user.id) {
      return res.status(403).json({ error: 'Нет прав на просмотр' });
    }

    res.json(log);
  } catch (error) {
    console.error('❌ Error fetching email log:', error);
    res.status(500).json({ error: 'Ошибка загрузки лога' });
  }
});

// === RECIPIENT HELPERS ===

// GET /api/email/recipients/users - Получить всех пользователей для выбора получателей
router.get('/recipients/users', authenticate, async (req, res) => {
  try {
    const users = await User.findAll({
      where: {
        isActive: true,
        email: { [Op.ne]: null }
      },
      attributes: ['id', 'displayName', 'username', 'email'],
      order: [['displayName', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Ошибка загрузки пользователей' });
  }
});

// GET /api/email/recipients/by-role/:roleId - Получить пользователей по роли
router.get('/recipients/by-role/:roleId', authenticate, async (req, res) => {
  try {
    const { UserRole } = require('../models');

    const users = await User.findAll({
      where: {
        isActive: true,
        email: { [Op.ne]: null }
      },
      attributes: ['id', 'displayName', 'username', 'email'],
      include: [{
        model: Role,
        as: 'roles',
        where: { id: req.params.roleId },
        through: { attributes: [] }
      }],
      order: [['displayName', 'ASC']]
    });

    res.json(users);
  } catch (error) {
    console.error('❌ Error fetching users by role:', error);
    res.status(500).json({ error: 'Ошибка загрузки пользователей по роли' });
  }
});

// === FAVORITES ===

// GET /api/email/favorites/recipients - Получить избранных получателей
router.get('/favorites/recipients', authenticate, async (req, res) => {
  try {
    const favorites = await EmailFavoriteRecipient.findAll({
      where: { userId: req.user.id },
      order: [['displayName', 'ASC']]
    });
    res.json(favorites);
  } catch (error) {
    console.error('❌ Error fetching favorite recipients:', error);
    res.status(500).json({ error: 'Ошибка загрузки избранных получателей' });
  }
});

// POST /api/email/favorites/recipients - Добавить избранного получателя
router.post('/favorites/recipients', authenticate, [
  body('email').isEmail().withMessage('Некорректный email'),
  body('displayName').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, displayName } = req.body;
    const [favorite, created] = await EmailFavoriteRecipient.findOrCreate({
      where: { userId: req.user.id, email },
      defaults: { userId: req.user.id, email, displayName: displayName || email }
    });

    if (!created) {
      // Обновляем displayName если изменился
      await favorite.update({ displayName: displayName || email });
    }

    res.json(favorite);
  } catch (error) {
    console.error('❌ Error adding favorite recipient:', error);
    res.status(500).json({ error: 'Ошибка добавления избранного получателя' });
  }
});

// DELETE /api/email/favorites/recipients/:id - Удалить избранного получателя
router.delete('/favorites/recipients/:id', authenticate, async (req, res) => {
  try {
    const favorite = await EmailFavoriteRecipient.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!favorite) {
      return res.status(404).json({ error: 'Избранный получатель не найден' });
    }

    await favorite.destroy();
    res.json({ message: 'Удалено из избранного' });
  } catch (error) {
    console.error('❌ Error removing favorite recipient:', error);
    res.status(500).json({ error: 'Ошибка удаления избранного получателя' });
  }
});

// GET /api/email/favorites/templates - Получить избранные шаблоны (список ID)
router.get('/favorites/templates', authenticate, async (req, res) => {
  try {
    const favorites = await EmailFavoriteTemplate.findAll({
      where: { userId: req.user.id },
      attributes: ['id', 'templateId']
    });
    res.json(favorites.map(f => f.templateId));
  } catch (error) {
    console.error('❌ Error fetching favorite templates:', error);
    res.status(500).json({ error: 'Ошибка загрузки избранных шаблонов' });
  }
});

// POST /api/email/favorites/templates/:templateId - Переключить избранный шаблон
router.post('/favorites/templates/:templateId', authenticate, async (req, res) => {
  try {
    const { templateId } = req.params;

    const existing = await EmailFavoriteTemplate.findOne({
      where: { userId: req.user.id, templateId }
    });

    if (existing) {
      await existing.destroy();
      res.json({ favorited: false });
    } else {
      await EmailFavoriteTemplate.create({ userId: req.user.id, templateId });
      res.json({ favorited: true });
    }
  } catch (error) {
    console.error('❌ Error toggling favorite template:', error);
    res.status(500).json({ error: 'Ошибка обновления избранного шаблона' });
  }
});

// === EXCEL IMPORT ===

// POST /api/email/recipients/parse-excel - Извлечь email-адреса из Excel-файла
router.post('/recipients/parse-excel', authenticate, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не передан' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const found = new Set();

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      for (const cellKey of Object.keys(sheet)) {
        if (cellKey.startsWith('!')) continue; // служебные поля
        const cell = sheet[cellKey];
        if (!cell || cell.v == null) continue;
        // Берём строковое значение ячейки и разбиваем по разделителям
        const raw = String(cell.v);
        const parts = raw.split(/[\s,;]+/);
        for (const part of parts) {
          const trimmed = part.trim().toLowerCase();
          if (emailRegex.test(trimmed)) {
            found.add(trimmed);
          }
        }
      }
    }

    const emails = Array.from(found);
    res.json({ emails, count: emails.length });
  } catch (error) {
    console.error('❌ Error parsing Excel:', error);
    res.status(500).json({ error: 'Ошибка разбора файла' });
  }
});

module.exports = router;
