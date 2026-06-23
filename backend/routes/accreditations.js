const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const qs = require('qs');
const { Accreditation, AccreditationFile, SearchIndex, Page, PageHistory, Setting } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const VALID_MEDCENTERS = ['Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К', 'Сукко', 'ИП Микаелян'];

// Нормализует медцентры из тела запроса в массив валидных значений.
// Принимает medCenters (массив) или одиночный medCenter (для совместимости).
function normalizeMedCenters(body) {
  var arr = Array.isArray(body.medCenters) ? body.medCenters : (body.medCenter ? [body.medCenter] : []);
  var seen = {};
  return arr.filter(function (m) {
    if (!VALID_MEDCENTERS.includes(m) || seen[m]) return false;
    seen[m] = true;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════
// МИС: реестр сотрудников для автоподстановки (ФИО / специальности / клиники)
// ═══════════════════════════════════════════════════════════════
const MIS_API_KEY  = process.env.MIS_API_KEY  || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';

// clinic_id из МИС → медцентр (как в routes/mis-proxy.js /clinics).
// Клиники без значения в этом маппинге (напр. «Направители») в список не попадают.
const MIS_CLINIC_TO_MEDCENTER = {
  1: 'Проф',
  2: 'Альфа',
  3: 'Кидс',
  4: '3К',
  6: 'Линия',
  7: 'Смайл',
  11: 'Сукко'
  // 'ИП Микаелян' — id уточнить и добавить при необходимости
};

async function misRequest(endpoint, params) {
  const resp = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );
  return resp.data;
}

// Кэш реестра, чтобы не дёргать МИС на каждый запрос
let staffCache = { data: null, ts: 0 };
const STAFF_CACHE_TTL = 5 * 60 * 1000; // 5 минут

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКА: Укажи slug wiki-страницы с аккредитациями
// Посмотри URL страницы в браузере: /page/ЭТОТ_SLUG
// ═══════════════════════════════════════════════════════════════
const ACCREDITATIONS_PAGE_SLUG = 'accreditations'; // <-- ЗАМЕНИ НА СВОЙ SLUG
// ═══════════════════════════════════════════════════════════════

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

// === MULTER CONFIGURATION ===
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.env.UPLOAD_PATH || './uploads', 'accreditations');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'accred-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 // 50MB по умолчанию
  },
  fileFilter: (req, file, cb) => {
    // Разрешенные типы файлов
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый тип файла. Разрешены: изображения, PDF, Word, Excel, текстовые файлы.'));
    }
  }
});

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
      pageSlug: ACCREDITATIONS_PAGE_SLUG, // <-- Добавлена привязка к родительской странице
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

// Реестр сотрудников из МИС для автоподстановки в форме
// Возвращает [{ misUserId, name, specialties: [string], medCenters: [string] }]
router.get('/mis-staff', authenticate, async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    if (!force && staffCache.data && (Date.now() - staffCache.ts) < STAFF_CACHE_TTL) {
      return res.json(staffCache.data);
    }

    // 1. Справочник специальностей: id → название
    const profData = await misRequest('getProfessions', { without_doctors: false });
    const profMap = {};
    if (Number(profData?.error) === 0 && Array.isArray(profData.data)) {
      for (const p of profData.data) profMap[String(p.id)] = p.name;
    }

    // 2. Все сотрудники (без фильтра по роли — нужны и лаборанты, и медсёстры)
    const usersData = await misRequest('getUsers', { show_all: true });
    const users = (Number(usersData?.error) === 0 && Array.isArray(usersData.data)) ? usersData.data : [];

    const roster = [];
    for (const u of users) {
      if (u.is_deleted) continue;

      // Специальности: основная + дополнительная, через справочник
      const profIds = []
        .concat(Array.isArray(u.profession) ? u.profession : [])
        .concat(Array.isArray(u.second_profession) ? u.second_profession : []);
      const specialties = [...new Set(
        profIds.map(id => profMap[String(id)]).filter(Boolean)
      )];
      if (!specialties.length) continue; // только сотрудники с проставленной специальностью

      // Клиники → медцентры (только известные)
      const clinicIds = Array.isArray(u.clinic) ? u.clinic : [];
      const medCenters = [...new Set(
        clinicIds.map(id => MIS_CLINIC_TO_MEDCENTER[Number(id)]).filter(Boolean)
      )];
      if (!medCenters.length) continue;

      roster.push({
        misUserId: u.id,
        name: u.name || '',
        specialties: specialties.sort((a, b) => a.localeCompare(b, 'ru')),
        medCenters
      });
    }

    roster.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    staffCache = { data: roster, ts: Date.now() };
    res.json(roster);
  } catch (error) {
    console.error('Get MIS staff error:', error.message);
    res.status(502).json({ error: 'Не удалось получить реестр сотрудников из МИС' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Скрытые сотрудники реестра (общий список для всех — хранится в settings)
// Например «Администратор» и прочие лишние из МИС, которые не нужны в списке.
// ═══════════════════════════════════════════════════════════════
const HIDDEN_STAFF_KEY = 'accreditation_hidden_staff';

// Получить список misUserId скрытых сотрудников
router.get('/hidden-staff', authenticate, async (req, res) => {
  try {
    const s = await Setting.findByPk(HIDDEN_STAFF_KEY);
    res.json(Array.isArray(s && s.value) ? s.value : []);
  } catch (error) {
    console.error('Get hidden staff error:', error.message);
    res.status(500).json({ error: 'Failed to fetch hidden staff' });
  }
});

// Скрыть / вернуть сотрудника: { name, hidden: true|false }
// Скрываем по ФИО — в МИС один и тот же «Администратор» заведён отдельной учёткой
// в каждой клинике, поэтому скрытие по имени убирает все копии разом.
router.post('/hidden-staff', authenticate, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name обязателен' });

    const s = await Setting.findByPk(HIDDEN_STAFF_KEY);
    let list = Array.isArray(s && s.value) ? s.value.filter(x => typeof x === 'string') : [];
    list = list.filter(x => x !== name);
    if (req.body.hidden) list.push(name);

    await Setting.upsert({
      key: HIDDEN_STAFF_KEY,
      value: list,
      description: 'Скрытые сотрудники в реестре аккредитаций (ФИО)'
    });
    res.json(list);
  } catch (error) {
    console.error('Toggle hidden staff error:', error.message);
    res.status(500).json({ error: 'Failed to update hidden staff' });
  }
});

// Получить все аккредитации с фильтрацией
router.get('/', authenticate, async (req, res) => {
  try {
    const { medCenter, fullName, specialty, search, sortBy = 'expirationDate', sortOrder = 'ASC', archived, misUserId } = req.query;

    const where = {};

    // По умолчанию показываем только неархивные записи
    if (archived === 'true') {
      where.isArchived = true;
    } else if (archived === 'false') {
      where.isArchived = false;
    } else {
      // Если параметр не указан, показываем только активные
      where.isArchived = false;
    }

    if (medCenter) where.medCenter = medCenter;
    if (specialty) where.specialty = specialty;
    if (misUserId) where.misUserId = misUserId;
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

    // Статистика только по активным записям (архив не учитываем)
    const active = { isArchived: false };
    const [total, expired, expiringSoon, expiringIn90] = await Promise.all([
      Accreditation.count({ where: active }),
      Accreditation.count({ where: { ...active, expirationDate: { [Op.lt]: today } } }),
      Accreditation.count({ where: { ...active, expirationDate: { [Op.between]: [today, in30Days] } } }),
      Accreditation.count({ where: { ...active, expirationDate: { [Op.between]: [today, in90Days] } } })
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
  body('fullName').trim().notEmpty(),
  body('specialty').trim().notEmpty(),
  body('expirationDate').isDate()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const medCenters = normalizeMedCenters(req.body);
    if (!medCenters.length) {
      return res.status(400).json({ error: 'Укажите хотя бы один медцентр' });
    }

    const { fullName, specialty, expirationDate, comment, misUserId } = req.body;

    const accreditation = await Accreditation.create({
      medCenter: medCenters[0], medCenters, fullName, specialty, expirationDate, comment,
      misUserId: misUserId || null
    });

    // Индексируем для поиска
    await indexAccreditation(accreditation);

    await recordHistory(
      ACCREDITATIONS_PAGE_SLUG,
      req.user.id,
      `Добавлена аккредитация: ${fullName} — ${specialty}`,
      [{ field: 'accreditation', label: 'Добавлена аккредитация', to: `${fullName} — ${specialty}` }]
    );

    res.status(201).json(accreditation);
  } catch (error) {
    console.error('Create accreditation error:', error);
    res.status(500).json({ error: 'Failed to create accreditation' });
  }
});

// Обновить аккредитацию
router.put('/:id', authenticate, [
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

    const { fullName, specialty, expirationDate, comment } = req.body;

    // Медцентры: если переданы — нормализуем; иначе оставляем как есть
    let newMedCenters;
    if (req.body.medCenters !== undefined || req.body.medCenter !== undefined) {
      const normalized = normalizeMedCenters(req.body);
      if (!normalized.length) {
        return res.status(400).json({ error: 'Укажите хотя бы один медцентр' });
      }
      newMedCenters = normalized;
    }
    const medCenter = newMedCenters ? newMedCenters[0] : undefined;

    // Сохраняем старые значения для истории
    const oldValues = {
      medCenter: (accreditation.medCenters || [accreditation.medCenter]).join(', '),
      fullName: accreditation.fullName,
      specialty: accreditation.specialty,
      expirationDate: accreditation.expirationDate,
      comment: accreditation.comment,
    };

    const { misUserId } = req.body;
    await accreditation.update({
      ...(newMedCenters && { medCenter, medCenters: newMedCenters }),
      ...(fullName && { fullName }),
      ...(specialty && { specialty }),
      ...(expirationDate && { expirationDate }),
      ...(comment !== undefined && { comment }),
      ...(misUserId !== undefined && { misUserId: misUserId || null })
    });

    // Обновляем индекс
    await indexAccreditation(accreditation);

    // История изменений
    const detailedChanges = [];
    const fieldDefs = [
      { key: 'medCenter', label: 'Медцентр' },
      { key: 'fullName', label: 'ФИО' },
      { key: 'specialty', label: 'Специальность' },
      { key: 'expirationDate', label: 'Дата окончания' },
      { key: 'comment', label: 'Комментарий' },
    ];
    const updates = { medCenter: newMedCenters ? newMedCenters.join(', ') : undefined, fullName, specialty, expirationDate, comment };
    for (const { key, label } of fieldDefs) {
      if (updates[key] !== undefined && String(updates[key] ?? '') !== String(oldValues[key] ?? '')) {
        detailedChanges.push({ field: key, label, from: String(oldValues[key] ?? ''), to: String(updates[key] ?? '') });
      }
    }
    if (detailedChanges.length > 0) {
      const summary = detailedChanges
        .map(c => `${c.label}: «${c.from.slice(0, 40)}» → «${c.to.slice(0, 40)}»`)
        .join('; ');
      await recordHistory(ACCREDITATIONS_PAGE_SLUG, req.user.id, summary, detailedChanges);
    }

    res.json(accreditation);
  } catch (error) {
    console.error('Update accreditation error:', error);
    res.status(500).json({ error: 'Failed to update accreditation' });
  }
});

// Переместить в архив / вернуть из архива
router.patch('/:id/archive', authenticate, async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    // Переключаем статус архивирования
    const isArchived = req.body.isArchived !== undefined ? req.body.isArchived : !accreditation.isArchived;
    await accreditation.update({ isArchived });

    // Архивные не показываем в поиске
    if (isArchived) {
      await removeFromIndex(accreditation.id);
    } else {
      await indexAccreditation(accreditation);
    }

    await recordHistory(
      ACCREDITATIONS_PAGE_SLUG,
      req.user.id,
      isArchived
        ? `Аккредитация перемещена в архив: ${accreditation.fullName}`
        : `Аккредитация восстановлена из архива: ${accreditation.fullName}`,
      [{ field: 'isArchived', label: 'Статус', from: isArchived ? 'Активная' : 'Архив', to: isArchived ? 'Архив' : 'Активная' }]
    );

    res.json(accreditation);
  } catch (error) {
    console.error('Archive accreditation error:', error);
    res.status(500).json({ error: 'Failed to archive accreditation' });
  }
});

// Продлить аккредитацию (версионирование): текущую — в архив, создаём новую активную
router.post('/:id/renew', authenticate, [
  body('expirationDate').isDate()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const old = await Accreditation.findByPk(req.params.id);
    if (!old) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }
    if (old.isArchived) {
      return res.status(400).json({ error: 'Нельзя продлить архивную запись' });
    }

    const { expirationDate, comment } = req.body;

    // Создаём новую активную версию с теми же сотрудником/специальностью/медцентром
    const oldMedCenters = (old.medCenters && old.medCenters.length) ? old.medCenters : [old.medCenter];
    const fresh = await Accreditation.create({
      medCenter: oldMedCenters[0],
      medCenters: oldMedCenters,
      fullName: old.fullName,
      specialty: old.specialty,
      misUserId: old.misUserId,
      expirationDate,
      comment: comment !== undefined ? comment : old.comment
    });

    // Старую — в архив и связываем с новой версией
    await old.update({ isArchived: true, supersededById: fresh.id });

    await indexAccreditation(fresh);
    await removeFromIndex(old.id); // архивные в поиске не показываем

    await recordHistory(
      ACCREDITATIONS_PAGE_SLUG,
      req.user.id,
      `Продлена аккредитация: ${fresh.fullName} — ${fresh.specialty} (до ${expirationDate}), предыдущая в архиве`,
      [{ field: 'expirationDate', label: 'Дата окончания', from: String(old.expirationDate), to: String(expirationDate) }]
    );

    res.status(201).json(fresh);
  } catch (error) {
    console.error('Renew accreditation error:', error);
    res.status(500).json({ error: 'Failed to renew accreditation' });
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
    const { fullName, specialty } = accreditation;

    // Удаляем все связанные файлы
    const files = await AccreditationFile.findAll({ where: { accreditationId: accId } });
    for (const file of files) {
      try {
        await fs.unlink(file.path);
      } catch (err) {
        console.error('Error deleting file:', err);
      }
      await file.destroy();
    }

    await accreditation.destroy();

    // Удаляем из индекса
    await removeFromIndex(accId);

    await recordHistory(
      ACCREDITATIONS_PAGE_SLUG,
      req.user.id,
      `Удалена аккредитация: ${fullName} — ${specialty}`,
      [{ field: 'accreditation', label: 'Удалена аккредитация', from: `${fullName} — ${specialty}` }]
    );

    res.json({ message: 'Accreditation deleted' });
  } catch (error) {
    console.error('Delete accreditation error:', error);
    res.status(500).json({ error: 'Failed to delete accreditation' });
  }
});

// ═══════════════════════════════════════════════════════════════
// FILE MANAGEMENT ROUTES
// ═══════════════════════════════════════════════════════════════

// Получить список файлов аккредитации
router.get('/:id/files', authenticate, async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    const files = await AccreditationFile.findAll({
      where: { accreditationId: req.params.id },
      order: [['createdAt', 'DESC']]
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(files);
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Загрузить файл(ы) к аккредитации
router.post('/:id/files', authenticate, upload.array('files', 10), async (req, res) => {
  try {
    const accreditation = await Accreditation.findByPk(req.params.id);
    if (!accreditation) {
      return res.status(404).json({ error: 'Accreditation not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadedFiles = [];
    for (const file of req.files) {
      // Исправляем кодировку имени файла (multer передает в latin1, нужно декодировать в utf8)
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      const accreditationFile = await AccreditationFile.create({
        accreditationId: req.params.id,
        filename: file.filename,
        originalName: originalName,
        mimeType: file.mimetype,
        size: file.size,
        path: file.path,
        uploadedBy: req.user.id
      });
      uploadedFiles.push(accreditationFile);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(201).json(uploadedFiles);
  } catch (error) {
    console.error('Upload files error:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Скачать файл
router.get('/:id/files/:fileId/download', authenticate, async (req, res) => {
  try {
    const file = await AccreditationFile.findOne({
      where: {
        id: req.params.fileId,
        accreditationId: req.params.id
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Проверяем существование файла
    try {
      await fs.access(file.path);
    } catch (err) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    // Правильно кодируем имя файла для поддержки кириллицы
    const encodedFilename = encodeURIComponent(file.originalName);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');

    // Резолвим абсолютный путь от текущей директории
    const absolutePath = path.resolve(file.path);
    res.sendFile(absolutePath);
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Удалить файл
router.delete('/:id/files/:fileId', authenticate, async (req, res) => {
  try {
    const file = await AccreditationFile.findOne({
      where: {
        id: req.params.fileId,
        accreditationId: req.params.id
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Удаляем файл с диска
    try {
      await fs.unlink(file.path);
    } catch (err) {
      console.error('Error deleting file from disk:', err);
    }

    await file.destroy();

    res.json({ message: 'File deleted' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;