const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { Accreditation, AccreditationFile, SearchIndex, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКА: Укажи slug wiki-страницы с аккредитациями
// Посмотри URL страницы в браузере: /page/ЭТОТ_SLUG
// ═══════════════════════════════════════════════════════════════
const ACCREDITATIONS_PAGE_SLUG = 'accreditations'; // <-- ЗАМЕНИ НА СВОЙ SLUG
// ═══════════════════════════════════════════════════════════════

// === HELPER: Запись в историю страницы ===
async function recordHistory(pageSlug, userId, summary, changes = []) {
  try {
    const page = await Page.findOne({ where: { slug: pageSlug } });
    await PageHistory.create({
      pageId: page ? page.id : null,
      userId,
      action: 'updated',
      changesSummary: summary,
      metadata: { changes, pageSlug }
    });
  } catch (err) {
    console.error('History record error:', err.message);
  }
}

// === MULTER CONFIGURATION ===
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.env.UPLOAD_PATH || './uploads', 'accreditations');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'accred-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 // 50MB по умолчанию
  },
  fileFilter: (req, file, cb) => {
    // Разрешенные типы файлов
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый тип файла. Разрешены: изображения, PDF, Word, Excel, текстовые файлы.'));
    }
  }
});

// === HELPER: Индексация аккредитации для поиска ===
const indexAccreditation = async (accreditation) => {
  // Формируем поисковый контент из всех релевантных полей
  const searchContent = [
    accreditation.fullName,
    accreditation.specialty,
    accreditation.medCenter,
    accreditation.comment
  ].filter(Boolean).join(' | ');

  // Формируем заголовок для отображения в результатах
  const title = `${accreditation.fullName} — ${accreditation.specialty}`;

  // Ключевые слова для поиска
  const keywords = [
    accreditation.medCenter?.toLowerCase(),
    accreditation.specialty?.toLowerCase(),
    'аккредитация',
    'сертификат',
    'врач'
  ].filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'accreditation',
    entityId: accreditation.id,
    title: title,
    content: searchContent,
    keywords: keywords,
    url: `/page/${ACCREDITATIONS_PAGE_SLUG}?highlight=${accreditation.id}`,
    metadata: {
      pageSlug: ACCREDITATIONS_PAGE_SLUG, // <-- Добавлена привязка к родительской странице
      medCenter: accreditation.medCenter,
      specialty: accreditation.specialty,
      expirationDate: accreditation.expirationDate,
      fullName: accreditation.fullName
    }
  });
};

// === HELPER: Удаление из индекса ===
const removeFromIndex = async (accreditationId) => {
  await SearchIndex.destroy({
    where: {
      entityType: 'accreditation',
      entityId: accreditationId
    }
  });
};

// === HELPER: Полная переиндексация всех аккредитаций ===
const reindexAllAccreditations = async () => {
  // Удаляем старые записи
  await SearchIndex.destroy({
    where: { entityType: 'accreditation' }
  });

  // Получаем все аккредитации
  const allAccreditations = await Accreditation.findAll();

  // Индексируем каждую
  for (const acc of allAccreditations) {
    await indexAccreditation(acc);
  }

  return allAccreditations.length;
};

// Получить все аккредитации с фильтрацией
router.get('/', authenticate, async (req, res) => {
  try {
    const { medCenter, fullName, specialty, search, sortBy = 'expirationDate', sortOrder = 'ASC', archived } = req.query;

    const where = {};

    // По умолчанию показываем только неархивные записи
    if (archived === 'true') {
      where.isArchived = true;
    } else if (archived === 'false') {
      where.isArchived = false;
    } else {
      // Если параметр не указан, показываем только активные
      where.isArchived = false;
    }

    if (medCenter) where.medCenter = medCenter;
    if (specialty) where.specialty = specialty;
    if (fullName) where.fullName = { [Op.iLike]: `%${fullName}%` };
    if (search) {
      where[Op.or] = [
        { fullName: { [Op.iLike]: `%${search}%` } },
        { specialty: { [Op.iLike]: `%${search}%` } },
        { comment: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const order = [[sortBy, sortOrder.toUpperCase()]];

    const accreditations = await Accreditation.findAll({ where, order });
    res.json(accreditations);
  } catch (error) {
    console.error('Get accreditations error:', error);
    res.status(500).json({ error: 'Failed to fetch accreditations' });
  }
});

// Получить уникальные специальности для выпадающего списка
router.get('/specialties', authenticate, async (req, res) => {
  try {
    const result = await Accreditation.findAll({
      attributes: ['specialty'],
      group: ['specialty'],
      order: [['specialty', 'ASC']]
    });
    res.json(result.map(r => r.specialty));
  } catch (error) {
    console.error('Get specialties error:', error);
    res.status(500).json({ error: 'Failed to fetch specialties' });
  }
});

// Статистика по аккредитациям
router.get('/stats', authenticate, async (req, res) => {
  try {
    const today = new Date();
    const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90Days = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

    const [total, expired, expiringSoon, expiringIn90] = await Promise.all([
      Accreditation.count(),
      Accreditation.count({ where: { expirationDate: { [Op.lt]: today } } }),
      Accreditation.count({ where: { expirationDate: { [Op.between]: [today, in30Days] } } }),
      Accreditation.count({ where: { expirationDate: { [Op.between]: [today, in90Days] } } })
    ]);

    res.json({ total, expired, expiringSoon, expiringIn90 });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Полная переиндексация (для админа)
router.post('/reindex', authenticate, async (req, res) => {
  try {
    const count = await reindexAllAccreditations();
    res.json({ 
      message: 'Reindex completed', 
      indexed: count 
    });
  } catch (error) {
    console.error('Reindex error:', error);
    res.status(500).json({ error: 'Failed to reindex accreditations' });
  }
});

// Создать аккредитацию
router.post('/', authenticate, [
  body('medCenter').isIn(['Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К']),
  body('fullName').trim().notEmpty(),
  body('specialty').trim().notEmpty(),
  body('expirationDate').isDate()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { medCenter, fullName, specialty, expirationDate, comment } = req.body;
    
    const accreditation = await Accreditation.create({
      medCenter, fullName, specialty, expirationDate, comment
    });

    // Индексируем для поиска
    await indexAccreditation(accreditation);

    await recordHistory(
      ACCREDITATIONS_PAGE_SLUG,
      req.user.id,
      `Добавлена аккредитация: ${fullName} — ${specialty}`,
      [{ field: 'accreditation', label: 'Добавлена аккредитация', to: `${fullName} — ${specialty}` }]
    );

    res.status(201).json(accreditation);
  } catch (error) {
    console.error('Create accreditation error:', error);
    res.status(500).json({ error: 'Failed to create accreditation' });
  }
});

// Обновить аккредитацию
router.put('/:id', authenticate, [
  body('medCenter').optional().isIn(['Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К']),
  body('fullName').optional().trim().notEmpty(),
  body('specialty').optional().trim().notEmpty(),
  body('expirationDate').optional().isDate()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    const { medCenter, fullName, specialty, expirationDate, comment } = req.body;

    // Сохраняем старые значения для истории
    const oldValues = {
      medCenter: accreditation.medCenter,
      fullName: accreditation.fullName,
      specialty: accreditation.specialty,
      expirationDate: accreditation.expirationDate,
      comment: accreditation.comment,
    };

    await accreditation.update({
      ...(medCenter && { medCenter }),
      ...(fullName && { fullName }),
      ...(specialty && { specialty }),
      ...(expirationDate && { expirationDate }),
      ...(comment !== undefined && { comment })
    });

    // Обновляем индекс
    await indexAccreditation(accreditation);

    // История изменений
    const detailedChanges = [];
    const fieldDefs = [
      { key: 'medCenter', label: 'Медцентр' },
      { key: 'fullName', label: 'ФИО' },
      { key: 'specialty', label: 'Специальность' },
      { key: 'expirationDate', label: 'Дата окончания' },
      { key: 'comment', label: 'Комментарий' },
    ];
    const updates = { medCenter, fullName, specialty, expirationDate, comment };
    for (const { key, label } of fieldDefs) {
      if (updates[key] !== undefined && String(updates[key] ?? '') !== String(oldValues[key] ?? '')) {
        detailedChanges.push({ field: key, label, from: String(oldValues[key] ?? ''), to: String(updates[key] ?? '') });
      }
    }
    if (detailedChanges.length > 0) {
      const summary = detailedChanges
        .map(c => `${c.label}: «${c.from.slice(0, 40)}» → «${c.to.slice(0, 40)}»`)
        .join('; ');
      await recordHistory(ACCREDITATIONS_PAGE_SLUG, req.user.id, summary, detailedChanges);
    }

    res.json(accreditation);
  } catch (error) {
    console.error('Update accreditation error:', error);
    res.status(500).json({ error: 'Failed to update accreditation' });
  }
});

// Переместить в архив / вернуть из архива
router.patch('/:id/archive', authenticate, async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    // Переключаем статус архивирования
    const isArchived = req.body.isArchived !== undefined ? req.body.isArchived : !accreditation.isArchived;
    await accreditation.update({ isArchived });

    await recordHistory(
      ACCREDITATIONS_PAGE_SLUG,
      req.user.id,
      isArchived
        ? `Аккредитация перемещена в архив: ${accreditation.fullName}`
        : `Аккредитация восстановлена из архива: ${accreditation.fullName}`,
      [{ field: 'isArchived', label: 'Статус', from: isArchived ? 'Активная' : 'Архив', to: isArchived ? 'Архив' : 'Активная' }]
    );

    res.json(accreditation);
  } catch (error) {
    console.error('Archive accreditation error:', error);
    res.status(500).json({ error: 'Failed to archive accreditation' });
  }
});

// Удалить аккредитацию
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    const accId = accreditation.id;
    const { fullName, specialty } = accreditation;

    // Удаляем все связанные файлы
    const files = await AccreditationFile.findAll({ where: { accreditationId: accId } });
    for (const file of files) {
      try {
        await fs.unlink(file.path);
      } catch (err) {
        console.error('Error deleting file:', err);
      }
      await file.destroy();
    }

    await accreditation.destroy();

    // Удаляем из индекса
    await removeFromIndex(accId);

    await recordHistory(
      ACCREDITATIONS_PAGE_SLUG,
      req.user.id,
      `Удалена аккредитация: ${fullName} — ${specialty}`,
      [{ field: 'accreditation', label: 'Удалена аккредитация', from: `${fullName} — ${specialty}` }]
    );

    res.json({ message: 'Accreditation deleted' });
  } catch (error) {
    console.error('Delete accreditation error:', error);
    res.status(500).json({ error: 'Failed to delete accreditation' });
  }
});

// ═══════════════════════════════════════════════════════════════
// FILE MANAGEMENT ROUTES
// ═══════════════════════════════════════════════════════════════

// Получить список файлов аккредитации
router.get('/:id/files', authenticate, async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    const files = await AccreditationFile.findAll({
      where: { accreditationId: req.params.id },
      order: [['createdAt', 'DESC']]
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(files);
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Загрузить файл(ы) к аккредитации
router.post('/:id/files', authenticate, upload.array('files', 10), async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadedFiles = [];
    for (const file of req.files) {
      // Исправляем кодировку имени файла (multer передает в latin1, нужно декодировать в utf8)
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      const accreditationFile = await AccreditationFile.create({
        accreditationId: req.params.id,
        filename: file.filename,
        originalName: originalName,
        mimeType: file.mimetype,
        size: file.size,
        path: file.path,
        uploadedBy: req.user.id
      });
      uploadedFiles.push(accreditationFile);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(201).json(uploadedFiles);
  } catch (error) {
    console.error('Upload files error:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Скачать файл
router.get('/:id/files/:fileId/download', authenticate, async (req, res) => {
  try {
    const file = await AccreditationFile.findOne({
      where: {
        id: req.params.fileId,
        accreditationId: req.params.id
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Проверяем существование файла
    try {
      await fs.access(file.path);
    } catch (err) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    // Правильно кодируем имя файла для поддержки кириллицы
    const encodedFilename = encodeURIComponent(file.originalName);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');

    // Резолвим абсолютный путь от текущей директории
    const absolutePath = path.resolve(file.path);
    res.sendFile(absolutePath);
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Удалить файл
router.delete('/:id/files/:fileId', authenticate, async (req, res) => {
  try {
    const file = await AccreditationFile.findOne({
      where: {
        id: req.params.fileId,
        accreditationId: req.params.id
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Удаляем файл с диска
    try {
      await fs.unlink(file.path);
    } catch (err) {
      console.error('Error deleting file from disk:', err);
    }

    await file.destroy();

    res.json({ message: 'File deleted' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;