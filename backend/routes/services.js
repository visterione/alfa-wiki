const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const axios = require('axios');
const qs = require('qs');
const { Service, SearchIndex } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// MIS API конфигурация
const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 15000;

// === HELPER: Запрос к MIS API ===
const misRequest = async (endpoint, params = {}) => {
  try {
    const response = await axios.post(
      `${MIS_BASE_URL}/${endpoint}`,
      qs.stringify({ api_key: MIS_API_KEY, ...params }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: MIS_TIMEOUT
      }
    );
    return response.data;
  } catch (err) {
    console.error(`MIS API error (${endpoint}):`, err.message);
    return null;
  }
};

// === HELPER: Индексация услуги для поиска ===
const indexService = async (service) => {
  const searchContent = [
    service.medCenter,
    service.serviceCode,
    service.serviceName,
    service.price ? `${service.price} руб` : '',
    service.isStopped ? 'не выполняется' : 'выполняется',
    service.comment
  ].filter(Boolean).join(' | ');

  const title = service.serviceName;

  const keywords = [
    service.medCenter?.toLowerCase(),
    service.serviceCode?.toLowerCase(),
    service.serviceName?.toLowerCase().split(' '),
    'услуга',
    'сервис',
    'медицинская услуга'
  ].flat().filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'service',
    entityId: service.id,
    title: title,
    content: searchContent,
    keywords: keywords,
    url: `/page/${service.pageSlug}?highlight=${service.id}`,
    metadata: {
      pageSlug: service.pageSlug,
      medCenter: service.medCenter,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      price: service.price,
      isStopped: service.isStopped
    }
  });
};

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/services - Получить все услуги с фильтрацией и сортировкой
router.get('/', authenticate, async (req, res) => {
  try {
    const {
      search = '',
      medCenter = '',
      isStopped = '',
      pageSlug = '',
      sortBy = 'serviceName',
      sortOrder = 'ASC'
    } = req.query;

    const where = {};

    if (search) {
      where[Op.or] = [
        { serviceName: { [Op.iLike]: `%${search}%` } },
        { serviceCode: { [Op.iLike]: `%${search}%` } },
        { comment: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (medCenter) {
      where.medCenter = medCenter;
    }

    if (isStopped !== '') {
      where.isStopped = isStopped === 'true';
    }

    if (pageSlug) {
      where.pageSlug = pageSlug;
    }

    const validSortFields = ['medCenter', 'serviceCode', 'serviceName', 'price', 'isStopped', 'createdAt'];
    const validSortOrders = ['ASC', 'DESC'];

    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'serviceName';
    const finalSortOrder = validSortOrders.includes(sortOrder) ? sortOrder : 'ASC';

    const services = await Service.findAll({
      where,
      order: [[finalSortBy, finalSortOrder]],
      attributes: [
        'id',
        'pageSlug',
        'medCenter',
        'serviceCode',
        'serviceName',
        'price',
        'isStopped',
        'preparationLink',
        'comment',
        'misServiceId',
        'lastPriceUpdate',
        'createdAt'
      ]
    });

    res.json(services);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Ошибка при получении данных услуг' });
  }
});

// GET /api/services/stats - Статистика по конкретной странице
router.get('/stats', authenticate, async (req, res) => {
  try {
    const { pageSlug } = req.query;

    let whereClause = '';
    if (pageSlug) {
      whereClause = `WHERE "pageSlug" = '${pageSlug}'`;
    }

    const [stats] = await Service.sequelize.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE "isStopped" = true) as stopped,
        COUNT(DISTINCT "medCenter") as centers,
        ROUND(AVG(price), 2) as avg_price
      FROM services
      ${whereClause}
    `);

    res.json(stats[0]);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Ошибка при получении статистики' });
  }
});

// GET /api/services/medcenters - Список уникальных медцентров для конкретной страницы
router.get('/medcenters', authenticate, async (req, res) => {
  try {
    const { pageSlug } = req.query;

    let whereClause = '';
    if (pageSlug) {
      whereClause = `WHERE "pageSlug" = '${pageSlug}'`;
    }

    const [centers] = await Service.sequelize.query(`
      SELECT DISTINCT "medCenter"
      FROM services
      ${whereClause}
      ORDER BY "medCenter"
    `);

    res.json(centers.map(c => c.medCenter));
  } catch (error) {
    console.error('Error fetching medcenters:', error);
    res.status(500).json({ error: 'Ошибка при получении списка медцентров' });
  }
});

// POST /api/services/search-mis - Поиск услуг в МИС API
router.post('/search-mis', authenticate, async (req, res) => {
  try {
    const { term, clinic_id } = req.body;

    if (!term || term.length < 2) {
      return res.json({ success: false, data: [], message: 'Минимум 2 символа для поиска' });
    }

    console.log('🔍 Поиск услуг в МИС:', { term, clinic_id });

    const params = {
      term: term,
      limit: 50
    };

    if (clinic_id) {
      params.clinic_id = clinic_id;
    }

    const misData = await misRequest('getServices', params);

    if (!misData || misData.error !== 0 || !Array.isArray(misData.data)) {
      return res.json({ success: false, data: [], message: 'Не удалось получить данные из МИС' });
    }

    const services = misData.data.map(service => ({
      service_id: service.service_id,
      code: service.code || service.sub_code || '',
      title: service.title,
      price: parseFloat(service.price) || 0,
      category: service.category_title || '',
      preparation: service.preparation || ''
    }));

    res.json({ success: true, data: services });
  } catch (error) {
    console.error('Error searching MIS:', error);
    res.status(500).json({ success: false, error: 'Ошибка при поиске в МИС' });
  }
});

// POST /api/services - Создать услугу
router.post('/',
  authenticate,
  [
    body('pageSlug').notEmpty().withMessage('Slug страницы обязателен'),
    body('medCenter').notEmpty().withMessage('Медцентр обязателен'),
    body('serviceCode').notEmpty().withMessage('Код услуги обязателен'),
    body('serviceName').notEmpty().withMessage('Название обязательно'),
    body('price').isFloat({ min: 0 }).withMessage('Цена должна быть положительным числом')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const {
        pageSlug,
        medCenter,
        serviceCode,
        serviceName,
        price,
        preparationLink = '',
        comment = '',
        misServiceId = null
      } = req.body;

      const service = await Service.create({
        pageSlug,
        medCenter,
        serviceCode,
        serviceName,
        price,
        isStopped: false,
        preparationLink,
        comment,
        misServiceId,
        lastPriceUpdate: misServiceId ? new Date() : null
      });

      // Индексация для поиска
      await indexService(service);

      res.status(201).json(service);
    } catch (error) {
      console.error('Error creating service:', error);
      res.status(500).json({ error: 'Ошибка при создании услуги' });
    }
  }
);

// PUT /api/services/:id - Обновить услугу
router.put('/:id',
  authenticate,
  [
    body('pageSlug').notEmpty().withMessage('Slug страницы обязателен'),
    body('medCenter').notEmpty().withMessage('Медцентр обязателен'),
    body('serviceCode').notEmpty().withMessage('Код услуги обязателен'),
    body('serviceName').notEmpty().withMessage('Название обязательно'),
    body('price').isFloat({ min: 0 }).withMessage('Цена должна быть положительным числом')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const {
        pageSlug,
        medCenter,
        serviceCode,
        serviceName,
        price,
        preparationLink,
        comment,
        misServiceId
      } = req.body;

      const service = await Service.findByPk(id);
      if (!service) {
        return res.status(404).json({ error: 'Услуга не найдена' });
      }

      await service.update({
        pageSlug,
        medCenter,
        serviceCode,
        serviceName,
        price,
        preparationLink,
        comment,
        misServiceId
      });

      // Обновляем индекс
      await indexService(service);

      res.json(service);
    } catch (error) {
      console.error('Error updating service:', error);
      res.status(500).json({ error: 'Ошибка при обновлении услуги' });
    }
  }
);

// DELETE /api/services/:id - Удалить услугу
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const service = await Service.findByPk(id);
    if (!service) {
      return res.status(404).json({ error: 'Услуга не найдена' });
    }

    // Удаляем из индекса
    await SearchIndex.destroy({
      where: {
        entityType: 'service',
        entityId: id
      }
    });

    await service.destroy();

    res.json({ message: 'Услуга удалена' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ error: 'Ошибка при удалении услуги' });
  }
});

// POST /api/services/update-prices - Обновить цены из МИС (для cron)
router.post('/update-prices', authenticate, async (req, res) => {
  try {
    const { pageSlug } = req.body;

    console.log('🔄 Запуск обновления цен услуг из МИС...');

    const where = {
      misServiceId: { [Op.ne]: null }
    };

    if (pageSlug) {
      where.pageSlug = pageSlug;
    }

    const servicesWithMisId = await Service.findAll({ where });

    if (servicesWithMisId.length === 0) {
      return res.json({ message: 'Нет услуг с привязкой к МИС', updated: 0 });
    }

    // Группируем ID услуг для массового запроса
    const serviceIds = servicesWithMisId.map(s => s.misServiceId).join(',');

    const misData = await misRequest('getServices', {
      service_id: serviceIds
    });

    if (!misData || misData.error !== 0 || !Array.isArray(misData.data)) {
      return res.status(500).json({ error: 'Не удалось получить данные из МИС' });
    }

    // Создаем карту цен из МИС
    const priceMap = new Map();
    misData.data.forEach(service => {
      priceMap.set(service.service_id.toString(), parseFloat(service.price) || 0);
    });

    // Обновляем цены
    let updated = 0;
    for (const service of servicesWithMisId) {
      const newPrice = priceMap.get(service.misServiceId);
      if (newPrice !== undefined && newPrice !== service.price) {
        await service.update({
          price: newPrice,
          lastPriceUpdate: new Date()
        });
        await indexService(service);
        updated++;
      }
    }

    console.log(`✅ Обновлено цен: ${updated} из ${servicesWithMisId.length}`);

    res.json({
      message: 'Цены обновлены',
      total: servicesWithMisId.length,
      updated: updated
    });
  } catch (error) {
    console.error('Error updating prices:', error);
    res.status(500).json({ error: 'Ошибка при обновлении цен' });
  }
});

module.exports = router;
