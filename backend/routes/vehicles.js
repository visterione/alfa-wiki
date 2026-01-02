const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { Vehicle, SearchIndex } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

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
    const { organization, condition, search, sortBy = 'insuranceDate', sortOrder = 'ASC' } = req.query;
    
    const where = {};
    
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

// Удалить ТС
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const vehicle = await Vehicle.findByPk(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const vehId = vehicle.id;
    
    await vehicle.destroy();
    
    await removeFromIndex(vehId);

    res.json({ message: 'Vehicle deleted' });
  } catch (error) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

module.exports = router;