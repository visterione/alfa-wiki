const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { Vehicle, VehicleFile, SearchIndex } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// === MULTER CONFIGURATION ===
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.env.UPLOAD_PATH || './uploads', 'vehicles');
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
    cb(null, 'vehicle-' + uniqueSuffix + ext);
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

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКА: Укажи slug wiki-страницы с ТО
// Посмотри URL страницы в браузере: /page/ЭТОТ_SLUG
// ═══════════════════════════════════════════════════════════════
const VEHICLES_PAGE_SLUG = 'vehicles'; // <-- ЗАМЕНИ НА СВОЙ SLUG
// ═══════════════════════════════════════════════════════════════

// === HELPER: Индексация ТС для поиска ===
const indexVehicle = async (vehicle) => {
  const searchContent = [
    vehicle.carBrand,
    vehicle.organization,
    vehicle.licensePlate,
    vehicle.condition,
    vehicle.comment
  ].filter(Boolean).join(' | ');

  const title = `${vehicle.carBrand} — ${vehicle.licensePlate}`;

  const keywords = [
    vehicle.organization?.toLowerCase(),
    vehicle.carBrand?.toLowerCase(),
    vehicle.licensePlate?.toLowerCase(),
    'авто',
    'машина',
    'транспорт',
    'то',
    'страховка'
  ].filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'vehicle',
    entityId: vehicle.id,
    title: title,
    content: searchContent,
    keywords: keywords,
    url: `/page/${VEHICLES_PAGE_SLUG}?highlight=${vehicle.id}`,
    metadata: {
      pageSlug: VEHICLES_PAGE_SLUG, // <-- Добавлена привязка к родительской странице
      organization: vehicle.organization,
      licensePlate: vehicle.licensePlate,
      carBrand: vehicle.carBrand,
      insuranceDate: vehicle.insuranceDate,
      mileage: vehicle.mileage,
      nextTO: vehicle.nextTO
    }
  });
};

// === HELPER: Удаление из индекса ===
const removeFromIndex = async (vehicleId) => {
  await SearchIndex.destroy({
    where: {
      entityType: 'vehicle',
      entityId: vehicleId
    }
  });
};

// === HELPER: Полная переиндексация всех ТС ===
const reindexAllVehicles = async () => {
  await SearchIndex.destroy({
    where: { entityType: 'vehicle' }
  });

  const allVehicles = await Vehicle.findAll();

  for (const veh of allVehicles) {
    await indexVehicle(veh);
  }

  return allVehicles.length;
};

// Получить все ТС с фильтрацией
router.get('/', authenticate, async (req, res) => {
  try {
    const { organization, condition, search, sortBy = 'insuranceDate', sortOrder = 'ASC', archived } = req.query;

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

    if (organization) where.organization = { [Op.iLike]: `%${organization}%` };
    if (condition) where.condition = condition;
    if (search) {
      where[Op.or] = [
        { carBrand: { [Op.iLike]: `%${search}%` } },
        { licensePlate: { [Op.iLike]: `%${search}%` } },
        { organization: { [Op.iLike]: `%${search}%` } },
        { comment: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const order = [[sortBy, sortOrder.toUpperCase()]];

    const vehicles = await Vehicle.findAll({ where, order });
    res.json(vehicles);
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// Получить уникальные организации для выпадающего списка
router.get('/organizations', authenticate, async (req, res) => {
  try {
    const result = await Vehicle.findAll({
      attributes: ['organization'],
      group: ['organization'],
      order: [['organization', 'ASC']]
    });
    res.json(result.map(r => r.organization));
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// Статистика по ТС
router.get('/stats', authenticate, async (req, res) => {
  try {
    const today = new Date();
    const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    const allVehicles = await Vehicle.findAll({
      attributes: ['mileage', 'nextTO']
    });

    const needsTO = allVehicles.filter(v => (v.nextTO - v.mileage) <= 5000).length;

    const [total, expired, expiringSoon] = await Promise.all([
      Vehicle.count(),
      Vehicle.count({ where: { insuranceDate: { [Op.lt]: today } } }),
      Vehicle.count({ where: { insuranceDate: { [Op.between]: [today, in30Days] } } })
    ]);

    res.json({ total, expired, expiringSoon, needsTO });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Полная переиндексация (для админа)
router.post('/reindex', authenticate, async (req, res) => {
  try {
    const count = await reindexAllVehicles();
    res.json({ 
      message: 'Reindex completed', 
      indexed: count 
    });
  } catch (error) {
    console.error('Reindex error:', error);
    res.status(500).json({ error: 'Failed to reindex vehicles' });
  }
});

// Создать ТС
router.post('/', authenticate, [
  body('organization').trim().notEmpty().withMessage('Организация обязательна'),
  body('carBrand').trim().notEmpty().withMessage('Марка авто обязательна'),
  body('licensePlate').trim().notEmpty().withMessage('Гос. номер обязателен'),
  body('carYear').isInt({ min: 1990, max: 2030 }).withMessage('Некорректный год'),
  body('mileage').isInt({ min: 0 }).withMessage('Некорректный пробег'),
  body('nextTO').isInt({ min: 0 }).withMessage('Некорректное значение ТО'),
  body('insuranceDate').isDate().withMessage('Некорректная дата страховки'),
  body('condition').isIn(['Хорошее', 'Удовлетворительное', 'Плохое']).withMessage('Некорректное состояние')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { organization, carBrand, licensePlate, carYear, mileage, nextTO, insuranceDate, condition, comment } = req.body;
    
    const vehicle = await Vehicle.create({
      organization, carBrand, licensePlate, carYear, mileage, nextTO, insuranceDate, condition, comment
    });

    await indexVehicle(vehicle);

    res.status(201).json(vehicle);
  } catch (error) {
    console.error('Create vehicle error:', error);
    res.status(500).json({ error: 'Failed to create vehicle' });
  }
});

// Обновить ТС
router.put('/:id', authenticate, [
  body('organization').optional().trim().notEmpty(),
  body('carBrand').optional().trim().notEmpty(),
  body('licensePlate').optional().trim().notEmpty(),
  body('carYear').optional().isInt({ min: 1990, max: 2030 }),
  body('mileage').optional().isInt({ min: 0 }),
  body('nextTO').optional().isInt({ min: 0 }),
  body('insuranceDate').optional().isDate(),
  body('condition').optional().isIn(['Хорошее', 'Удовлетворительное', 'Плохое'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const vehicle = await Vehicle.findByPk(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const { organization, carBrand, licensePlate, carYear, mileage, nextTO, insuranceDate, condition, comment } = req.body;
    
    // При обновлении пробега или nextTO сбрасываем флаг напоминания о ТО
    const shouldResetTOReminder = (mileage !== undefined && mileage !== vehicle.mileage) || 
                                   (nextTO !== undefined && nextTO !== vehicle.nextTO);
    
    await vehicle.update({
      ...(organization && { organization }),
      ...(carBrand && { carBrand }),
      ...(licensePlate && { licensePlate }),
      ...(carYear && { carYear }),
      ...(mileage !== undefined && { mileage }),
      ...(nextTO !== undefined && { nextTO }),
      ...(insuranceDate && { insuranceDate }),
      ...(condition && { condition }),
      ...(comment !== undefined && { comment }),
      ...(shouldResetTOReminder && { remindedTO: false })
    });

    await indexVehicle(vehicle);

    res.json(vehicle);
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({ error: 'Failed to update vehicle' });
  }
});

// Переместить в архив / вернуть из архива
router.patch('/:id/archive', authenticate, async (req, res) => {
  try {
    const vehicle = await Vehicle.findByPk(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // Переключаем статус архивирования
    const isArchived = req.body.isArchived !== undefined ? req.body.isArchived : !vehicle.isArchived;
    await vehicle.update({ isArchived });

    res.json(vehicle);
  } catch (error) {
    console.error('Archive vehicle error:', error);
    res.status(500).json({ error: 'Failed to archive vehicle' });
  }
});

// Удалить ТС
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const vehicle = await Vehicle.findByPk(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const vehId = vehicle.id;

    // Удаляем все связанные файлы
    const files = await VehicleFile.findAll({ where: { vehicleId: vehId } });
    for (const file of files) {
      try {
        await fs.unlink(file.path);
      } catch (err) {
        console.error('Error deleting file:', err);
      }
      await file.destroy();
    }

    await vehicle.destroy();

    await removeFromIndex(vehId);

    res.json({ message: 'Vehicle deleted' });
  } catch (error) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

// ═══════════════════════════════════════════════════════════════
// FILE MANAGEMENT ROUTES
// ═══════════════════════════════════════════════════════════════

// Получить список файлов ТС
router.get('/:id/files', authenticate, async (req, res) => {
  try {
    const vehicle = await Vehicle.findByPk(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const files = await VehicleFile.findAll({
      where: { vehicleId: req.params.id },
      order: [['createdAt', 'DESC']]
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(files);
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Загрузить файл(ы) к ТС
router.post('/:id/files', authenticate, upload.array('files', 10), async (req, res) => {
  try {
    const vehicle = await Vehicle.findByPk(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadedFiles = [];
    for (const file of req.files) {
      // Исправляем кодировку имени файла (multer передает в latin1, нужно декодировать в utf8)
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      const vehicleFile = await VehicleFile.create({
        vehicleId: req.params.id,
        filename: file.filename,
        originalName: originalName,
        mimeType: file.mimetype,
        size: file.size,
        path: file.path,
        uploadedBy: req.user.id
      });
      uploadedFiles.push(vehicleFile);
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
    const file = await VehicleFile.findOne({
      where: {
        id: req.params.fileId,
        vehicleId: req.params.id
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
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
    const file = await VehicleFile.findOne({
      where: {
        id: req.params.fileId,
        vehicleId: req.params.id
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Удаляем физический файл
    try {
      await fs.unlink(file.path);
    } catch (err) {
      console.error('Error deleting physical file:', err);
    }

    // Удаляем запись из БД
    await file.destroy();

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;