/**
 * Справочник медцентров — единственное место в бэкенде, откуда берутся клиники.
 *
 * Зачем сервис, а не прямой MedCenter.findAll в каждом маршруте: до ver. 6.67 список
 * клиник с цветами был скопирован девять раз в JS (partner-services, cron кэша цен,
 * pdfService, accreditations, clinicUtils и три админки) и копии успели разъехаться —
 * у Линии было четыре разных цвета, у Сукко три. Модули должны спрашивать здесь.
 *
 * Здесь только база и кэш; разбор и резолверы — в utils/medCenterIndex.js.
 *
 * Кэш в памяти: справочник — это десяток строк, которые меняются раз в полгода, а
 * читают их на каждый отчёт и каждую выгрузку. Держим в процессе, сбрасываем явно
 * из маршрутов, которые справочник правят (invalidate). TTL оставлен как страховка
 * на случай правки записи в обход API — прямо в базе.
 *
 * Один процесс в fork-режиме (ecosystem.config.js), поэтому межпроцессной
 * инвалидации не нужно. Появится кластер — сброс переедет на событие в Redis,
 * рядом с socketIoAdapter.
 */
const { MedCenter, Organization } = require('../models');
const idx = require('../utils/medCenterIndex');

const TTL_MS = 5 * 60 * 1000;

let cache = null;
let loadedAt = 0;
// Параллельные запросы на холодном кэше не должны бить в базу десять раз.
let inflight = null;

const ATTRS = [
  'id', 'name', 'code', 'displayName', 'description', 'organizationId',
  'misClinicIds', 'botOrgKey', 'importAliases', 'color', 'logoUrl', 'logoSquareUrl',
  'address', 'city', 'lat', 'lng', 'phones', 'email', 'site',
  'workingHours', 'workingHoursNote', 'chiefDoctorUserId', 'chiefDoctorName',
  'isVirtual', 'isActive', 'sortOrder'
];

async function loadFromDb() {
  const rows = await MedCenter.findAll({
    attributes: ATTRS,
    include: [{ model: Organization, as: 'organization', required: false }],
    order: [['sortOrder', 'ASC'], ['name', 'ASC']]
  });
  return idx.buildIndex(rows.map(r => r.toJSON()));
}

/** Сбрасывает кэш. Вызывать из всего, что меняет справочник. */
function invalidate() {
  cache = null;
  loadedAt = 0;
  inflight = null;
}

async function getIndex() {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = loadFromDb()
    .then(index => {
      cache = index;
      loadedAt = Date.now();
      inflight = null;
      return index;
    })
    .catch(err => {
      inflight = null;
      throw err;
    });

  return inflight;
}

/**
 * Все медцентры.
 * @param {{ includeVirtual?: boolean, includeInactive?: boolean }} opts
 *   includeVirtual  — добавить служебные группировки («Направители», «АУП»);
 *   includeInactive — добавить закрытые клиники (нужно истории и отчётам за прошлые периоды).
 */
async function list(opts) {
  return idx.filterRows((await getIndex()).rows, opts);
}

async function byId(id) {
  return idx.byId(await getIndex(), id);
}

async function byCode(code) {
  return idx.byCode(await getIndex(), code);
}

async function byName(name) {
  return idx.byName(await getIndex(), name);
}

/**
 * Медцентр по clinic_id из МИС. Здесь же схлопываются исторические дубли id
 * (у Сукко их два) — раньше это делала карта CLINIC_ID_ALIASES в коде фронта.
 */
async function byMisId(clinic) {
  return idx.byMisId(await getIndex(), clinic);
}

/** Канонический clinic_id медцентра: первый в misClinicIds. */
async function canonicalMisId(clinic) {
  return idx.canonicalMisId(await getIndex(), clinic);
}

async function colorByMisId(clinic, fallback) {
  return idx.colorByMisId(await getIndex(), clinic, fallback);
}

async function nameByMisId(clinic) {
  return idx.nameByMisId(await getIndex(), clinic);
}

/**
 * Клиники для запросов в МИС: настоящие, активные, с числовым id.
 * Этим списком ходят синхронизации кэшей и отчёты по клиникам.
 */
async function misClinics() {
  return idx.misClinics((await getIndex()).rows);
}

module.exports = {
  list,
  byId,
  byCode,
  byName,
  byMisId,
  canonicalMisId,
  colorByMisId,
  nameByMisId,
  misClinics,
  invalidate
};
