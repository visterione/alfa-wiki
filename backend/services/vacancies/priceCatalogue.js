'use strict';

/**
 * Прайс филиала: специальности и услуги (ver. 8.21).
 *
 * В 8.20 и то и другое спрашивалось у «Реновации» — getProfessions и
 * getServices на каждое открытие экрана. Теперь берётся из своей таблицы
 * partner_service_cache, куда прайс и так синхронизируется: данные там свежие,
 * а походы в МИС из публичного контура исчезают совсем.
 *
 * Находка, на которой всё держится: **верхний уровень дерева категорий в
 * «Реновации» и есть специальность**. «Невролог», «Акушер-гинеколог»,
 * «Оториноларинголог», «Терапевт» — это корни categoryPath, а не выдуманные
 * нами группы. Значит специальность в анкете и раздел, из которого потом
 * подтягиваются услуги, — одно и то же, и сопоставлять их не нужно.
 *
 * Второе, что пришлось учесть: 94% строк кэша — лабораторные анализы шести
 * лабораторий («Анализы ИНВИТРО», «Анализы KDL» и далее). Врач их не оказывает,
 * он их назначает, и в списке «что я готов делать» им не место. Без этого
 * отсечения экран выбора услуг открывался бы на сорок тысяч строк вместо трёх
 * тысяч.
 */

const { Op } = require('sequelize');

const { PartnerServiceCache, MedCenter } = require('../../models');

// Корни-лаборатории. Отсекаются по префиксу, а не списком имён: лаборатории
// заводят новые («Анализы Helix», «Анализы Микротех» появились позже остальных),
// и список пришлось бы дописывать каждый раз.
const LAB_ROOT = /^Анализы\b/i;

// Разделы, которые не являются ни специальностью, ни тем, что человек «умеет»:
// это способ приёма или организационная точка. В выборе услуг они мешают, в
// списке специальностей — тем более.
const NOT_A_SPECIALITY = new Set([
  'Живая очередь',
  'Скорая помощь',
  'Стационар',
  'Телемедицина',
  'Выезд врача на дом',
  'Выезд медсестры на дом',
  'Процедурный кабинет',
  'Перевязочный кабинет',
  'Вакцинация'
]);

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function rootOf(path) {
  return String(path || '').split('/')[0].trim();
}

/** clinic_id филиала. Медцентру в портале может соответствовать несколько клиник МИС. */
async function clinicIdsFor(medCenterId) {
  if (!medCenterId) return [];
  const mc = await MedCenter.findByPk(medCenterId, { attributes: ['misClinicIds'] });
  return (mc?.misClinicIds || [])
    .filter(value => /^\d+$/.test(String(value)))
    .map(Number);
}

/**
 * Живые строки прайса филиала — без лабораторных, скрытых и удалённых.
 *
 * Кэшируем на десять минут: экран выбора услуг открывается редко, но каждое
 * открытие иначе поднимает полторы тысячи строк, а прайс меняется раз в сутки.
 */
async function rowsFor(medCenterId) {
  const hit = cache.get(medCenterId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const clinicIds = await clinicIdsFor(medCenterId);
  if (!clinicIds.length) return [];

  const rows = await PartnerServiceCache.findAll({
    where: {
      clinicId: { [Op.in]: clinicIds },
      isDeleted: false,
      isHidden: false,
      categoryPath: { [Op.notILike]: 'Анализы%' }
    },
    attributes: ['serviceId', 'code', 'title', 'price', 'duration', 'categoryPath', 'categoryTitle'],
    raw: true
  });

  // Одна и та же услуга может прийти из двух клиник филиала с разной ценой.
  // Оставляем одну строку на услугу: кандидат отмечает «умею это», а не
  // «умею это по такой-то цене».
  const byId = new Map();
  for (const row of rows) {
    const root = rootOf(row.categoryPath);
    if (!root || LAB_ROOT.test(root)) continue;
    if (!byId.has(row.serviceId)) byId.set(row.serviceId, { ...row, root });
  }

  const clean = [...byId.values()];
  cache.set(medCenterId, { at: Date.now(), rows: clean });
  return clean;
}

/**
 * Специальности филиала — то, из чего кандидат выбирает в анкете.
 *
 * Возвращаются именами: устойчивого идентификатора у корня категории нет, а имя
 * одинаково во всех филиалах.
 */
async function specialities(medCenterId) {
  const rows = await rowsFor(medCenterId);
  const counts = new Map();
  for (const row of rows) {
    if (NOT_A_SPECIALITY.has(row.root)) continue;
    counts.set(row.root, (counts.get(row.root) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, services]) => ({ name, services }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/**
 * Услуги по выбранным специальностям.
 *
 * Специальность не сошлась ни с одним разделом — отдаём пустой список и честно
 * говорим об этом: у «Смайла», например, всего два клинических раздела, и
 * терапевту там выбирать нечего.
 *
 * @param {string} medCenterId
 * @param {string[]} chosen имена специальностей из анкеты
 */
async function servicesFor(medCenterId, chosen = []) {
  const rows = await rowsFor(medCenterId);
  if (!rows.length) {
    return { ok: false, reason: 'Прайс этого филиала ещё не выгружен' };
  }

  const wanted = new Set(chosen.map(name => String(name).trim()).filter(Boolean));
  if (!wanted.size) return { ok: false, reason: 'В анкете не выбрана специальность' };

  const own = rows.filter(row => wanted.has(row.root));
  if (!own.length) {
    return {
      ok: false,
      reason: `В прайсе филиала нет раздела «${[...wanted][0]}» — выбирать нечего`
    };
  }

  return {
    ok: true,
    services: own
      .map(row => ({
        serviceId: String(row.serviceId),
        code: row.code || null,
        title: row.title,
        price: row.price != null ? Number(row.price) : null,
        // Длительность в прайсе заполнена у каждой шестой позиции. Пустое
        // значение — это «в прайсе не указано», а не «ноль минут», и кандидату
        // такое поле показывается пустым, а не с подставленным числом.
        duration: row.duration || null,
        speciality: row.root,
        // Подраздел внутри специальности: «Неврология / Диагностика». Корень из
        // пути убираем — он и так известен, и повторять его в каждой строке
        // значит съесть половину ширины экрана.
        category: categoryOf(row)
      }))
      .sort((a, b) => a.category.localeCompare(b.category, 'ru') || a.title.localeCompare(b.title, 'ru'))
  };
}

function categoryOf(row) {
  const parts = String(row.categoryPath || '').split('/').map(p => p.trim()).filter(Boolean);
  const tail = parts.slice(1).join(' · ');
  return tail || row.categoryTitle || row.root;
}

/** Сброс кэша — на случай, если прайс переcинхронизировали и ждать десять минут не хочется. */
function forget(medCenterId) {
  if (medCenterId) cache.delete(medCenterId);
  else cache.clear();
}

module.exports = { specialities, servicesFor, clinicIdsFor, forget, LAB_ROOT, NOT_A_SPECIALITY };
