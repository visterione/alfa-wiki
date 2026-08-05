const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { diffLines } = require('diff');
const axios = require('axios');
const qs = require('qs');
const { DoctorCard, SearchIndex, User, Role, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const normalizeFullName = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е');

const hasDoctorRole = (user) => {
  const roleNames = [user.role, ...(user.roles || [])]
    .filter(Boolean)
    .map(role => normalizeFullName(role.name));
  return roleNames.includes(normalizeFullName('Врач'));
};

const cardMisUserId = (card) => String(card?.metadata?.misUserId || '');

async function resolvePersonalDoctorCard(user) {
  const cards = await DoctorCard.findAll({ order: [['sortOrder', 'ASC']] });

  if (user.misUserId) {
    const byMisId = cards.find(card => cardMisUserId(card) === String(user.misUserId));
    if (byMisId) return { card: byMisId, matchSource: 'misUserId' };
  }

  const normalizedName = normalizeFullName(user.displayName);
  if (!normalizedName) return { card: null, matchSource: null };
  const matches = cards.filter(card => normalizeFullName(card.fullName) === normalizedName);
  if (matches.length !== 1) return { card: null, matchSource: null };

  const card = matches[0];
  const misUserId = cardMisUserId(card);
  if (misUserId && !user.misUserId) {
    try {
      await user.update({ misUserId });
    } catch (error) {
      // Возможный конфликт уникальности не должен мешать безопасному просмотру
      // однозначно найденной по ФИО карточки.
      console.warn('Doctor profile auto-link failed:', error.message);
    }
  }
  return { card, matchSource: 'fullName' };
}

// MIS API конфигурация
const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 15000;

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

// === HELPER: Извлечь текст из HTML для сравнения в истории (+ декодируем сущности) ===
function stripHtml(html) {
  if (!html) return '';
  return (html + '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// === HELPER: Канонически сравнить два массива (без учёта порядка; null/undefined = []) ===
function arraysEqual(a, b) {
  const na = (a == null) ? [] : a;
  const nb = (b == null) ? [] : b;
  if (!Array.isArray(na) && !Array.isArray(nb)) return JSON.stringify(na) === JSON.stringify(nb);
  if (!Array.isArray(na) || !Array.isArray(nb)) return false;
  if (na.length !== nb.length) return false;
  const sa = [...na].map(x => JSON.stringify(x)).sort();
  const sb = [...nb].map(x => JSON.stringify(x)).sort();
  return sa.join('|') === sb.join('|');
}

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

// Список карточек для диагностического выбора в профиле администратора.
router.get('/profile/options', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user?.isAdmin) return res.status(403).json({ error: 'Доступ запрещён' });

    const cards = await DoctorCard.findAll({
      attributes: ['id', 'fullName', 'specialty', 'metadata', 'sortOrder'],
      order: [['fullName', 'ASC']]
    });
    res.json(cards.map(card => ({
      id: card.id,
      fullName: card.fullName,
      specialty: card.specialty,
      misUserId: cardMisUserId(card) || null
    })));
  } catch (error) {
    console.error('Get doctor profile options error:', error);
    res.status(500).json({ error: 'Failed to fetch doctor cards' });
  }
});

// Персональная карточка. Врач получает только свою, администратор может выбрать
// любую карточку через cardId для проверки внешнего вида и интеграций.
router.get('/profile/me', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } }
      ]
    });
    if (!user || (!user.isAdmin && !hasDoctorRole(user))) {
      return res.status(403).json({ error: 'Доступ разрешён только врачам и администраторам' });
    }

    if (user.isAdmin && req.query.cardId) {
      const card = await DoctorCard.findByPk(req.query.cardId);
      if (!card) return res.status(404).json({ error: 'Карточка врача не найдена' });
      return res.json({ card, matchSource: 'adminSelection' });
    }

    const result = await resolvePersonalDoctorCard(user);
    if (!result.card) {
      return res.status(404).json({
        error: 'Карточка врача пока не найдена',
        code: 'DOCTOR_CARD_NOT_LINKED'
      });
    }
    res.json(result);
  } catch (error) {
    console.error('Get personal doctor card error:', error);
    res.status(500).json({ error: 'Failed to fetch doctor card' });
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

    await recordHistory(
      pageSlug,
      req.user.id,
      `Добавлена карточка врача: ${card.fullName}`,
      [{ field: 'doctorCard', label: 'Добавлена карточка', to: card.fullName }]
    );

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

    // Сохраняем старые значения для истории
    const oldValues = {
      fullName: card.fullName,
      specialty: card.specialty,
      experience: card.experience,
      description: card.description,
      profileUrl: card.profileUrl,
      photo: card.photo,
      phones: JSON.stringify(card.phones || []),
    };
    const oldMeta = card.metadata || {};

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

    // История изменений
    const detailedChanges = [];
    // Простые текстовые поля
    const scalarFields = [
      { key: 'fullName', label: 'ФИО' },
      { key: 'specialty', label: 'Специальность' },
      { key: 'experience', label: 'Опыт' },
      { key: 'profileUrl', label: 'Ссылка на профиль' },
    ];
    for (const { key, label } of scalarFields) {
      if (key in updateData && String(updateData[key] ?? '') !== String(oldValues[key] ?? '')) {
        detailedChanges.push({ field: key, label, from: String(oldValues[key] ?? ''), to: String(updateData[key] ?? '') });
      }
    }
    // Описание — хранится как HTML, показываем построчный diff
    if ('description' in updateData) {
      const oldDesc = stripHtml(oldValues.description);
      const newDesc = stripHtml(updateData.description);
      if (oldDesc !== newDesc) {
        const chunks = diffLines(oldDesc, newDesc);
        const addedLines = [], removedLines = [];
        for (const chunk of chunks) {
          const lines = chunk.value.split('\n').map(l => l.trim()).filter(Boolean);
          if (chunk.added)   addedLines.push(...lines);
          if (chunk.removed) removedLines.push(...lines);
        }
        detailedChanges.push({ field: 'description', label: 'Описание',
          addedLines: addedLines.slice(0, 10), removedLines: removedLines.slice(0, 10) });
      }
    }
    if ('photo' in updateData && updateData.photo !== oldValues.photo) {
      detailedChanges.push({ field: 'photo', label: 'Фото' });
    }
    if ('phones' in updateData && JSON.stringify(updateData.phones) !== oldValues.phones) {
      detailedChanges.push({ field: 'phones', label: 'Телефоны' });
    }
    if (misUserId !== undefined && String(misUserId ?? '') !== String(oldMeta.misUserId ?? '')) {
      detailedChanges.push({ field: 'misUserId', label: 'ID в МИС', from: String(oldMeta.misUserId ?? ''), to: String(misUserId ?? '') });
    }
    if (tags !== undefined && !arraysEqual(tags, oldMeta.tags)) {
      detailedChanges.push({ field: 'tags', label: 'Теги' });
    }
    if (clinics !== undefined && !arraysEqual(clinics, oldMeta.clinics)) {
      const getName = (c) => (typeof c === 'string' ? c : (c?.name || c?.title || c?.clinicName || ''));
      const oldNames = (oldMeta.clinics || []).map(getName).filter(Boolean);
      const newNames = (clinics || []).map(getName).filter(Boolean);
      const added   = newNames.filter(n => !oldNames.includes(n));
      const removed = oldNames.filter(n => !newNames.includes(n));
      if (added.length)   detailedChanges.push({ field: 'clinics', label: 'Клиники добавлены', to: added.join(', ') });
      if (removed.length) detailedChanges.push({ field: 'clinics', label: 'Клиники удалены', from: removed.join(', ') });
      if (!added.length && !removed.length) detailedChanges.push({ field: 'clinics', label: 'Клиники изменены' });
    }
    if (detailedChanges.length > 0) {
      const summary = detailedChanges
        .map(c => {
          if (c.field === 'description') {
            // Показываем первую изменённую строку как краткий контекст
            const snip = (c.removedLines?.[0] || c.addedLines?.[0] || '').slice(0, 60);
            return snip ? `Описание: «${snip}»` : 'Описание';
          }
          if (c.from !== undefined && c.to !== undefined)
            return `${c.label}: «${String(c.from).slice(0, 40)}» → «${String(c.to).slice(0, 40)}»`;
          if (c.to !== undefined) return `${c.label}: «${String(c.to).slice(0, 50)}»`;
          if (c.from !== undefined) return `${c.label}: «${String(c.from).slice(0, 50)}»`;
          return c.label;
        })
        .join('; ');
      const contextChanges = [
        { field: 'serviceContext', label: 'Врач', to: oldValues.fullName || card.fullName },
        ...detailedChanges
      ];
      await recordHistory(card.pageSlug, req.user.id, summary, contextChanges);
    }

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

    const { pageSlug, fullName } = card;
    const cardId = card.id;
    await card.destroy();
    await removeFromIndex(cardId);

    await recordHistory(
      pageSlug,
      req.user.id,
      `Удалена карточка врача: ${fullName}`,
      [{ field: 'doctorCard', label: 'Удалена карточка', from: fullName }]
    );

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
