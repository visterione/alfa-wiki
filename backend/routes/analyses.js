const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const axios = require('axios');
const qs = require('qs');
const { Analysis, SearchIndex } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКА: Укажи slug wiki-страницы с анализами
// ═══════════════════════════════════════════════════════════════
const ANALYSES_PAGE_SLUG = 'analyses'; // <-- ЗАМЕНИ НА СВОЙ SLUG
// ═══════════════════════════════════════════════════════════════

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

// === HELPER: Индексация анализа для поиска ===
const indexAnalysis = async (analysis) => {
  const searchContent = [
    analysis.medCenter,
    analysis.serviceCode,
    analysis.serviceName,
    analysis.price ? `${analysis.price} руб` : '',
    analysis.isStopped ? 'не выполняется' : 'выполняется',
    analysis.comment
  ].filter(Boolean).join(' | ');

  const title = `${analysis.serviceName} (${analysis.medCenter})`;

  const keywords = [
    analysis.medCenter?.toLowerCase(),
    analysis.serviceCode?.toLowerCase(),
    analysis.serviceName?.toLowerCase().split(' '),
    'анализ',
    'лаборатория',
    'исследование',
    'диагностика'
  ].flat().filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'analysis',
    entityId: analysis.id,
    title: title,
    content: searchContent,
    keywords: keywords,
    url: `/page/${ANALYSES_PAGE_SLUG}?highlight=${analysis.id}`,
    metadata: {
      pageSlug: ANALYSES_PAGE_SLUG,
      medCenter: analysis.medCenter,
      serviceCode: analysis.serviceCode,
      serviceName: analysis.serviceName,
      price: analysis.price,
      isStopped: analysis.isStopped
    }
  });
};

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/analyses - Получить все анализы с фильтрацией и сортировкой
router.get('/', authenticate, async (req, res) => {
  try {
    const {
      search = '',
      medCenter = '',
      isStopped = '',
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

    const validSortFields = ['medCenter', 'serviceCode', 'serviceName', 'price', 'isStopped', 'createdAt'];
    const validSortOrders = ['ASC', 'DESC'];
    
    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'serviceName';
    const finalSortOrder = validSortOrders.includes(sortOrder) ? sortOrder : 'ASC';

    const analyses = await Analysis.findAll({
      where,
      order: [[finalSortBy, finalSortOrder]],
      attributes: [
        'id', 
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

    res.json(analyses);
  } catch (error) {
    console.error('Error fetching analyses:', error);
    res.status(500).json({ error: 'Ошибка при получении данных анализов' });
  }
});

// GET /api/analyses/stats - Статистика
router.get('/stats', authenticate, async (req, res) => {
  try {
    const [stats] = await Analysis.sequelize.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE "isStopped" = true) as stopped,
        COUNT(DISTINCT "medCenter") as centers,
        ROUND(AVG(price), 2) as avg_price
      FROM analyses
    `);

    res.json(stats[0]);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Ошибка при получении статистики' });
  }
});

// GET /api/analyses/medcenters - Список уникальных медцентров
router.get('/medcenters', authenticate, async (req, res) => {
  try {
    const [centers] = await Analysis.sequelize.query(`
      SELECT DISTINCT "medCenter" 
      FROM analyses 
      ORDER BY "medCenter"
    `);

    res.json(centers.map(c => c.medCenter));
  } catch (error) {
    console.error('Error fetching medcenters:', error);
    res.status(500).json({ error: 'Ошибка при получении списка медцентров' });
  }
});

// POST /api/analyses/search-mis - Поиск анализов в МИС API
router.post('/search-mis', authenticate, async (req, res) => {
  try {
    const { term, clinic_id } = req.body;

    if (!term || term.length < 2) {
      return res.json({ success: false, data: [], message: 'Минимум 2 символа для поиска' });
    }

    console.log('🔍 Поиск анализов в МИС:', { term, clinic_id });

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

    // Фильтруем только лабораторные анализы (можно настроить по категориям)
    const analyses = misData.data.map(service => ({
      service_id: service.service_id,
      code: service.code || service.sub_code || '',
      title: service.title,
      price: parseFloat(service.price) || 0,
      category: service.category_title || '',
      lab: service.lab || '',
      preparation: service.preparation || ''
    }));

    res.json({ success: true, data: analyses });
  } catch (error) {
    console.error('Error searching MIS:', error);
    res.status(500).json({ success: false, error: 'Ошибка при поиске в МИС' });
  }
});

// POST /api/analyses - Создать анализ
router.post('/', 
  authenticate,
  [
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
        medCenter,
        serviceCode,
        serviceName,
        price,
        isStopped = false,
        preparationLink = '',
        comment = '',
        misServiceId = null
      } = req.body;

      const analysis = await Analysis.create({
        medCenter,
        serviceCode,
        serviceName,
        price,
        isStopped,
        preparationLink,
        comment,
        misServiceId,
        lastPriceUpdate: misServiceId ? new Date() : null
      });

      // Индексация для поиска
      await indexAnalysis(analysis);

      res.status(201).json(analysis);
    } catch (error) {
      console.error('Error creating analysis:', error);
      res.status(500).json({ error: 'Ошибка при создании анализа' });
    }
  }
);

// PUT /api/analyses/:id - Обновить анализ
router.put('/:id',
  authenticate,
  [
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
        medCenter,
        serviceCode,
        serviceName,
        price,
        isStopped,
        preparationLink,
        comment,
        misServiceId
      } = req.body;

      const analysis = await Analysis.findByPk(id);
      if (!analysis) {
        return res.status(404).json({ error: 'Анализ не найден' });
      }

      await analysis.update({
        medCenter,
        serviceCode,
        serviceName,
        price,
        isStopped,
        preparationLink,
        comment,
        misServiceId
      });

      // Обновляем индекс
      await indexAnalysis(analysis);

      res.json(analysis);
    } catch (error) {
      console.error('Error updating analysis:', error);
      res.status(500).json({ error: 'Ошибка при обновлении анализа' });
    }
  }
);

// PATCH /api/analyses/:id/toggle-stop - Переключить статус СТОП
router.patch('/:id/toggle-stop', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const analysis = await Analysis.findByPk(id);
    if (!analysis) {
      return res.status(404).json({ error: 'Анализ не найден' });
    }

    await analysis.update({ isStopped: !analysis.isStopped });
    await indexAnalysis(analysis);

    res.json(analysis);
  } catch (error) {
    console.error('Error toggling stop status:', error);
    res.status(500).json({ error: 'Ошибка при обновлении статуса' });
  }
});

// DELETE /api/analyses/:id - Удалить анализ
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const analysis = await Analysis.findByPk(id);
    if (!analysis) {
      return res.status(404).json({ error: 'Анализ не найден' });
    }

    // Удаляем из индекса
    await SearchIndex.destroy({
      where: {
        entityType: 'analysis',
        entityId: id
      }
    });

    await analysis.destroy();

    res.json({ message: 'Анализ удален' });
  } catch (error) {
    console.error('Error deleting analysis:', error);
    res.status(500).json({ error: 'Ошибка при удалении анализа' });
  }
});

// POST /api/analyses/update-prices - Обновить цены из МИС (для cron)
router.post('/update-prices', authenticate, async (req, res) => {
  try {
    console.log('🔄 Запуск обновления цен анализов из МИС...');

    const analysesWithMisId = await Analysis.findAll({
      where: {
        misServiceId: { [Op.ne]: null }
      }
    });

    if (analysesWithMisId.length === 0) {
      return res.json({ message: 'Нет анализов с привязкой к МИС', updated: 0 });
    }

    // Группируем ID услуг для массового запроса
    const serviceIds = analysesWithMisId.map(a => a.misServiceId).join(',');

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
    for (const analysis of analysesWithMisId) {
      const newPrice = priceMap.get(analysis.misServiceId);
      if (newPrice !== undefined && newPrice !== analysis.price) {
        await analysis.update({
          price: newPrice,
          lastPriceUpdate: new Date()
        });
        await indexAnalysis(analysis);
        updated++;
      }
    }

    console.log(`✅ Обновлено цен: ${updated} из ${analysesWithMisId.length}`);

    res.json({ 
      message: 'Цены обновлены', 
      total: analysesWithMisId.length,
      updated: updated 
    });
  } catch (error) {
    console.error('Error updating prices:', error);
    res.status(500).json({ error: 'Ошибка при обновлении цен' });
  }
});

module.exports = router;