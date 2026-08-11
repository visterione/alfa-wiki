'use strict';

/**
 * Разбор справочника медцентров: индексы и резолверы.
 *
 * Чистая часть, без базы, — по образцу resolveChatBadge.js. Работу с БД и кэшем
 * держит services/medCenters.js.
 *
 * Главный резолвер здесь — byMisId: он переводит clinic_id из МИС в медцентр и
 * заодно схлопывает исторические дубли id (у Сукко их два). Раньше это делала
 * карта CLINIC_ID_ALIASES в коде фронта, и знали о ней не все модули.
 */

const FALLBACK_COLOR = '#94a3b8';

/** Строит индексы по массиву записей справочника. */
function buildIndex(rows = []) {
  const byId = new Map();
  const byCode = new Map();
  const byName = new Map();
  const byMisId = new Map();

  for (const row of rows) {
    if (!row) continue;
    if (row.id) byId.set(String(row.id), row);
    if (row.code) byCode.set(String(row.code), row);
    if (row.name) byName.set(String(row.name).trim().toLowerCase(), row);
    for (const misId of row.misClinicIds || []) byMisId.set(String(misId), row);
  }

  return { rows, byId, byCode, byName, byMisId };
}

/**
 * Достаёт сырой clinic_id: в ответах МИС клиника приходит то объектом { id, name },
 * то голым числом, то строкой.
 */
function rawMisId(clinic) {
  if (clinic === null || clinic === undefined || clinic === '') return null;
  const raw = typeof clinic === 'object' ? clinic.id : clinic;
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw);
}

function byMisId(index, clinic) {
  const raw = rawMisId(clinic);
  return raw === null ? null : index.byMisId.get(raw) || null;
}

function byId(index, id) {
  return id ? index.byId.get(String(id)) || null : null;
}

function byCode(index, code) {
  return code ? index.byCode.get(String(code)) || null : null;
}

function byName(index, name) {
  return name ? index.byName.get(String(name).trim().toLowerCase()) || null : null;
}

/** Канонический clinic_id — первый в misClinicIds. */
function canonicalMisId(index, clinic) {
  const mc = byMisId(index, clinic);
  return mc?.misClinicIds?.[0] ?? null;
}

/** Цвет клиники; фолбэк — тот же серый, которым отчёты рисуют неизвестную клинику. */
function colorByMisId(index, clinic, fallback = FALLBACK_COLOR) {
  return byMisId(index, clinic)?.color || fallback;
}

/** Название; для неизвестного id возвращает сам id — в отчёте это заметнее пустоты. */
function nameByMisId(index, clinic) {
  const mc = byMisId(index, clinic);
  if (mc) return mc.name;
  const raw = rawMisId(clinic);
  return raw === null ? '' : raw;
}

/**
 * Клиники, с которыми имеет смысл ходить в МИС: настоящие, активные и с числовым
 * id. Отсекает служебные группировки («Направители», «АУП») и ИП Микаелян — у него
 * в МИС своей клиники нет, портал подставляет псевдо-id «ip».
 * Возвращает id числом: в кэшах и таблицах МИС-блока это integer.
 */
function misClinics(rows = []) {
  return rows
    .filter(r => !r.isVirtual && r.isActive)
    .map(r => {
      const canonical = (r.misClinicIds || [])[0];
      const id = Number(canonical);
      return Number.isInteger(id) ? { id, name: r.name, color: r.color, code: r.code } : null;
    })
    .filter(Boolean);
}

/** Фильтр списка: служебные группировки и закрытые клиники прячем по умолчанию. */
function filterRows(rows, { includeVirtual = false, includeInactive = false } = {}) {
  return rows.filter(r =>
    (includeVirtual || !r.isVirtual) &&
    (includeInactive || r.isActive)
  );
}

module.exports = {
  FALLBACK_COLOR,
  buildIndex,
  rawMisId,
  byId,
  byCode,
  byName,
  byMisId,
  canonicalMisId,
  colorByMisId,
  nameByMisId,
  misClinics,
  filterRows
};
