const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { PriceComparison, PriceComparisonItem, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const PRICE_COMPARE_PAGE_SLUG = 'price-compare';

// === HELPER: Запись в историю страницы ===
async function recordHistory(pageSlug, userId, summary, changes = []) {
  try {
    const page = await Page.findOne({ where: { slug: pageSlug } });
    if (!page) return;
    await PageHistory.create({
      pageId: page.id,
      userId,
      action: 'updated',
      changesSummary: summary,
      metadata: { changes }
    });
  } catch (err) {
    console.error('History record error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/price-comparisons - Получить все сравнения пользователя
// ═══════════════════════════════════════════════════════════════
router.get('/', authenticate, async (req, res) => {
  try {
    const comparisons = await PriceComparison.findAll({
      where: { createdBy: req.user.id },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'name', 'description', 'competitors', 'ownMedCenters', 'createdAt', 'updatedAt']
    });

    res.json(comparisons);
  } catch (error) {
    console.error('Error fetching price comparisons:', error);
    res.status(500).json({ error: 'Ошибка при получении списка сравнений' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/price-comparisons/:id - Получить конкретное сравнение с items
// ═══════════════════════════════════════════════════════════════
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const comparison = await PriceComparison.findOne({
      where: {
        id,
        createdBy: req.user.id
      },
      include: [
        {
          model: PriceComparisonItem,
          as: 'items',
          attributes: ['id', 'serviceCode', 'serviceName', 'misServiceId', 'prices', 'priceHistory', 'sortOrder'],
          order: [['sortOrder', 'ASC']]
        }
      ]
    });

    if (!comparison) {
      return res.status(404).json({ error: 'Сравнение не найдено' });
    }

    res.json(comparison);
  } catch (error) {
    console.error('Error fetching price comparison:', error);
    res.status(500).json({ error: 'Ошибка при получении сравнения' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/price-comparisons - Создать новое сравнение
// ═══════════════════════════════════════════════════════════════
router.post('/',
  authenticate,
  [
    body('name').notEmpty().withMessage('Название сравнения обязательно'),
    body('ownMedCenters').isArray().withMessage('ownMedCenters должен быть массивом'),
    body('competitors').isArray().withMessage('competitors должен быть массивом')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const {
        name,
        description = '',
        ownMedCenters = [],
        competitors = []
      } = req.body;

      const comparison = await PriceComparison.create({
        name,
        description,
        ownMedCenters,
        competitors,
        createdBy: req.user.id
      });

      await recordHistory(
        PRICE_COMPARE_PAGE_SLUG,
        req.user.id,
        `Создано сравнение цен: ${name}`,
        [{ field: 'comparison', label: 'Создано сравнение', to: name }]
      );

      res.status(201).json(comparison);
    } catch (error) {
      console.error('Error creating price comparison:', error);
      res.status(500).json({ error: 'Ошибка при создании сравнения' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// PUT /api/price-comparisons/:id - Обновить сравнение
// ═══════════════════════════════════════════════════════════════
router.put('/:id',
  authenticate,
  [
    body('name').notEmpty().withMessage('Название сравнения обязательно'),
    body('ownMedCenters').isArray().withMessage('ownMedCenters должен быть массивом'),
    body('competitors').isArray().withMessage('competitors должен быть массивом')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const {
        name,
        description,
        ownMedCenters,
        competitors
      } = req.body;

      const comparison = await PriceComparison.findOne({
        where: {
          id,
          createdBy: req.user.id
        }
      });

      if (!comparison) {
        return res.status(404).json({ error: 'Сравнение не найдено' });
      }

      const oldName = comparison.name;
      await comparison.update({
        name,
        description,
        ownMedCenters,
        competitors
      });

      const changes = [];
      if (name !== oldName) {
        changes.push({ field: 'name', label: 'Название', from: oldName, to: name });
      }
      await recordHistory(
        PRICE_COMPARE_PAGE_SLUG,
        req.user.id,
        changes.length > 0 ? `Сравнение цен «${name}»: ${changes.map(c => `${c.label}: «${c.from}» → «${c.to}»`).join('; ')}` : `Обновлено сравнение цен: ${name}`,
        changes
      );

      res.json(comparison);
    } catch (error) {
      console.error('Error updating price comparison:', error);
      res.status(500).json({ error: 'Ошибка при обновлении сравнения' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// DELETE /api/price-comparisons/:id - Удалить сравнение
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const comparison = await PriceComparison.findOne({
      where: {
        id,
        createdBy: req.user.id
      }
    });

    if (!comparison) {
      return res.status(404).json({ error: 'Сравнение не найдено' });
    }

    const { name: compName } = comparison;
    await comparison.destroy();

    await recordHistory(
      PRICE_COMPARE_PAGE_SLUG,
      req.user.id,
      `Удалено сравнение цен: ${compName}`,
      [{ field: 'comparison', label: 'Удалено сравнение', from: compName }]
    );

    res.json({ message: 'Сравнение удалено' });
  } catch (error) {
    console.error('Error deleting price comparison:', error);
    res.status(500).json({ error: 'Ошибка при удалении сравнения' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/price-comparisons/:id/items - Добавить услугу в сравнение
// ═══════════════════════════════════════════════════════════════
router.post('/:id/items',
  authenticate,
  [
    body('serviceCode').notEmpty().withMessage('Код услуги обязателен'),
    body('serviceName').notEmpty().withMessage('Название услуги обязательно'),
    body('prices').isObject().withMessage('prices должен быть объектом')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const {
        serviceCode,
        serviceName,
        misServiceId = null,
        prices = {}
      } = req.body;

      // Проверяем, что сравнение принадлежит пользователю
      const comparison = await PriceComparison.findOne({
        where: {
          id,
          createdBy: req.user.id
        }
      });

      if (!comparison) {
        return res.status(404).json({ error: 'Сравнение не найдено' });
      }

      // Получаем максимальный sortOrder
      const maxSortOrder = await PriceComparisonItem.max('sortOrder', {
        where: { comparisonId: id }
      }) || 0;

      const item = await PriceComparisonItem.create({
        comparisonId: id,
        serviceCode,
        serviceName,
        misServiceId,
        prices,
        sortOrder: maxSortOrder + 1
      });

      res.status(201).json(item);
    } catch (error) {
      console.error('Error adding item to comparison:', error);
      res.status(500).json({ error: 'Ошибка при добавлении услуги' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// PUT /api/price-comparisons/:id/items/:itemId - Обновить услугу
// ═══════════════════════════════════════════════════════════════
router.put('/:id/items/:itemId',
  authenticate,
  [
    body('prices').isObject().withMessage('prices должен быть объектом')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id, itemId } = req.params;
      const { prices, serviceCode, serviceName } = req.body;

      // Проверяем, что сравнение принадлежит пользователю
      const comparison = await PriceComparison.findOne({
        where: {
          id,
          createdBy: req.user.id
        }
      });

      if (!comparison) {
        return res.status(404).json({ error: 'Сравнение не найдено' });
      }

      const item = await PriceComparisonItem.findOne({
        where: {
          id: itemId,
          comparisonId: id
        }
      });

      if (!item) {
        return res.status(404).json({ error: 'Услуга не найдена' });
      }

      // Обновляем историю изменений цен
      const oldPrices = item.prices || {};
      const newPrices = prices || {};
      const priceHistory = { ...(item.priceHistory || {}) }; // Создаем новый объект

      // Проходим по всем колонкам (медцентрам/конкурентам) и проверяем изменения
      Object.keys(newPrices).forEach(columnName => {
        const oldPrice = oldPrices[columnName];
        const newPrice = newPrices[columnName];

        // Если цена изменилась, добавляем запись в историю
        if (oldPrice !== newPrice && newPrice !== null && newPrice !== undefined && newPrice !== '') {
          if (!priceHistory[columnName]) {
            priceHistory[columnName] = [];
          }

          priceHistory[columnName].push({
            price: parseFloat(newPrice),
            userId: req.user.id,
            username: req.user.displayName || req.user.username,
            changedAt: new Date().toISOString()
          });
        }
      });

      const updateData = { prices, priceHistory };

      // Явно помечаем что JSONB поля изменились
      item.changed('prices', true);
      item.changed('priceHistory', true);
      if (serviceCode) updateData.serviceCode = serviceCode;
      if (serviceName) updateData.serviceName = serviceName;

      await item.update(updateData);

      // Перезагружаем item из БД чтобы убедиться что priceHistory сохранен
      await item.reload();

      res.json(item);
    } catch (error) {
      console.error('Error updating comparison item:', error);
      res.status(500).json({ error: 'Ошибка при обновлении услуги' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// DELETE /api/price-comparisons/:id/items/:itemId - Удалить услугу
// ═══════════════════════════════════════════════════════════════
router.delete('/:id/items/:itemId', authenticate, async (req, res) => {
  try {
    const { id, itemId } = req.params;

    // Проверяем, что сравнение принадлежит пользователю
    const comparison = await PriceComparison.findOne({
      where: {
        id,
        createdBy: req.user.id
      }
    });

    if (!comparison) {
      return res.status(404).json({ error: 'Сравнение не найдено' });
    }

    const item = await PriceComparisonItem.findOne({
      where: {
        id: itemId,
        comparisonId: id
      }
    });

    if (!item) {
      return res.status(404).json({ error: 'Услуга не найдена' });
    }

    await item.destroy();

    res.json({ message: 'Услуга удалена' });
  } catch (error) {
    console.error('Error deleting comparison item:', error);
    res.status(500).json({ error: 'Ошибка при удалении услуги' });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/price-comparisons/:id/items/reorder - Изменить порядок услуг
// ═══════════════════════════════════════════════════════════════
router.put('/:id/items/reorder',
  authenticate,
  [
    body('itemsOrder').isArray().withMessage('itemsOrder должен быть массивом')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { itemsOrder } = req.body; // [{ id: 'uuid', sortOrder: 0 }, ...]

      // Проверяем, что сравнение принадлежит пользователю
      const comparison = await PriceComparison.findOne({
        where: {
          id,
          createdBy: req.user.id
        }
      });

      if (!comparison) {
        return res.status(404).json({ error: 'Сравнение не найдено' });
      }

      // Обновляем sortOrder для каждого item
      for (const { id: itemId, sortOrder } of itemsOrder) {
        await PriceComparisonItem.update(
          { sortOrder },
          {
            where: {
              id: itemId,
              comparisonId: id
            }
          }
        );
      }

      res.json({ message: 'Порядок обновлен' });
    } catch (error) {
      console.error('Error reordering comparison items:', error);
      res.status(500).json({ error: 'Ошибка при изменении порядка' });
    }
  }
);

module.exports = router;
