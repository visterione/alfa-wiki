/**
 * API для страницы "Услуги партнёров"
 * Работает с кэшем partner_service_cache, заполняемым ночным кроном
 */

const express = require('express');
const router = express.Router();
const { PartnerServiceCache, sequelize } = require('../models');
const { Op } = require('sequelize');
const { authenticate } = require('../middleware/auth');
const { syncPartnerServicesCache } = require('../cron/partnerServicesCacheCron');

const CLINICS = [
  { id: 2, name: 'Альфа',  code: 'А',  color: '#FF80AB' },
  { id: 3, name: 'Кидс',   code: 'К',  color: '#FFA726' },
  { id: 1, name: 'Проф',   code: 'П',  color: '#7E57C2' },
  { id: 6, name: 'Линия',  code: 'Л',  color: '#C5E1A5' },
  { id: 4, name: '3К',     code: '3К', color: '#BA68C8' },
  { id: 7, name: 'Смайл',  code: 'С',  color: '#555555' }
];

// ─── GET /api/partner-services/clinics ───────────────────────────────────────
router.get('/clinics', authenticate, (req, res) => {
  res.json({ success: true, data: CLINICS });
});

// ─── GET /api/partner-services/sync-status ───────────────────────────────────
// Возвращает дату последней синхронизации и кол-во записей для каждого медцентра
router.get('/sync-status', authenticate, async (req, res) => {
  try {
    const stats = await Promise.all(
      CLINICS.map(async (clinic) => {
        const count = await PartnerServiceCache.count({ where: { clinicId: clinic.id } });
        const latest = await PartnerServiceCache.findOne({
          where: { clinicId: clinic.id },
          attributes: ['syncedAt'],
          order: [['syncedAt', 'DESC']]
        });
        return {
          clinicId: clinic.id,
          clinicName: clinic.name,
          count,
          lastSync: latest ? latest.syncedAt : null
        };
      })
    );
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ /partner-services/sync-status:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка получения статуса синхронизации' });
  }
});

// ─── POST /api/partner-services/sync ─────────────────────────────────────────
// Ручной запуск синхронизации (только для admins)
router.post('/sync', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Только для администраторов' });
    }
    // Запускаем в фоне, не ждём завершения
    syncPartnerServicesCache().then(result => {
      console.log('✅ [PARTNER-SYNC] Ручная синхронизация завершена:', result);
    }).catch(err => {
      console.error('❌ [PARTNER-SYNC] Ошибка ручной синхронизации:', err.message);
    });
    res.json({ success: true, message: 'Синхронизация запущена в фоновом режиме' });
  } catch (err) {
    console.error('❌ /partner-services/sync:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка запуска синхронизации' });
  }
});

// ─── GET /api/partner-services/categories?clinic_id= ─────────────────────────
// Список уникальных категорий для дропдауна фильтра
router.get('/categories', authenticate, async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id обязателен' });

    const rows = await PartnerServiceCache.findAll({
      where: { clinicId, isDeleted: false },
      attributes: [
        [sequelize.fn('DISTINCT', sequelize.col('categoryTitle')), 'categoryTitle'],
        'categoryId'
      ],
      order: [['categoryTitle', 'ASC']],
      raw: true
    });

    // Уникальные, убираем null
    const seen = new Set();
    const categories = [];
    for (const r of rows) {
      if (r.categoryTitle && !seen.has(r.categoryTitle)) {
        seen.add(r.categoryTitle);
        categories.push({ id: r.categoryId, title: r.categoryTitle });
      }
    }

    res.json({ success: true, data: categories });
  } catch (err) {
    console.error('❌ /partner-services/categories:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка получения категорий' });
  }
});

// ─── GET /api/partner-services/labs?clinic_id= ───────────────────────────────
// Список уникальных лабораторий для дропдауна фильтра
router.get('/labs', authenticate, async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id обязателен' });

    const rows = await sequelize.query(
      `SELECT DISTINCT lab FROM partner_service_cache
       WHERE "clinicId" = :clinicId AND lab IS NOT NULL AND lab != '' AND "isDeleted" = false
       ORDER BY lab ASC`,
      { replacements: { clinicId }, type: sequelize.QueryTypes.SELECT }
    );

    res.json({ success: true, data: rows.map(r => r.lab) });
  } catch (err) {
    console.error('❌ /partner-services/labs:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка получения лабораторий' });
  }
});

// ─── GET /api/partner-services/tree-structure?clinic_id= ────────────────────
// Лёгкое дерево категорий без услуг (только counts) для ленивой загрузки
router.get('/tree-structure', authenticate, async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id обязателен' });

    const rows = await sequelize.query(
      `SELECT "categoryPath", "categoryTitle", "categoryId", COUNT(*) AS count
       FROM partner_service_cache
       WHERE "clinicId" = :clinicId AND "isDeleted" = false
       GROUP BY "categoryPath", "categoryTitle", "categoryId"
       ORDER BY "categoryPath" ASC`,
      { replacements: { clinicId }, type: sequelize.QueryTypes.SELECT }
    );

    const root = {};
    for (const r of rows) {
      const path = r.categoryPath || r.categoryTitle || 'Без категории';
      const parts = path.split(' > ').flatMap(p => p.split(' / ')).map(p => p.trim()).filter(Boolean);
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!node[part]) node[part] = { __selfCount: 0, __categoryTitle: part, __categoryId: null };
        if (i === parts.length - 1) {
          node[part].__selfCount += parseInt(r.count) || 0;
          node[part].__categoryId = r.categoryId;
          node[part].__categoryTitle = r.categoryTitle || part;
        }
        node = node[part];
      }
    }

    const toArray = (node, name) => {
      const children = Object.entries(node)
        .filter(([k]) => !k.startsWith('__'))
        .map(([k, v]) => toArray(v, k));
      const selfCount = node.__selfCount || 0;
      const totalCount = children.reduce((sum, c) => sum + c.totalCount, 0) + selfCount;
      return {
        name,
        totalCount,
        selfCount,
        categoryTitle: node.__categoryTitle || name,
        categoryId: node.__categoryId,
        children
      };
    };

    const tree = Object.entries(root).map(([k, v]) => toArray(v, k));
    res.json({ success: true, data: tree });
  } catch (err) {
    console.error('❌ /partner-services/tree-structure:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка построения структуры дерева' });
  }
});

// ─── GET /api/partner-services/tree?clinic_id= ───────────────────────────────
// Дерево категорий с вложенными услугами (для Tree-вида)
// Строится из categoryPath: "Раздел > Подраздел > Категория"
router.get('/tree', authenticate, async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id обязателен' });

    const search = (req.query.search || '').trim().toLowerCase();

    const where = { clinicId, isDeleted: false };
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } },
        { subCode: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const TREE_LIMIT = 3000;

    const services = await PartnerServiceCache.findAll({
      where,
      attributes: ['serviceId', 'code', 'subCode', 'title', 'categoryTitle', 'categoryPath', 'price', 'duration', 'lab'],
      order: [['categoryPath', 'ASC'], ['title', 'ASC']],
      limit: TREE_LIMIT
    });

    const truncated = services.length === TREE_LIMIT;

    // Строим дерево из categoryPath
    const root = {};
    for (const s of services) {
      const path = s.categoryPath || s.categoryTitle || 'Без категории';
      const parts = path.split(' > ').flatMap(p => p.split(' / ')).map(p => p.trim()).filter(Boolean);

      let node = root;
      for (const part of parts) {
        if (!node[part]) node[part] = { __services: [] };
        node = node[part];
      }
      if (!node.__services) node.__services = [];
      node.__services.push({
        serviceId: s.serviceId,
        code: s.code,
        subCode: s.subCode,
        title: s.title,
        price: s.price,
        duration: s.duration,
        lab: s.lab
      });
    }

    // Рекурсивно конвертируем объект в массив
    const toArray = (node, name) => {
      const subNodes = Object.entries(node)
        .filter(([k]) => k !== '__services')
        .map(([k, v]) => toArray(v, k));
      return {
        name,
        services: node.__services || [],
        children: subNodes
      };
    };

    const tree = Object.entries(root).map(([k, v]) => toArray(v, k));
    res.json({ success: true, data: tree, total: services.length, truncated });
  } catch (err) {
    console.error('❌ /partner-services/tree:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка построения дерева' });
  }
});

// ─── GET /api/partner-services ────────────────────────────────────────────────
// Список с серверной пагинацией, поиском и фильтрами
router.get('/', authenticate, async (req, res) => {
  try {
    const clinicId = parseInt(req.query.clinic_id);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id обязателен' });

    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(200, Math.max(10, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const category       = (req.query.category || '').trim();
    const lab            = (req.query.lab || '').trim();
    const categoryId     = parseInt(req.query.category_id) || null;
    const categoryPrefix = (req.query.category_prefix || '').trim();
    const filterCode     = (req.query.filter_code || '').trim();
    const filterSub      = (req.query.filter_subcode || '').trim();
    const filterTitle    = (req.query.filter_title || '').trim();

    const where = { clinicId, isDeleted: false };

    if (filterCode)  where.code     = { [Op.iLike]: `%${filterCode}%` };
    if (filterSub)   where.subCode  = { [Op.iLike]: `%${filterSub}%` };
    if (filterTitle) where.title    = { [Op.iLike]: `%${filterTitle}%` };
    if (categoryId) {
      where.categoryId = categoryId;
    } else if (categoryPrefix) {
      where.categoryTitle = { [Op.or]: [
        categoryPrefix,
        { [Op.iLike]: `${categoryPrefix} / %` }
      ]};
    } else if (category) {
      where.categoryTitle = { [Op.iLike]: `%${category}%` };
    }
    if (lab) {
      where.lab = { [Op.iLike]: `%${lab}%` };
    }

    const { count, rows } = await PartnerServiceCache.findAndCountAll({
      where,
      attributes: ['id', 'serviceId', 'code', 'subCode', 'title', 'categoryTitle', 'categoryPath', 'price', 'duration', 'lab'],
      order: [['categoryTitle', 'ASC'], ['title', 'ASC']],
      limit,
      offset
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    console.error('❌ /partner-services:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка получения услуг' });
  }
});

module.exports = router;
