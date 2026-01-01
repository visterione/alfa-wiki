const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { Accreditation, SearchIndex } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКА: Укажи slug wiki-страницы с аккредитациями
// Посмотри URL страницы в браузере: /page/ЭТОТ_SLUG
// ═══════════════════════════════════════════════════════════════
const ACCREDITATIONS_PAGE_SLUG = 'accreditations'; // <-- ЗАМЕНИ НА СВОЙ SLUG
// ═══════════════════════════════════════════════════════════════

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
    const { medCenter, fullName, specialty, search, sortBy = 'expirationDate', sortOrder = 'ASC' } = req.query;
    
    const where = {};
    
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
    
    await accreditation.update({
      ...(medCenter && { medCenter }),
      ...(fullName && { fullName }),
      ...(specialty && { specialty }),
      ...(expirationDate && { expirationDate }),
      ...(comment !== undefined && { comment })
    });

    // Обновляем индекс
    await indexAccreditation(accreditation);

    res.json(accreditation);
  } catch (error) {
    console.error('Update accreditation error:', error);
    res.status(500).json({ error: 'Failed to update accreditation' });
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
    
    await accreditation.destroy();
    
    // Удаляем из индекса
    await removeFromIndex(accId);

    res.json({ message: 'Accreditation deleted' });
  } catch (error) {
    console.error('Delete accreditation error:', error);
    res.status(500).json({ error: 'Failed to delete accreditation' });
  }
});

module.exports = router;