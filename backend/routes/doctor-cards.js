const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { DoctorCard, SearchIndex } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// === HELPER: Индексация карточки врача для поиска ===
const indexDoctorCard = async (card) => {
  const searchContent = [
    card.fullName,
    card.specialty,
    card.experience,
    card.description,
    card.phones?.map(p => p.number).join(' ')
  ].filter(Boolean).join(' | ');

  const title = card.specialty 
    ? `${card.fullName} — ${card.specialty}`
    : card.fullName;

  const keywords = [
    card.specialty?.toLowerCase(),
    card.pageSlug?.toLowerCase(),
    'врач',
    'доктор',
    'специалист'
  ].filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'doctor',
    entityId: card.id,
    title: title,
    content: searchContent,
    keywords: keywords,
    url: `/page/${card.pageSlug}?highlight=${card.id}`,
    metadata: {
      pageSlug: card.pageSlug,
      specialty: card.specialty,
      fullName: card.fullName,
      photo: card.photo,
      profileUrl: card.profileUrl,
      misUserId: card.misUserId
    }
  });
};

// === HELPER: Удаление из индекса ===
const removeFromIndex = async (cardId) => {
  await SearchIndex.destroy({
    where: { entityType: 'doctor', entityId: cardId }
  });
};

// === HELPER: Полная переиндексация ===
const reindexAllCards = async (pageSlug = null) => {
  const where = pageSlug ? { pageSlug } : {};
  
  if (pageSlug) {
    const cards = await DoctorCard.findAll({ where, attributes: ['id'] });
    const ids = cards.map(c => c.id);
    if (ids.length) {
      await SearchIndex.destroy({
        where: { entityType: 'doctor', entityId: { [Op.in]: ids } }
      });
    }
  } else {
    await SearchIndex.destroy({ where: { entityType: 'doctor' } });
  }

  const allCards = await DoctorCard.findAll({ where });
  for (const card of allCards) {
    await indexDoctorCard(card);
  }

  return allCards.length;
};

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// Получить карточки для конкретной страницы
router.get('/page/:pageSlug', authenticate, async (req, res) => {
  try {
    const { pageSlug } = req.params;
    const { search, sortBy = 'sortOrder', sortOrder = 'ASC' } = req.query;

    const where = { pageSlug };
    
    if (search) {
      where[Op.or] = [
        { fullName: { [Op.iLike]: `%${search}%` } },
        { specialty: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const cards = await DoctorCard.findAll({
      where,
      order: [[sortBy, sortOrder.toUpperCase()]]
    });

    res.json(cards);
  } catch (error) {
    console.error('Get doctor cards error:', error);
    res.status(500).json({ error: 'Failed to fetch doctor cards' });
  }
});

// Получить список уникальных специальностей для страницы
router.get('/page/:pageSlug/specialties', authenticate, async (req, res) => {
  try {
    const { pageSlug } = req.params;
    const result = await DoctorCard.findAll({
      where: { pageSlug, specialty: { [Op.ne]: null } },
      attributes: ['specialty'],
      group: ['specialty'],
      order: [['specialty', 'ASC']]
    });
    res.json(result.map(r => r.specialty).filter(Boolean));
  } catch (error) {
    console.error('Get specialties error:', error);
    res.status(500).json({ error: 'Failed to fetch specialties' });
  }
});

// Статистика по странице
router.get('/page/:pageSlug/stats', authenticate, async (req, res) => {
  try {
    const { pageSlug } = req.params;
    const total = await DoctorCard.count({ where: { pageSlug } });
    res.json({ total });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Переиндексация
router.post('/reindex', authenticate, async (req, res) => {
  try {
    const { pageSlug } = req.body;
    const count = await reindexAllCards(pageSlug);
    res.json({ message: 'Reindex completed', indexed: count });
  } catch (error) {
    console.error('Reindex error:', error);
    res.status(500).json({ error: 'Failed to reindex' });
  }
});

// Создать карточку
router.post('/', authenticate, [
  body('pageSlug').trim().notEmpty().withMessage('pageSlug обязателен'),
  body('fullName').trim().notEmpty().withMessage('ФИО обязательно')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      pageSlug, fullName, specialty, experience, profileUrl, photo, 
      description, phones, sortOrder, metadata,
      // Поля из МИС
      misUserId, professions, professionTitles, clinics, ageRange,
      internalNumber, mobileNumber, notes
    } = req.body;

    const maxOrder = await DoctorCard.max('sortOrder', { where: { pageSlug } }) || 0;

    const card = await DoctorCard.create({
      pageSlug,
      fullName,
      specialty: specialty || (professionTitles && professionTitles[0]) || '',
      experience,
      profileUrl,
      photo,
      description: description || notes || '',
      phones: phones || [],
      sortOrder: sortOrder ?? maxOrder + 1,
      metadata: {
        ...(metadata || {}),
        misUserId,
        professions,
        professionTitles,
        clinics,
        ageRange,
        internalNumber,
        mobileNumber
      }
    });

    await indexDoctorCard(card);

    res.status(201).json(card);
  } catch (error) {
    console.error('Create doctor card error:', error);
    res.status(500).json({ error: 'Failed to create doctor card' });
  }
});

// Обновить карточку
router.put('/:id', authenticate, async (req, res) => {
  try {
    const card = await DoctorCard.findByPk(req.params.id);
    if (!card) {
      return res.status(404).json({ error: 'Doctor card not found' });
    }

    const { 
      fullName, specialty, experience, profileUrl, photo, 
      description, phones, sortOrder, metadata,
      misUserId, professions, professionTitles, clinics, ageRange,
      internalNumber, mobileNumber, notes
    } = req.body;

    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (specialty !== undefined) updateData.specialty = specialty;
    if (experience !== undefined) updateData.experience = experience;
    if (profileUrl !== undefined) updateData.profileUrl = profileUrl;
    if (photo !== undefined) updateData.photo = photo;
    if (description !== undefined) updateData.description = description;
    if (notes !== undefined) updateData.description = notes;
    if (phones !== undefined) updateData.phones = phones;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    
    // Обновляем metadata
    const newMetadata = { ...(card.metadata || {}) };
    if (misUserId !== undefined) newMetadata.misUserId = misUserId;
    if (professions !== undefined) newMetadata.professions = professions;
    if (professionTitles !== undefined) newMetadata.professionTitles = professionTitles;
    if (clinics !== undefined) newMetadata.clinics = clinics;
    if (ageRange !== undefined) newMetadata.ageRange = ageRange;
    if (internalNumber !== undefined) newMetadata.internalNumber = internalNumber;
    if (mobileNumber !== undefined) newMetadata.mobileNumber = mobileNumber;
    if (metadata) Object.assign(newMetadata, metadata);
    updateData.metadata = newMetadata;

    await card.update(updateData);
    await indexDoctorCard(card);

    res.json(card);
  } catch (error) {
    console.error('Update doctor card error:', error);
    res.status(500).json({ error: 'Failed to update doctor card' });
  }
});

// Обновить порядок сортировки (массово)
router.put('/page/:pageSlug/reorder', authenticate, async (req, res) => {
  try {
    const { pageSlug } = req.params;
    const { order } = req.body;

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array' });
    }

    for (const item of order) {
      await DoctorCard.update(
        { sortOrder: item.sortOrder },
        { where: { id: item.id, pageSlug } }
      );
    }

    res.json({ message: 'Order updated' });
  } catch (error) {
    console.error('Reorder error:', error);
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

// Удалить карточку
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const card = await DoctorCard.findByPk(req.params.id);
    if (!card) {
      return res.status(404).json({ error: 'Doctor card not found' });
    }

    const cardId = card.id;
    await card.destroy();
    await removeFromIndex(cardId);

    res.json({ message: 'Doctor card deleted' });
  } catch (error) {
    console.error('Delete doctor card error:', error);
    res.status(500).json({ error: 'Failed to delete doctor card' });
  }
});

// Получить одну карточку по ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const card = await DoctorCard.findByPk(req.params.id);
    if (!card) {
      return res.status(404).json({ error: 'Doctor card not found' });
    }
    res.json(card);
  } catch (error) {
    console.error('Get doctor card error:', error);
    res.status(500).json({ error: 'Failed to fetch doctor card' });
  }
});

module.exports = router;