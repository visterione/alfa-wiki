const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const axios = require('axios');
const qs = require('qs');
const { DoctorCard, SearchIndex, User } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// MIS API конфигурация
const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 15000;

// Middleware для проверки прав на редактирование карточек врачей
const canEditDoctorCards = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Администраторы имеют полный доступ
    if (user.isAdmin) {
      return next();
    }

    // Проверяем специальное разрешение
    if (user.canEditDoctorCards) {
      return next();
    }

    return res.status(403).json({
      error: 'Доступ запрещён',
      message: 'У вас нет прав на редактирование карточек врачей'
    });
  } catch (err) {
    console.error('canEditDoctorCards middleware error:', err);
    return res.status(500).json({ error: 'Ошибка проверки прав доступа' });
  }
};

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

// === HELPER: Получить услуги врача из MIS ===
const fetchDoctorServices = async (misUserId) => {
  if (!misUserId) return { serviceIds: [], serviceTitles: [] };

  try {
    // 1. Получаем данные врача с ID услуг
    const doctorData = await misRequest('getUsers', {
      user_id: misUserId,
      role: 'doctor',
      with_services: 1
    });

    if (doctorData?.error !== 0 || !doctorData?.data?.[0]?.services) {
      return { serviceIds: [], serviceTitles: [] };
    }

    const serviceIds = doctorData.data[0].services;
    if (!serviceIds.length) {
      return { serviceIds: [], serviceTitles: [] };
    }

    // 2. Получаем названия услуг
    const servicesData = await misRequest('getServices', {
      service_id: serviceIds.join(',')
    });

    if (servicesData?.error !== 0 || !servicesData?.data) {
      return { serviceIds, serviceTitles: [] };
    }

    const services = Array.isArray(servicesData.data) ? servicesData.data : [servicesData.data];
    const serviceTitles = services
      .map(s => s.title)
      .filter(Boolean);

    console.log(`📋 Врач ${misUserId}: ${serviceTitles.length} услуг`);

    return { serviceIds, serviceTitles };
  } catch (err) {
    console.error('Fetch doctor services error:', err.message);
    return { serviceIds: [], serviceTitles: [] };
  }
};

// === HELPER: Индексация карточки врача для поиска ===
const indexDoctorCard = async (card, fetchServices = true) => {
  const meta = card.metadata || {};
  let serviceTitles = meta.serviceTitles || [];

  // Подгружаем услуги из MIS если нужно
  if (fetchServices && meta.misUserId) {
    const servicesResult = await fetchDoctorServices(meta.misUserId);
    serviceTitles = servicesResult.serviceTitles;
    
    // Сохраняем в metadata для кэширования
    if (serviceTitles.length > 0) {
      const newMetadata = { ...meta, serviceTitles };
      await card.update({ metadata: newMetadata });
    }
  }

  const tagsText = (meta.tags || []).join(' ');
  const servicesText = serviceTitles.join(' | ');

  const searchContent = [
    card.fullName,
    card.specialty,
    card.experience,
    card.description,
    tagsText,
    servicesText,
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
    'специалист',
    ...(meta.tags || []).map(t => t.toLowerCase()),
    // Добавляем ключевые слова из услуг (первые 2 слова каждой услуги)
    ...serviceTitles.flatMap(s => s.toLowerCase().split(' ').slice(0, 2))
  ].filter(Boolean);

  // Убираем дубликаты из keywords
  const uniqueKeywords = [...new Set(keywords)];

  await SearchIndex.upsert({
    entityType: 'doctor',
    entityId: card.id,
    title: title,
    content: searchContent,
    keywords: uniqueKeywords.slice(0, 50), // Лимит на 50 ключевых слов
    url: `/page/${card.pageSlug}?highlight=${card.id}`,
    metadata: {
      pageSlug: card.pageSlug,
      specialty: card.specialty,
      fullName: card.fullName,
      photo: card.photo,
      profileUrl: card.profileUrl,
      misUserId: meta.misUserId,
      tags: meta.tags,
      servicesCount: serviceTitles.length
    }
  });
};

// === HELPER: Удаление из индекса ===
const removeFromIndex = async (cardId) => {
  await SearchIndex.destroy({
    where: { entityType: 'doctor', entityId: cardId }
  });
};

// === HELPER: Полная переиндексация с услугами ===
const reindexAllCards = async (pageSlug = null, withServices = true) => {
  const where = pageSlug ? { pageSlug } : {};
  
  // Очищаем старые индексы
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
  let indexed = 0;
  let withServicesCount = 0;

  for (const card of allCards) {
    try {
      await indexDoctorCard(card, withServices);
      indexed++;
      
      const meta = card.metadata || {};
      if (meta.serviceTitles?.length > 0) {
        withServicesCount++;
      }
    } catch (err) {
      console.error(`Failed to index card ${card.id}:`, err.message);
    }
  }

  console.log(`✅ Переиндексация завершена: ${indexed} карточек, ${withServicesCount} с услугами`);
  return { indexed, withServicesCount };
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

// Переиндексация (с опцией обновления услуг)
router.post('/reindex', authenticate, async (req, res) => {
  try {
    const { pageSlug, withServices = true } = req.body;
    const result = await reindexAllCards(pageSlug, withServices);
    res.json({ 
      message: 'Reindex completed', 
      indexed: result.indexed,
      withServices: result.withServicesCount
    });
  } catch (error) {
    console.error('Reindex error:', error);
    res.status(500).json({ error: 'Failed to reindex' });
  }
});

// Создать карточку
router.post('/', authenticate, canEditDoctorCards, [
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
      misUserId, professions, professionTitles, clinics, ageRange,
      internalNumber, mobileNumber, notes,
      tags
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
        mobileNumber,
        tags
      }
    });

    // Индексируем с подгрузкой услуг
    await indexDoctorCard(card, true);

    res.status(201).json(card);
  } catch (error) {
    console.error('Create doctor card error:', error);
    res.status(500).json({ error: 'Failed to create doctor card' });
  }
});

// Обновить карточку
router.put('/:id', authenticate, canEditDoctorCards, async (req, res) => {
  try {
    const card = await DoctorCard.findByPk(req.params.id);
    if (!card) {
      return res.status(404).json({ error: 'Doctor card not found' });
    }

    const { 
      fullName, specialty, experience, profileUrl, photo, 
      description, phones, sortOrder, metadata,
      misUserId, professions, professionTitles, clinics, ageRange,
      internalNumber, mobileNumber, notes,
      tags
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
    const oldMeta = card.metadata || {};
    const newMetadata = { ...oldMeta };
    if (misUserId !== undefined) newMetadata.misUserId = misUserId;
    if (professions !== undefined) newMetadata.professions = professions;
    if (professionTitles !== undefined) newMetadata.professionTitles = professionTitles;
    if (clinics !== undefined) newMetadata.clinics = clinics;
    if (ageRange !== undefined) newMetadata.ageRange = ageRange;
    if (internalNumber !== undefined) newMetadata.internalNumber = internalNumber;
    if (mobileNumber !== undefined) newMetadata.mobileNumber = mobileNumber;
    if (tags !== undefined) newMetadata.tags = tags;

    // Merge metadata, preserving serviceOverrides
    if (metadata) {
      Object.assign(newMetadata, metadata);
      // Preserve serviceOverrides from request if provided
      if (metadata.serviceOverrides !== undefined) {
        newMetadata.serviceOverrides = metadata.serviceOverrides;
      }
    }
    updateData.metadata = newMetadata;

    await card.update(updateData);
    
    // Переиндексируем (обновляем услуги если изменился misUserId)
    const shouldFetchServices = misUserId !== undefined && misUserId !== oldMeta.misUserId;
    await indexDoctorCard(card, shouldFetchServices);

    res.json(card);
  } catch (error) {
    console.error('Update doctor card error:', error);
    res.status(500).json({ error: 'Failed to update doctor card' });
  }
});

// Обновить порядок сортировки (массово)
router.put('/page/:pageSlug/reorder', authenticate, canEditDoctorCards, async (req, res) => {
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
router.delete('/:id', authenticate, canEditDoctorCards, async (req, res) => {
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

// Принудительное обновление услуг для одной карточки
router.post('/:id/refresh-services', authenticate, canEditDoctorCards, async (req, res) => {
  try {
    const card = await DoctorCard.findByPk(req.params.id);
    if (!card) {
      return res.status(404).json({ error: 'Doctor card not found' });
    }

    const meta = card.metadata || {};
    if (!meta.misUserId) {
      return res.status(400).json({ error: 'Карточка не привязана к МИС' });
    }

    // Принудительно обновляем услуги
    await indexDoctorCard(card, true);

    // Получаем обновлённую карточку
    const updatedCard = await DoctorCard.findByPk(req.params.id);

    res.json({ 
      message: 'Услуги обновлены',
      servicesCount: updatedCard.metadata?.serviceTitles?.length || 0
    });
  } catch (error) {
    console.error('Refresh services error:', error);
    res.status(500).json({ error: 'Failed to refresh services' });
  }
});

// Экспортируем функцию переиндексации для использования в cron
module.exports = router;
module.exports.reindexAllCards = reindexAllCards;