const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { PriceComparison, PriceComparisonItem, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');
const { pruneBindings } = require('../services/comparisonBindings');

const router = express.Router();

const PRICE_COMPARE_PAGE_SLUG = 'price-compare';

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

// ═══════════════════════════════════════════════════════════════
// GET /api/price-comparisons - Получить все сравнения
// ═══════════════════════════════════════════════════════════════
router.get('/', authenticate, async (req, res) => {
  try {
    const where = {};
    if (req.query.type) where.comparisonType = req.query.type;

    const comparisons = await PriceComparison.findAll({
      where,
      order: [['createdAt', 'DESC']],
      attributes: [
        'id', 'name', 'description', 'competitors', 'competitorBindings',
        'ownMedCenters', 'columnOrder', 'comparisonType', 'createdAt', 'updatedAt'
      ]
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
      where: { id },
      include: [
        {
          model: PriceComparisonItem,
          as: 'items',
          attributes: [
            'id', 'serviceCode', 'serviceName', 'misServiceId', 'prices',
            'priceHistory', 'priceSources', 'costPrices', 'lab', 'sortOrder'
          ],
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
        competitors = [],
        competitorBindings = {},
        columnOrder = [],
        comparisonType = 'external'
      } = req.body;

      const comparison = await PriceComparison.create({
        name,
        description,
        ownMedCenters,
        competitors,
        competitorBindings: pruneBindings(competitorBindings, competitors),
        columnOrder,
        comparisonType,
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
        competitors,
        competitorBindings,
        columnOrder
      } = req.body;

      const comparison = await PriceComparison.findOne({
        where: { id }
      });

      if (!comparison) {
        return res.status(404).json({ error: 'Сравнение не найдено' });
      }

      const oldName = comparison.name;
      // Привязки колонок к клиникам парсера присылаются не всегда: страница
      // сохраняет сравнение и при переименовании листа. Что не прислали —
      // оставляем как было, а привязки удалённых колонок убираем сами:
      // отдельной кнопки «отвязать клинику» у человека нет и не нужно.
      //
      // Порядок колонок — того же рода: его меняют перетаскиванием заголовка,
      // и остальные сохранения листа не должны его сбрасывать.
      await comparison.update({
        name,
        description,
        ownMedCenters,
        competitors,
        competitorBindings: pruneBindings(
          competitorBindings || comparison.competitorBindings,
          competitors
        ),
        columnOrder: Array.isArray(columnOrder) ? columnOrder : comparison.columnOrder
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
// PUT /api/price-comparisons/:id/columns/rename - Переименовать колонку
//
// Подпись колонки — это ключ, под которым лежат её цена, себестоимость,
// история и происхождение в каждой услуге листа, и он же ключ привязки
// к клинике парсера. Поэтому переименование делает сервер и сразу во всех
// местах: переименуй половину — и цены колонки останутся под старым именем,
// то есть просто исчезнут с листа.
//
// Клиника за колонкой при этом не меняется: связь идёт по id, а подпись —
// только то, что видит человек.
// ═══════════════════════════════════════════════════════════════
router.put('/:id/columns/rename',
  authenticate,
  [
    body('from').isString().trim().notEmpty().withMessage('Не указана колонка'),
    body('to').isString().trim().notEmpty().withMessage('Новое название обязательно')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const from = String(req.body.from).trim();
      const to = String(req.body.to).trim();

      const comparison = await PriceComparison.findOne({ where: { id } });
      if (!comparison) {
        return res.status(404).json({ error: 'Сравнение не найдено' });
      }

      const competitors = comparison.competitors || [];
      if (!competitors.includes(from)) {
        // Колонки своих медцентров названы так же, как клиники в МИС, и по
        // этому имени к ним приезжают цены — переименовывать их нельзя
        return res.status(400).json({ error: 'Такой колонки конкурента нет на листе' });
      }
      if (from === to) return res.json({ message: 'Название не изменилось' });

      const items = await PriceComparisonItem.findAll({ where: { comparisonId: id } });
      const columnFields = ['prices', 'costPrices', 'priceSources', 'priceHistory'];
      const nameTaken = competitors.includes(to) || items.some(item =>
        columnFields.some(field =>
          item[field] && Object.prototype.hasOwnProperty.call(item[field], to)
        )
      );
      if (nameTaken) {
        return res.status(400).json({ error: 'Колонка с таким названием уже есть' });
      }

      const bindings = { ...(comparison.competitorBindings || {}) };
      if (bindings[from]) {
        bindings[to] = bindings[from];
        delete bindings[from];
      }

      await comparison.update({
        competitors: competitors.map(column => (column === from ? to : column)),
        competitorBindings: bindings,
        // Порядок колонок тоже держится на именах: не переименуешь здесь —
        // колонка уедет в конец таблицы как незнакомая
        columnOrder: (comparison.columnOrder || []).map(column => (column === from ? to : column))
      });

      for (const item of items) {
        let touched = false;
        for (const field of columnFields) {
          const map = item[field];
          if (!map || !Object.prototype.hasOwnProperty.call(map, from)) continue;
          // Пересобираем объект целиком, чтобы колонка осталась на своём
          // месте в порядке ключей, а не уехала в конец
          const next = {};
          for (const [column, value] of Object.entries(map)) {
            next[column === from ? to : column] = value;
          }
          item[field] = next;
          // JSONB Sequelize сам изменённым не считает — помечаем явно
          item.changed(field, true);
          touched = true;
        }
        if (touched) await item.save();
      }

      await recordHistory(
        PRICE_COMPARE_PAGE_SLUG,
        req.user.id,
        `Сравнение цен «${comparison.name}»: колонка «${from}» переименована в «${to}»`,
        [{ field: 'column', label: 'Колонка', from, to }]
      );

      res.json({ message: 'Колонка переименована', from, to });
    } catch (error) {
      console.error('Error renaming comparison column:', error);
      res.status(500).json({ error: 'Ошибка при переименовании колонки' });
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
      where: { id }
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
    body('serviceCode').isString().withMessage('Код услуги должен быть строкой'),
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
        serviceCode = '',
        serviceName,
        misServiceId = null,
        prices = {},
        costPrices = {},
        lab = ''
      } = req.body;

      const comparison = await PriceComparison.findOne({
        where: { id }
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
        costPrices,
        lab,
        sortOrder: maxSortOrder + 1
      });

      await recordHistory(
        PRICE_COMPARE_PAGE_SLUG,
        req.user.id,
        `Добавлена услуга «${serviceName}» в «${comparison.name}»`,
        [{ field: 'serviceContext', label: 'Сравнение', to: comparison.name },
         { field: 'service', label: 'Добавлена услуга', to: serviceName }]
      );

      res.status(201).json(item);
    } catch (error) {
      console.error('Error adding item to comparison:', error);
      res.status(500).json({ error: 'Ошибка при добавлении услуги' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// PUT /api/price-comparisons/:id/items/cost-prices - Пакетно сохранить себестоимости
// ═══════════════════════════════════════════════════════════════
router.put('/:id/items/cost-prices',
  authenticate,
  [
    body('updates').isArray().withMessage('updates должен быть массивом'),
    body('updates.*.id').isUUID().withMessage('Некорректный ID услуги'),
    body('updates.*.costPrices').isObject().withMessage('costPrices должен быть объектом')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { updates } = req.body;

      const comparison = await PriceComparison.findOne({ where: { id } });
      if (!comparison) {
        return res.status(404).json({ error: 'Сравнение не найдено' });
      }

      await Promise.all(updates.map(update =>
        PriceComparisonItem.update(
          { costPrices: update.costPrices },
          { where: { id: update.id, comparisonId: id } }
        )
      ));

      await recordHistory(
        PRICE_COMPARE_PAGE_SLUG,
        req.user.id,
        `Обновлены себестоимости в «${comparison.name}»`,
        [{ field: 'costPrices', label: 'Обновлено услуг', to: String(updates.length) }]
      );

      res.json({ updated: updates.length });
    } catch (error) {
      console.error('Error bulk updating comparison cost prices:', error);
      res.status(500).json({ error: 'Ошибка при сохранении себестоимостей' });
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
      const { prices, serviceCode, serviceName, costPrices, lab } = req.body;

      const comparison = await PriceComparison.findOne({
        where: { id }
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
      const priceSources = { ...(item.priceSources || {}) };
      let priceSourceChanged = false;

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

        // Ручная правка превращает значение в ручное. Иначе ночной парсер
        // считал бы его своим и молча вернул прежнюю автоматическую цену.
        if (oldPrice !== newPrice && priceSources[columnName]) {
          delete priceSources[columnName];
          priceSourceChanged = true;
        }
      });

      const updateData = { prices, priceHistory, priceSources };

      // Явно помечаем что JSONB поля изменились
      item.changed('prices', true);
      item.changed('priceHistory', true);
      if (priceSourceChanged) item.changed('priceSources', true);
      if (serviceCode !== undefined) updateData.serviceCode = serviceCode;
      if (serviceName) updateData.serviceName = serviceName;
      if (costPrices !== undefined) {
        updateData.costPrices = costPrices;
        item.changed('costPrices', true);
      }
      if (lab !== undefined) updateData.lab = lab;

      await item.update(updateData);

      // Перезагружаем item из БД чтобы убедиться что priceHistory сохранен
      await item.reload();

      // Записываем изменения цен в историю
      const priceChanges = [];
      Object.keys(newPrices).forEach(colName => {
        const oldP = oldPrices[colName];
        const newP = newPrices[colName];
        if (oldP !== newP && newP !== null && newP !== undefined && newP !== '') {
          priceChanges.push({ field: 'price', label: colName,
            from: oldP != null ? String(oldP) : '', to: String(newP) });
        }
      });

      if (priceChanges.length > 0) {
        await recordHistory(
          PRICE_COMPARE_PAGE_SLUG,
          req.user.id,
          `Обновлены цены «${item.serviceName}» в «${comparison.name}»`,
          [{ field: 'serviceContext', label: 'Сравнение', to: comparison.name },
           { field: 'serviceContext', label: 'Услуга', to: item.serviceName },
           ...priceChanges]
        );
      }

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

    const comparison = await PriceComparison.findOne({
      where: { id }
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

    const deletedServiceName = item.serviceName;
    await item.destroy();

    await recordHistory(
      PRICE_COMPARE_PAGE_SLUG,
      req.user.id,
      `Удалена услуга «${deletedServiceName}» из «${comparison.name}»`,
      [{ field: 'serviceContext', label: 'Сравнение', to: comparison.name },
       { field: 'service', label: 'Удалена услуга', from: deletedServiceName }]
    );

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

      const comparison = await PriceComparison.findOne({
        where: { id }
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
