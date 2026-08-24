/**
 * Матрица «услуга × филиал»: цена, врачи филиала и длительность каждого из них.
 *
 * Собираем на сервере, а не в браузере: иначе странице пришлось бы дёргать МИС по
 * разу на филиал и сшивать три источника у себя, а список врачей — это один общий
 * ответ getUsers, который выгоднее держать в кэше процесса на всех читателей.
 *
 * Ничего не копируем: цена берётся из кэша прейскуранта (его наполняет крон), а
 * длительность — из doctor_service_durations, то есть из той же строки, которую
 * правит редактор карточки врача. Поэтому «синхронизации» у страницы нет и не
 * нужно — поменяли 20 на 30 в карточке, следующий рендер уже показывает 30.
 */
const express = require('express');
const { Op } = require('sequelize');
const {
  PartnerServiceCache, DoctorServiceDuration, DoctorCard, Setting, User, sequelize
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { misRequest } = require('../services/misClient');
const { parseDurationMinutes } = require('../services/bookingDurationService');
const medCenters = require('../services/medCenters');

const router = express.Router();

const SETTINGS_KEY = 'service-matrix';
const ROSTER_TTL_MS = 10 * 60 * 1000;
const MAX_SERVICES = 300;

// Право то же, что и на карточки врачей: матрица показывает их длительности и
// заводить для неё отдельную роль означало бы разъезд двух списков доступа.
const canEditMatrix = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.isAdmin || user.canEditDoctorCards) return next();
    return res.status(403).json({ error: 'Доступ запрещён', message: 'Нет прав на настройку матрицы услуг' });
  } catch (err) {
    console.error('canEditMatrix middleware error:', err);
    return res.status(500).json({ error: 'Ошибка проверки прав доступа' });
  }
};

// ─── Ростер исполнителей из МИС ──────────────────────────────────────────────
// getUsers без clinic_id отдаёт всех разом, и у каждой записи уже есть clinic и
// services. Раньше здесь планировался запрос на филиал, но это те же данные в
// шесть заходов, поэтому берём один ответ и раскладываем его сами.
let rosterCache = null;
let rosterLoadedAt = 0;
let rosterInflight = null;

// В роли «врач» в МИС заведены не только люди: кабинеты КТ, операционные,
// дневные стационары, холтеры. Пациента на них действительно записывают, но в
// таблице врачей они мешают, поэтому помечаем их и по умолчанию прячем.
const FACILITY_WORDS = /кабинет|стационар|блок|склад|забор|вакцинац|администратор|этаж|ктг|кт |мрт|лаборатор|холтер|физио|операционн|перевязочн|процедурн|палат|школа|выезд|рентген|пит\b|тестов/i;
// Фамилия в МИС бывает со второй в скобках: «Кузьмина(Скворцова) Елена Юрьевна».
const PERSON_NAME = /^[А-ЯЁ][а-яё-]+\s*(?:\([А-ЯЁ][а-яё-]+\))?(?:\s+[А-ЯЁ][а-яё-]+){1,2}$/;

function looksLikePerson(name) {
  const value = String(name || '').trim();
  return PERSON_NAME.test(value) && !FACILITY_WORDS.test(value);
}

/**
 * Карта «любой clinic_id из МИС → канонический id медцентра». У медцентра в
 * справочнике может быть несколько misClinicIds, а getUsers отдаёт какой-то один
 * из них: без приведения врач просто не попадёт в столбец своего филиала.
 */
async function canonicalClinicMap() {
  const rows = await medCenters.list();
  const map = new Map();
  for (const row of rows) {
    const canonical = Number((row.misClinicIds || [])[0]);
    if (!Number.isInteger(canonical)) continue;
    for (const raw of row.misClinicIds || []) map.set(String(raw), canonical);
  }
  return map;
}

/**
 * Какая длительность попадёт в ячейку и откуда она взялась.
 * Порядок именно такой: своё время врача по филиалу важнее общего значения из
 * карточки, а дефолт услуги — последнее, что можно показать вместо прочерка.
 */
function pickDuration({ own, legacy, serviceDefault }) {
  if (own) return { duration: own, source: 'doctor' };
  if (legacy) return { duration: legacy, source: 'card' };
  if (serviceDefault) return { duration: serviceDefault, source: 'service' };
  return { duration: null, source: 'none' };
}

async function loadRoster() {
  const [response, canonical] = await Promise.all([
    misRequest('getUsers', { role: 'doctor', with_services: 1, show_all: 1 }),
    canonicalClinicMap()
  ]);
  if (Number(response?.error) !== 0 || !Array.isArray(response?.data)) {
    throw new Error('МИС не вернула список исполнителей');
  }

  return response.data
    .filter(row => !row.is_deleted)
    .map(row => ({
      misUserId: String(row.id),
      name: String(row.name || '').trim(),
      isFacility: !looksLikePerson(row.name),
      clinicIds: [...new Set((row.clinic || [])
        .map(id => canonical.get(String(id)))
        .filter(Number.isInteger))],
      serviceIds: new Set((row.services || []).map(String))
    }));
}

async function getRoster() {
  if (rosterCache && Date.now() - rosterLoadedAt < ROSTER_TTL_MS) return rosterCache;
  if (rosterInflight) return rosterInflight;

  rosterInflight = loadRoster()
    .then(rows => {
      rosterCache = rows;
      rosterLoadedAt = Date.now();
      rosterInflight = null;
      return rows;
    })
    .catch(err => {
      rosterInflight = null;
      throw err;
    });

  return rosterInflight;
}

// ─── Конфигурация подборок ───────────────────────────────────────────────────
// Подборки живут в settings, а не в html-файле: состав услуг правит заведующая, а
// не разработчик, и деплой ради добавления строки — плохой обмен.
function normalizePresets(raw) {
  const presets = Array.isArray(raw?.presets) ? raw.presets : [];
  return presets.slice(0, 50).map((preset, position) => ({
    id: String(preset.id || `preset-${position + 1}`),
    name: String(preset.name || 'Без названия').slice(0, 200),
    serviceIds: [...new Set((preset.serviceIds || []).map(String).filter(Boolean))].slice(0, MAX_SERVICES),
    clinicIds: [...new Set((preset.clinicIds || []).map(Number).filter(Number.isInteger))]
  }));
}

router.get('/config', authenticate, async (req, res) => {
  try {
    const [setting, clinics, user] = await Promise.all([
      Setting.findByPk(SETTINGS_KEY),
      medCenters.misClinics(),
      User.findByPk(req.user.id)
    ]);
    res.json({
      presets: normalizePresets(setting?.value),
      clinics,
      canEdit: Boolean(user?.isAdmin || user?.canEditDoctorCards)
    });
  } catch (err) {
    console.error('❌ /service-matrix/config:', err.message);
    res.status(500).json({ error: 'Ошибка загрузки настроек матрицы' });
  }
});

router.put('/config', authenticate, canEditMatrix, async (req, res) => {
  try {
    const presets = normalizePresets(req.body);
    await Setting.upsert({
      key: SETTINGS_KEY,
      value: { presets },
      description: 'Подборки услуг для матрицы «услуга × филиал»'
    });
    res.json({ presets });
  } catch (err) {
    console.error('❌ PUT /service-matrix/config:', err.message);
    res.status(500).json({ error: 'Ошибка сохранения настроек матрицы' });
  }
});

// ─── Поиск услуг для конструктора подборки ───────────────────────────────────
// Ищем по кэшу прейскуранта, а не в МИС: одна услуга лежит там строкой на филиал,
// поэтому схлопываем по serviceId и попутно отдаём, в каких филиалах она есть.
router.get('/services/search', authenticate, async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) return res.json([]);

    const rows = await PartnerServiceCache.findAll({
      attributes: ['serviceId', 'clinicId', 'code', 'subCode', 'title', 'categoryTitle'],
      where: {
        isDeleted: false,
        [Op.or]: [
          { title: { [Op.iLike]: `%${query}%` } },
          { code: { [Op.iLike]: `%${query}%` } },
          { subCode: { [Op.iLike]: `%${query}%` } }
        ]
      },
      order: [['title', 'ASC']],
      limit: 600
    });

    const merged = new Map();
    for (const row of rows) {
      const key = String(row.serviceId);
      if (!merged.has(key)) {
        merged.set(key, {
          serviceId: key,
          code: row.code,
          subCode: row.subCode,
          title: row.title,
          categoryTitle: row.categoryTitle,
          clinicIds: []
        });
      }
      merged.get(key).clinicIds.push(row.clinicId);
    }
    res.json([...merged.values()].slice(0, 100));
  } catch (err) {
    console.error('❌ /service-matrix/services/search:', err.message);
    res.status(500).json({ error: 'Ошибка поиска услуг' });
  }
});

// ─── Сама матрица ────────────────────────────────────────────────────────────
// Вынесено из обработчика: так сборку можно позвать из скрипта проверки, не
// поднимая http и не выписывая себе токен.
async function buildMatrix(input = {}) {
  {
    const serviceIds = [...new Set((input.serviceIds || []).map(String).filter(Boolean))].slice(0, MAX_SERVICES);
    const clinics = await medCenters.misClinics();
    const requested = new Set((input.clinicIds || []).map(Number).filter(Number.isInteger));
    const visibleClinics = requested.size ? clinics.filter(c => requested.has(c.id)) : clinics;

    if (!serviceIds.length || !visibleClinics.length) {
      return { clinics: visibleClinics, services: [], syncedAt: null, rosterAt: null };
    }

    const clinicIds = visibleClinics.map(c => c.id);
    const [priceRows, durationRows, cards, roster] = await Promise.all([
      PartnerServiceCache.findAll({
        where: { serviceId: { [Op.in]: serviceIds.map(Number) }, clinicId: { [Op.in]: clinicIds } }
      }),
      DoctorServiceDuration.findAll({
        where: { serviceId: { [Op.in]: serviceIds }, clinicId: { [Op.in]: clinicIds.map(String) } }
      }),
      DoctorCard.findAll({ attributes: ['id', 'fullName', 'specialty', 'photo', 'profileUrl', 'pageSlug', 'metadata'] }),
      getRoster()
    ]);

    // Карточка даёт человеческое ФИО, специальность и ссылку. Врач без карточки в
    // матрице всё равно нужен — иначе регистратура решит, что услугу не делают.
    const cardByMisId = new Map();
    for (const card of cards) {
      const misUserId = String(card.metadata?.misUserId || '');
      if (misUserId && !cardByMisId.has(misUserId)) cardByMisId.set(misUserId, card);
    }

    // До ver. 6.56 длительность жила в карточке одним полем на услугу, без
    // разбивки по филиалам, и текстом: «40 мин», «30 мин (Альфа) / 20 мин (Кидс)».
    // Структурная таблица её не забирала, поэтому большинство значений и сегодня
    // лежит здесь: если читать только doctor_service_durations, матрица покажет
    // дефолты услуг там, где у врача давно проставлено своё время.
    const legacyByKey = new Map();
    for (const card of cards) {
      const misUserId = String(card.metadata?.misUserId || '');
      if (!misUserId) continue;
      for (const [serviceId, override] of Object.entries(card.metadata?.serviceOverrides || {})) {
        const text = String(override?.aliasDuration || '').trim();
        if (!text) continue;
        const key = `${misUserId}:${serviceId}`;
        const minutes = parseDurationMinutes(text);
        const previous = legacyByKey.get(key);
        // Свободный текст («45-60», «15 мин. В прием не входит») намеренно не
        // угадываем: показываем его припиской рядом со временем, чтобы в
        // регистратуре видели оговорку, а не только число.
        const note = minutes && String(minutes) === text.replace(/\s*мин(\.|ут(а|ы)?)?$/iu, '').trim() ? null : text;
        if (!previous || (!previous.minutes && minutes)) legacyByKey.set(key, { minutes, note });
      }
    }

    const priceByKey = new Map();
    for (const row of priceRows) priceByKey.set(`${row.clinicId}:${row.serviceId}`, row);

    const durationByKey = new Map();
    for (const row of durationRows) durationByKey.set(`${row.misUserId}:${row.clinicId}:${row.serviceId}`, row.durationMinutes);

    // Порядок услуг задаёт подборка, а не база: составитель расставил их осмысленно.
    const services = serviceIds.map(serviceId => {
      const anyPrice = clinicIds.map(id => priceByKey.get(`${id}:${serviceId}`)).find(Boolean);
      const cells = {};

      for (const clinic of visibleClinics) {
        const price = priceByKey.get(`${clinic.id}:${serviceId}`);
        const doctors = roster
          .filter(person => person.clinicIds.includes(clinic.id) && person.serviceIds.has(serviceId))
          .map(person => {
            const card = cardByMisId.get(person.misUserId);
            const own = durationByKey.get(`${person.misUserId}:${clinic.id}:${serviceId}`);
            const legacy = legacyByKey.get(`${person.misUserId}:${serviceId}`) || null;
            const resolved = pickDuration({ own, legacy: legacy?.minutes, serviceDefault: price?.duration });
            return {
              misUserId: person.misUserId,
              name: card?.fullName || person.name,
              specialty: card?.specialty || null,
              photo: card?.photo || null,
              // Ссылка на карточку: у вики-страницы есть подсветка по id карточки.
              profileUrl: card ? (card.profileUrl || `/page/${card.pageSlug}?highlight=${card.id}`) : null,
              isFacility: person.isFacility,
              duration: resolved.duration,
              // Дефолт услуги нельзя показывать как персональную настройку: по
              // нему записывают, но за ним никто не следил. Значение из карточки —
              // персональное, но общее на все филиалы, и это тоже видно по метке.
              durationSource: resolved.source,
              durationNote: legacy?.note || null
            };
          })
          .sort((a, b) => Number(a.isFacility) - Number(b.isFacility) || a.name.localeCompare(b.name, 'ru'));

        cells[clinic.id] = {
          price: price?.price != null ? Number(price.price) : null,
          isHidden: Boolean(price?.isHidden),
          exists: Boolean(price),
          defaultDuration: price?.duration ?? null,
          doctors
        };
      }

      return {
        serviceId,
        code: anyPrice?.code || null,
        subCode: anyPrice?.subCode || null,
        title: anyPrice?.title || `Услуга ${serviceId}`,
        cells
      };
    });

    const syncedAt = priceRows.reduce((latest, row) => (
      row.syncedAt && (!latest || row.syncedAt > latest) ? row.syncedAt : latest
    ), null);

    return { clinics: visibleClinics, services, syncedAt, rosterAt: new Date(rosterLoadedAt).toISOString() };
  }
}

router.post('/data', authenticate, async (req, res) => {
  try {
    res.json(await buildMatrix(req.body));
  } catch (err) {
    console.error('❌ /service-matrix/data:', err.message);
    res.status(500).json({ error: 'Ошибка сборки матрицы услуг' });
  }
});

module.exports = router;
module.exports.buildMatrix = buildMatrix;
module.exports.looksLikePerson = looksLikePerson;
module.exports.pickDuration = pickDuration;
