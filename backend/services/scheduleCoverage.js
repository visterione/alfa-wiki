'use strict';

/**
 * Поиск дыр в расписании по направлению (ver. 9.17): Статистика → Аналитика →
 * Расписания. Арифметика — в utils/scheduleCoverage.js, здесь МИС, медцентры и
 * сохранённый состав групп.
 *
 * Считаем на лету, без синхронизации в базу. Смотрят это раз в месяц («в этом
 * месяце — на следующий»), а getSchedulePeriods отдаёт месяц всей сети за
 * шесть секунд, по одной специальности — за секунду. Таблица-зеркало расписания
 * устаревала бы между просмотрами и требовала бы своего крона ради отчёта,
 * который открывают двенадцать раз в год.
 */

const { misRequest } = require('./misClient');
const medCenters = require('./medCenters');
const { Setting } = require('../models');
const cov = require('../utils/scheduleCoverage');

const SETTINGS_KEY = 'schedule_coverage';
const MAX_DAYS = 92;
const USERS_TTL = 10 * 60 * 1000;
const PERIODS_TTL = 5 * 60 * 1000;

// Запасные часы работы — на случай, когда в карточке медцентра график не
// заполнен. Это та же таблица, что зашита в аналитике кабинетов (CLINIC_SCHEDULES
// в StepKpi.js): источником правды должна быть карточка медцентра, а эти цифры —
// лишь чтобы отчёт не молчал, пока её не заполнили.
const FALLBACK_HOURS = {
  '2':  { from: '08:00', to: '24:00', days: [0, 1, 2, 3, 4, 5, 6] }, // Альфа
  '3':  { from: '07:30', to: '23:00', days: [0, 1, 2, 3, 4, 5, 6] }, // Кидс
  '6':  { from: '08:00', to: '21:00', days: [0, 1, 2, 3, 4, 5, 6] }, // Линия
  '1':  { from: '07:30', to: '20:00', days: [0, 1, 2, 3, 4, 5, 6] }, // Проф
  '7':  { from: '08:00', to: '21:00', days: [0, 1, 2, 3, 4, 5, 6] }, // Смайл
  '4':  { from: '08:00', to: '20:00', days: [0, 1, 2, 3, 4, 5, 6] }, // 3К
  '11': { from: '08:00', to: '17:00', days: [1, 2, 3, 4, 5] },       // Сукко
  '12': { from: '08:00', to: '17:00', days: [1, 2, 3, 4, 5] },
};

let usersCache = null;
let usersAt = 0;
const periodsCache = new Map();

async function misList(endpoint, params) {
  const res = await misRequest(endpoint, params);
  if (!res || Number(res.error) !== 0 || !Array.isArray(res.data)) {
    const desc = res?.data?.desc || res?.data?.code || 'нет ответа';
    throw new Error(`МИС (${endpoint}): ${desc}`);
  }
  return res.data;
}

async function getUsers() {
  if (usersCache && Date.now() - usersAt < USERS_TTL) return usersCache;
  // show_all — скрытые в записи врачи тоже ведут приём по графику
  const data = await misList('getUsers', { show_all: 1 });
  usersCache = data.filter(u => !u.is_deleted);
  usersAt = Date.now();
  return usersCache;
}

const professionIdsOf = (u) =>
  [...(u.profession || []), ...(u.second_profession || [])].map(String);

async function listProfessions() {
  const [professions, users] = await Promise.all([misList('getProfessions', {}), getUsers()]);
  const counts = {};
  for (const u of users) for (const p of new Set(professionIdsOf(u))) counts[p] = (counts[p] || 0) + 1;
  return professions
    .filter(p => !p.is_deleted && counts[String(p.id)])
    .map(p => ({ id: String(p.id), name: p.name, doctors: counts[String(p.id)] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

async function fetchPeriods(from, to, userIds) {
  const key = `${from}|${to}|${userIds.join(',')}`;
  const hit = periodsCache.get(key);
  if (hit && Date.now() - hit.at < PERIODS_TTL) return hit.data;
  const [y1, m1, d1] = from.split('-');
  const [y2, m2, d2] = to.split('-');
  const data = await misList('getSchedulePeriods', {
    time_start: `${d1}.${m1}.${y1} 00:00`,
    time_end: `${d2}.${m2}.${y2} 23:59`,
    user_id: userIds.join(','),
  });
  periodsCache.set(key, { at: Date.now(), data });
  // Кэш маленький и живёт минуты — чистим по дороге, без таймеров
  for (const [k, v] of periodsCache) if (Date.now() - v.at > PERIODS_TTL) periodsCache.delete(k);
  return data;
}

async function readSettings() {
  const row = await Setting.findByPk(SETTINGS_KEY);
  const value = row?.value || {};
  return { excluded: value.excluded || {} };
}

async function setExcluded(professionId, userIds) {
  const settings = await readSettings();
  settings.excluded[String(professionId)] = [...new Set((userIds || []).map(String))];
  await Setting.upsert({
    key: SETTINGS_KEY,
    value: settings,
    description: 'Расписания: кого не считать врачом направления (служебные «сотрудники», совместители)',
  });
  return settings.excluded[String(professionId)];
}

/**
 * Окно контроля для медцентра на дату.
 * custom — [from, to] в минутах: одно окно для всех дней, но выходной день
 * медцентра остаётся выходным — ставить приём в закрытое здание бессмысленно.
 */
function windowResolver(clinicsByKey, custom) {
  return (clinicKey, date) => {
    const clinic = clinicsByKey.get(clinicKey);
    // Клиника без известного графика считается открытой ежедневно с 8 до 20:
    // лучше показать лишнюю дыру, чем молча не проверить филиал.
    if (!clinic?.hours) return custom || [8 * 60, 20 * 60];
    const hours = clinic.hours[cov.weekdayKey(date)];
    if (!hours) return null;
    return custom || [hours.from, hours.to];
  };
}

/** Часы медцентра по дням недели в минутах: из карточки, иначе запасные. */
function clinicHours(mc, misClinicId) {
  const wh = mc?.workingHours;
  if (wh && Object.keys(wh).length) {
    const out = {};
    for (const key of cov.WEEKDAY_KEYS) {
      const day = wh[key];
      const from = cov.hhmmToMin(day?.from);
      const to = day?.to === '00:00' ? cov.DAY_END : cov.hhmmToMin(day?.to);
      out[key] = from != null && to != null && to > from ? { from, to } : null;
    }
    return { hours: out, hoursSource: 'card' };
  }
  const fb = FALLBACK_HOURS[String(misClinicId)];
  if (!fb) return { hours: null, hoursSource: 'none' };
  const out = {};
  cov.WEEKDAY_KEYS.forEach((key, i) => {
    out[key] = fb.days.includes(i) ? { from: cov.hhmmToMin(fb.from), to: cov.hhmmToMin(fb.to) } : null;
  });
  return { hours: out, hoursSource: 'fallback' };
}

function checkPeriod(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Даты нужны в формате YYYY-MM-DD');
  }
  if (from > to) throw new Error('Начало периода позже конца');
  const days = cov.daysBetween(from, to);
  if (days.length > MAX_DAYS) throw new Error(`Период больше ${MAX_DAYS} дней`);
  return days;
}

/**
 * @param {object} q
 * @param {string} q.from, q.to       YYYY-MM-DD
 * @param {string} q.professionId     специальность МИС
 * @param {number} q.minGap           минимальная дыра, минут
 * @param {string} [q.window]         "08:00-20:00" — своё окно вместо часов медцентров
 */
async function getReport({ from, to, professionId, minGap = 60, window }) {
  const days = checkPeriod(from, to);
  if (!professionId) throw new Error('Не выбрана специальность');

  let custom = null;
  if (window) {
    const [a, b] = String(window).split('-');
    const s = cov.hhmmToMin(a);
    const e = b === '24:00' ? cov.DAY_END : cov.hhmmToMin(b);
    if (s == null || e == null || e <= s) throw new Error('Окно нужно в формате ЧЧ:ММ-ЧЧ:ММ');
    custom = [s, e];
  }

  const [users, settings] = await Promise.all([getUsers(), readSettings()]);
  const group = users.filter(u => professionIdsOf(u).includes(String(professionId)));
  const excluded = new Set(settings.excluded[String(professionId)] || []);

  const records = group.length
    ? await fetchPeriods(from, to, group.map(u => String(u.id)))
    : [];

  // clinic_id МИС → медцентр портала. Клиники, которых нет в справочнике,
  // остаются под своим номером: пропустить их молча значило бы спрятать дыру.
  const clinicsByKey = new Map();
  const keyByMisId = new Map();
  for (const misId of new Set(records.map(r => String(r.clinic_id)))) {
    const mc = await medCenters.byMisId(misId);
    const key = mc ? `mc:${mc.id}` : `mis:${misId}`;
    keyByMisId.set(misId, key);
    if (clinicsByKey.has(key)) continue;
    const canonical = mc?.misClinicIds?.[0] ?? misId;
    clinicsByKey.set(key, {
      key,
      name: mc?.name || `Клиника ${misId}`,
      color: mc?.color || '#94a3b8',
      logo: mc?.logoSquareUrl || mc?.logoUrl || null,
      sortOrder: mc?.sortOrder ?? 999,
      ...clinicHours(mc, canonical),
    });
  }
  const clinics = [...clinicsByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));

  const minGapSafe = Math.max(15, Math.min(24 * 60, Number(minGap) || 60));
  const report = cov.buildReport({
    days,
    records,
    excluded,
    clinics,
    clinicKeyOf: (id) => keyByMisId.get(String(id)) ?? null,
    windowOf: windowResolver(clinicsByKey, custom),
    minGap: minGapSafe,
  });

  // Состав группы: кто есть в МИС по этой специальности, и есть ли у него хоть
  // одна смена за период. Без смен — либо уволен и не удалён, либо график ещё
  // не составлен; интерфейс показывает таких отдельно.
  const shiftsByUser = {};
  for (const r of records) {
    if (Number(r.type) !== 1) continue;
    const id = String(r.user_id);
    shiftsByUser[id] = (shiftsByUser[id] || 0) + 1;
  }
  const doctors = group
    .map(u => ({
      id: String(u.id),
      name: u.name,
      shifts: shiftsByUser[String(u.id)] || 0,
      excluded: excluded.has(String(u.id)),
      // Основная ли это специальность — врачу со второй специальностью приём по
      // ней может быть не положен, и это первый кандидат в исключения.
      secondary: !(u.profession || []).map(String).includes(String(professionId)),
    }))
    .sort((a, b) => (b.shifts > 0) - (a.shifts > 0) || a.name.localeCompare(b.name, 'ru'));

  return {
    from,
    to,
    days,
    professionId: String(professionId),
    minGap: minGapSafe,
    window: custom ? { from: custom[0], to: custom[1] } : null,
    clinics: clinics.map(({ sortOrder, ...c }) => c),
    doctors,
    ...report,
  };
}

module.exports = { listProfessions, getReport, setExcluded, MAX_DAYS };
