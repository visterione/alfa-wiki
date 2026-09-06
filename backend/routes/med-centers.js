const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const { MedCenter, UserMedCenter, CourseMedCenter, Review, ReviewBoard, sequelize } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { isValidBadgeColor } = require('../utils/chatBadgeIcons');
const userChatBadge = require('../services/userChatBadge');
const medCentersService = require('../services/medCenters');

const router = express.Router();

// Справочник клиник. Раньше маршрут требовал прав на роли или на пользователей —
// и именно поэтому каждый модуль, которому нужны были название, цвет или логотип
// клиники, заводил себе копию списка прямо в коде. Читать справочник может любой
// авторизованный: секретов в нём нет, а альтернатива — девять расходящихся копий.
// Права остались там, где им место: на изменение.
router.get('/', authenticate, async (req, res) => {
  try {
    // «Направители» и «АУП» — служебные группировки зарплатного модуля, а не
    // филиалы. По умолчанию их не отдаём: списки, которые читают этот маршрут,
    // предлагают выбрать медцентр человеку. Админка справочника запросит их явно.
    const medCenters = await medCentersService.list({
      includeVirtual: req.query.includeVirtual === '1',
      includeInactive: req.query.includeInactive === '1'
    });
    res.json(medCenters);
  } catch (error) {
    console.error('Get med centers error:', error);
    res.status(500).json({ error: 'Ошибка загрузки медицинских центров' });
  }
});

/**
 * Точки на карте экрана входа. Единственный маршрут справочника без авторизации.
 *
 * Экран входа рисует карту сети до того, как человек представился, — спрашивать
 * токен не у кого. Поэтому отдаём здесь ровно то, что и так висит на сайте сети
 * и на вывеске: название, адрес, часы, цвет и логотип. Ни идентификаторов МИС,
 * ни юрлиц, ни главврачей, ни ключей ботов.
 *
 * Филиалы без координат пропускаем молча: пока широта с долготой не заполнены в
 * админке, ставить метку некуда, а падать из-за этого экран входа не должен.
 */
/**
 * Средняя оценка филиалов по отзывам.
 *
 * Отзыв не знает о филиале, о нём знает доска (ver. 7.83), поэтому считаем
 * через неё. Архивные доски и отзывы не берём: в архив уходит то, с чем уже не
 * работают, и в публичную оценку оно попадать не должно.
 */
async function ratings() {
  const rows = await Review.findAll({
    attributes: [
      [col('board.medCenterId'), 'medCenterId'],
      [fn('AVG', col('Review.rating')), 'avg'],
      [fn('COUNT', col('Review.id')), 'count']
    ],
    include: [{
      model: ReviewBoard,
      as: 'board',
      attributes: [],
      required: true,
      where: { archived: false, medCenterId: { [Op.ne]: null } }
    }],
    where: { archived: false },
    group: [literal('"board"."medCenterId"')],
    raw: true
  });

  const byId = new Map();
  rows.forEach(r => byId.set(String(r.medCenterId), {
    rating: Math.round(Number(r.avg) * 10) / 10,
    reviews: Number(r.count)
  }));
  return byId;
}

/**
 * Три положительных отзыва на филиал для экрана входа.
 *
 * Отбор жёсткий, и каждое условие здесь — не вкусовое.
 *
 * `isAutoImported` — только отзывы, приехавшие с площадок через GetLoyalty.
 * Их текст уже опубликован на Яндекс Картах, 2ГИС и ещё восьми площадках, и
 * показать его у себя — это показать то, что и так открыто. Отзыв, заведённый
 * руками, приехал из разбора обращения и наружу выходить не должен.
 *
 * Имя без цифр и плюса — условие, которое важнее всех остальных. В
 * `patientName` у автоимпорта лежит не имя: из 309 положительных отзывов 189
 * содержат цифры, а 162 — «+7», то есть это телефон пациента. Отдать такое на
 * маршрут без авторизации значит выложить мобильный номер человека рядом с
 * названием медцентра. Фильтр по цифрам убирает это по построению, а не
 * зачисткой на выходе, которую однажды забудут поправить. Отзывов с настоящим
 * именем хватает на все филиалы: меньше всего у «Линии» и «3К» — ровно три.
 *
 * Длина от 40 символов — «Всё отлично» карточку не наполнит; до 600 — чтобы
 * обрезка не съедала три четверти текста.
 *
 * Площадку не отдаём: подпись «Яндекс Карты» с карточки убрана по решению
 * заказчика, а держать на открытом маршруте поле, которого никто не показывает,
 * незачем. Понадобится атрибуция — возвращать вместе с `externalUrl`.
 *
 * Оконная функция, а не три запроса и не подзапрос на филиал: нужен именно
 * «первые три в каждой группе», и в SQL это ровно `row_number`.
 */
async function positiveReviews() {
  const rows = await sequelize.query(`
    SELECT mc, "patientName", "reviewText", "reviewDate", rating FROM (
      SELECT b."medCenterId" AS mc,
             r."patientName", r."reviewText", r."reviewDate", r.rating,
             row_number() OVER (
               PARTITION BY b."medCenterId"
               ORDER BY r."reviewDate" DESC, r.id
             ) AS rn
        FROM reviews r
        JOIN review_boards b ON b.id = r."boardId"
       WHERE r.archived = false
         AND r."deletedAt" IS NULL
         AND b.archived = false
         AND b."medCenterId" IS NOT NULL
         AND r.rating >= 5
         AND r."isAutoImported" = true
         AND r."patientName" !~ '[0-9+]'
         AND length(r."reviewText") BETWEEN 40 AND 600
    ) t
    WHERE rn <= 3
  `, { type: sequelize.QueryTypes.SELECT });

  const byId = new Map();
  rows.forEach(r => {
    const list = byId.get(String(r.mc)) || [];
    list.push({
      author: shortAuthor(r.patientName),
      text: clip(r.reviewText, 190),
      date: r.reviewDate,
      rating: Number(r.rating)
    });
    byId.set(String(r.mc), list);
  });
  return byId;
}

/**
 * «Наталья Степанова» → «Наталья С.». Фамилия целиком на витрине не нужна.
 *
 * Инициал берём по код-поинтам, а не через charAt: подписываются и эмодзи, а
 * charAt(0) разрезает суррогатную пару пополам и в имя попадает «\uFFFD».
 * Если начало второго слова не буква — оставляем одно первое слово.
 */
function shortAuthor(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Пациент';
  if (words.length === 1) return words[0];
  const initial = [...words[1]][0];
  if (!/\p{L}/u.test(initial)) return words[0];
  return `${words[0]} ${initial.toUpperCase()}.`;
}

/**
 * Обрезка по границе слова. Режем здесь, а не в вёрстке: маршрут открыт без
 * токена, и отдавать наружу полные тексты незачем — на карточку всё равно
 * влезает четверть.
 */
function clip(text, limit) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

/**
 * Кэш ответа целиком.
 *
 * Маршрут единственный в справочнике без авторизации, то есть единственный,
 * который можно долбить без учётной записи. Внутри теперь два запроса к отзывам
 * поверх справочника, и держать их за общей крышкой дешевле, чем разбираться,
 * какой из них кто именно вызвал. Пять минут — столько же, сколько живёт кэш
 * самого справочника в medCentersService: меньше смысла нет, больше — и правка
 * координат в админке слишком долго не видна на входе.
 */
const MAP_TTL_MS = 5 * 60 * 1000;
let mapCache = { at: 0, body: null };

router.get('/map', async (req, res) => {
  try {
    if (mapCache.body && Date.now() - mapCache.at < MAP_TTL_MS) {
      return res.json(mapCache.body);
    }
    const medCenters = await medCentersService.list({});
    // Оценка — украшение карточки, а не её суть: не посчиталась, покажем без неё
    const scores = await ratings().catch(err => {
      console.error('Med centers map ratings error:', err);
      return new Map();
    });
    // Отзывы тем более необязательны: не собрались — полоса внизу карты просто
    // не покажется, как она не показывается у филиала без доски.
    const quotes = await positiveReviews().catch(err => {
      console.error('Med centers map reviews error:', err);
      return new Map();
    });
    const body = medCenters
      // Проверка на null отдельная и обязательная: Number(null) — это ноль, а
      // ноль проходит Number.isFinite. Без неё филиалы с незаполненными
      // координатами уезжали бы меткой в Гвинейский залив.
      .filter(mc => mc.isActive !== false && !mc.isVirtual
        && mc.lat !== null && mc.lat !== undefined && mc.lat !== ''
        && mc.lng !== null && mc.lng !== undefined && mc.lng !== ''
        && Number.isFinite(Number(mc.lat)) && Number.isFinite(Number(mc.lng)))
      .map(mc => ({
        id: mc.id,
        name: mc.displayName || mc.name,
        shortName: mc.name,
        color: mc.color || null,
        logoUrl: mc.logoUrl || null,
        rating: scores.get(String(mc.id))?.rating ?? null,
        reviews: scores.get(String(mc.id))?.reviews ?? 0,
        lat: Number(mc.lat),
        lng: Number(mc.lng),
        city: mc.city || null,
        address: mc.address || null,
        workingHours: mc.workingHours || {},
        workingHoursNote: mc.workingHoursNote || null,
        quotes: quotes.get(String(mc.id)) || []
      }));
    mapCache = { at: Date.now(), body };
    return res.json(body);
  } catch (error) {
    console.error('Get med centers map error:', error);
    // Пустой список, а не ошибка: без карты экран входа обязан работать
    return res.json([]);
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const medCenter = await medCentersService.byId(req.params.id);
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });
    res.json(medCenter);
  } catch (error) {
    console.error('Get med center error:', error);
    res.status(500).json({ error: 'Ошибка загрузки медцентра' });
  }
});

// Правка справочника требует своего права. Исключение — цвет и порядок: их с
// ver. 6.64 меняют в «Ролях и правах», где красят метки сотрудников, и отбирать
// это у тех, кто уже там работает, незачем.
function canEdit(req, body) {
  if (req.user.isAdmin || req.user.adminAccess?.medCenters) return true;
  const onlyBadgeFields = Object.keys(body).every(k => k === 'color' || k === 'sortOrder');
  return onlyBadgeFields && !!req.user.adminAccess?.roles;
}

const EDITABLE = [
  'name', 'code', 'displayName', 'description', 'organizationId', 'misClinicIds',
  'botOrgKey', 'importAliases', 'color', 'logoUrl', 'logoSquareUrl', 'address', 'city', 'lat', 'lng',
  'phones', 'email', 'site', 'workingHours', 'workingHoursNote',
  'chiefDoctorUserId', 'chiefDoctorName', 'isVirtual', 'isActive', 'sortOrder'
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Поля, которые пусты по смыслу, кладём как NULL: пустая строка в code сломала бы
// частичный уникальный индекс, а в organizationId — внешний ключ.
const NULLABLE_WHEN_BLANK = new Set([
  'code', 'displayName', 'description', 'organizationId', 'botOrgKey', 'color',
  'logoUrl', 'logoSquareUrl', 'address', 'city', 'email', 'site',
  'workingHoursNote', 'chiefDoctorUserId', 'chiefDoctorName'
]);

function pickFields(body) {
  const data = {};
  for (const key of EDITABLE) {
    if (body[key] === undefined) continue;
    let value = body[key];
    if (typeof value === 'string') value = value.trim();
    if (value === '' && NULLABLE_WHEN_BLANK.has(key)) value = null;
    data[key] = value;
  }

  if (data.misClinicIds !== undefined) {
    // Приводим к строкам и чистим: в форме это поле ввода через запятую, и оттуда
    // легко приезжают пробелы и хвостовая пустая позиция.
    data.misClinicIds = (Array.isArray(data.misClinicIds) ? data.misClinicIds : String(data.misClinicIds).split(','))
      .map(v => String(v).trim())
      .filter(Boolean);
  }
  if (data.importAliases !== undefined) {
    // В нижний регистр сразу: сопоставление при импорте регистронезависимое, и
    // хранить «Альфа Kids» и «альфа kids» как разные варианты смысла нет.
    const seen = new Set();
    data.importAliases = (Array.isArray(data.importAliases) ? data.importAliases : String(data.importAliases).split(','))
      .map(v => String(v).trim().toLowerCase())
      .filter(v => v && !seen.has(v) && seen.add(v));
  }
  for (const key of ['lat', 'lng', 'sortOrder']) {
    if (data[key] === undefined) continue;
    if (data[key] === null || data[key] === '') { data[key] = key === 'sortOrder' ? 100 : null; continue; }
    const num = Number(data[key]);
    data[key] = Number.isFinite(num) ? num : null;
  }
  return data;
}

function validate(data, { partial = false } = {}) {
  if (!partial || data.name !== undefined) {
    if (!data.name || !String(data.name).trim()) return 'Название медцентра обязательно';
  }
  if (data.color && !isValidBadgeColor(data.color)) return 'Цвет должен быть в формате #rrggbb';
  if (data.code && !/^[a-z0-9-]+$/.test(data.code)) {
    return 'Код — только латиница в нижнем регистре, цифры и дефис';
  }
  if (data.misClinicIds && new Set(data.misClinicIds).size !== data.misClinicIds.length) {
    return 'В списке id из МИС есть повторы';
  }
  if (data.phones !== undefined && data.phones !== null && !Array.isArray(data.phones)) {
    return 'Телефоны должны быть массивом';
  }
  if (data.workingHours !== undefined && data.workingHours !== null) {
    if (typeof data.workingHours !== 'object' || Array.isArray(data.workingHours)) {
      return 'График должен быть объектом по дням недели';
    }
    for (const [day, value] of Object.entries(data.workingHours)) {
      if (!DAYS.includes(day)) return `Неизвестный день недели: ${day}`;
      if (value === null) continue; // выходной
      if (!value || !TIME_RE.test(value.from || '') || !TIME_RE.test(value.to || '')) {
        return `Время в ${day} должно быть в формате ЧЧ:ММ`;
      }
    }
  }
  return null;
}

// Триггер в базе не даёт отдать один clinic_id двум клиникам. Ловим его здесь,
// чтобы человек увидел причину, а не «Ошибка сохранения».
function isMisIdConflict(error) {
  const message = error?.parent?.message || error?.message || '';
  return message.includes('уже привязан к другому медцентру') || message.includes('misClinicIds есть повторы');
}

router.post('/', authenticate, requireAdminAccess('medCenters'), async (req, res) => {
  try {
    const data = pickFields(req.body);
    const error = validate(data);
    if (error) return res.status(400).json({ error });

    const medCenter = await MedCenter.create(data);
    medCentersService.invalidate();
    res.status(201).json(medCenter);
  } catch (error) {
    if (isMisIdConflict(error)) return res.status(409).json({ error: error.parent?.message || error.message });
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Медцентр с таким названием или кодом уже есть' });
    }
    console.error('Create med center error:', error);
    res.status(500).json({ error: 'Ошибка создания медцентра' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    if (!canEdit(req, req.body)) {
      return res.status(403).json({ error: 'Access denied to admin section: medCenters' });
    }

    const medCenter = await MedCenter.findByPk(req.params.id);
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });

    const data = pickFields(req.body);
    const error = validate(data, { partial: true });
    if (error) return res.status(400).json({ error });

    // Цвет и порядок решают, какой меткой красить сотрудника, — при их изменении
    // метки надо пересчитать. Остальные поля на метку не влияют.
    const badgeChanged = (data.color !== undefined && data.color !== medCenter.color) ||
                         (data.sortOrder !== undefined && data.sortOrder !== medCenter.sortOrder);

    await medCenter.update(data);

    // Иначе следующие пять минут справочник отдавал бы старые значения.
    medCentersService.invalidate();
    if (badgeChanged) await userChatBadge.recomputeForMedCenter(medCenter.id);

    res.json(medCenter);
  } catch (error) {
    if (isMisIdConflict(error)) return res.status(409).json({ error: error.parent?.message || error.message });
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Медцентр с таким названием или кодом уже есть' });
    }
    console.error('Update med center error:', error);
    res.status(500).json({ error: 'Ошибка обновления медцентра' });
  }
});

// Удаление разрешено, только пока на медцентр никто не сослался. Закрытый филиал
// гасят флагом isActive: на него смотрят зарплата, аккредитации и история, и
// вычистить эти ссылки нельзя — данные за прошлые периоды должны остаться читаемыми.
router.delete('/:id', authenticate, requireAdminAccess('medCenters'), async (req, res) => {
  try {
    const medCenter = await MedCenter.findByPk(req.params.id);
    if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });

    const [users, courses] = await Promise.all([
      UserMedCenter.count({ where: { medCenterId: medCenter.id } }),
      CourseMedCenter.count({ where: { medCenterId: medCenter.id } })
    ]);
    const blockers = [
      users   ? `сотрудников: ${users}` : null,
      courses ? `курсов: ${courses}`    : null
    ].filter(Boolean);

    if (blockers.length) {
      return res.status(409).json({
        error: `Медцентр используется (${blockers.join(', ')}). Отключите его флагом «Активен» вместо удаления`
      });
    }

    await medCenter.destroy();
    medCentersService.invalidate();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete med center error:', error);
    res.status(500).json({ error: 'Ошибка удаления медцентра' });
  }
});

module.exports = router;
