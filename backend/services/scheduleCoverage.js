'use strict';

/**
 * Поиск дыр в расписании по направлению (ver. 9.17): Статистика → Аналитика →
 * Расписания. Арифметика — в utils/scheduleCoverage.js, здесь МИС, медцентры и
 * сохранённые до 9.19 исключения из групп.
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

let professionNamesCache = null;
let professionNamesAt = 0;
async function getProfessionNames() {
  if (professionNamesCache && Date.now() - professionNamesAt < USERS_TTL) return professionNamesCache;
  const list = await misList('getProfessions', {});
  professionNamesCache = new Map(list.map(p => [String(p.id), p.name]));
  professionNamesAt = Date.now();
  return professionNamesCache;
}

const professionIdsOf = (u) =>
  [...(u.profession || []), ...(u.second_profession || [])].map(String);

/**
 * Медцентр портала по clinic_id МИС — в том виде, в каком его рисует отчёт.
 * Клиники, которых нет в справочнике, остаются под своим номером: пропустить
 * их молча значило бы спрятать дыру.
 */
async function clinicEntry(misId) {
  const mc = await medCenters.byMisId(misId);
  const canonical = mc?.misClinicIds?.[0] ?? misId;
  return {
    key: mc ? `mc:${mc.id}` : `mis:${misId}`,
    name: mc?.name || `Клиника ${misId}`,
    color: mc?.color || '#94a3b8',
    logo: mc?.logoSquareUrl || mc?.logoUrl || null,
    sortOrder: mc?.sortOrder ?? 999,
    virtual: !mc || !!mc.isVirtual,
    canonical,
    mc,
  };
}

/**
 * Специальности вместе с их врачами — из них собирается выпадающий список, и
 * врачей второго уровня он показывает сразу, не дожидаясь отчёта.
 *
 * Медцентры врача здесь — те, к которым он привязан в карточке МИС. Это лишь
 * подсказка «чей он», пока у врача нет смен за период: как только смены есть,
 * интерфейс показывает медцентры по ним — карточка нередко перечисляет все
 * филиалы сразу. Служебные группировки вроде «Направителей» не показываем.
 */
async function listProfessions() {
  const [professions, users, settings] = await Promise.all([misList('getProfessions', {}), getUsers(), readSettings()]);
  const byProfession = {};
  const clinics = {};
  const entries = new Map();
  for (const u of users) {
    const keys = [];
    for (const misId of Array.isArray(u.clinic) ? u.clinic.map(String) : []) {
      if (!entries.has(misId)) entries.set(misId, await clinicEntry(misId));
      const c = entries.get(misId);
      if (c.virtual || keys.includes(c.key)) continue;
      keys.push(c.key);
      clinics[c.key] = { key: c.key, name: c.name, color: c.color, logo: c.logo, sortOrder: c.sortOrder };
    }
    keys.sort((a, b) => clinics[a].sortOrder - clinics[b].sortOrder);
    for (const p of new Set(professionIdsOf(u))) {
      (byProfession[p] ||= []).push({ id: String(u.id), name: u.name, clinics: keys });
    }
  }
  const list = professions
    .filter(p => !p.is_deleted && byProfession[String(p.id)])
    .map(p => ({
      id: String(p.id),
      name: p.name,
      doctors: byProfession[String(p.id)].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  // Исключения, сохранённые до 9.19 общими на всех, — теперь лишь начальная
  // отметка: пока человек сам не тронул галочки специальности, у него сняты те
  // же служебные записи, что были сняты для всех.
  return { professions: list, clinics: Object.values(clinics).map(({ sortOrder, ...c }) => c), savedExcluded: settings.excluded };
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
 * @param {string[]} q.professionIds  специальности МИС; несколько — одна
 *                                    сводная группа (см. ниже)
 * @param {string[]} [q.exclude]      кого из группы не считать; без него —
 *                                    сохранённые исключения специальностей
 * @param {string}   [q.anchor]       эталонная специальность из выбранных
 * @param {number} q.minGap           минимальная дыра, минут
 * @param {string} [q.window]         "08:00-20:00" — своё окно вместо часов медцентров
 */
async function getReport({ from, to, professionIds, exclude, anchor, minGap = 60, window }) {
  const days = checkPeriod(from, to);
  const selected = [...new Set((professionIds || []).map(String).filter(Boolean))];
  if (!selected.length) throw new Error('Не выбрана специальность');

  let custom = null;
  if (window) {
    const [a, b] = String(window).split('-');
    const s = cov.hhmmToMin(a);
    const e = b === '24:00' ? cov.DAY_END : cov.hhmmToMin(b);
    if (s == null || e == null || e <= s) throw new Error('Окно нужно в формате ЧЧ:ММ-ЧЧ:ММ');
    custom = [s, e];
  }

  const [users, settings, professionNames] = await Promise.all([getUsers(), readSettings(), getProfessionNames()]);
  // Сводный режим (ver. 9.19): несколько специальностей считаются одной
  // группой. Сравнивают их, когда они смежные — флеболог отправляет пациента
  // сразу на УЗИ, — и вопрос тогда не «есть ли флеболог», а «есть ли кто-то
  // из цепочки». Поэтому никакой отдельной арифметики: врачи всех выбранных
  // специальностей просто становятся одним списком, а правила находок
  // работают над ним как над одной специальностью.
  const group = users.filter(u => professionIdsOf(u).some(p => selected.includes(p)));
  const excluded = new Set(exclude
    ? exclude.map(String)
    : selected.flatMap(p => settings.excluded[p] || []));

  // Эталон имеет смысл, только когда есть кому его покрывать. Врач обеих
  // специальностей (в МИС это обычно: у флеболога Кузина УЗИ стоит второй
  // специальностью) считается только эталоном и себя не покрывает: вопрос
  // режима — «будет ли кому отправить пациента», а сам врач в эти часы занят
  // своим приёмом. Иначе любой такой врач гасил бы все находки разом.
  let anchorSets = null;
  const anchorId = anchor && selected.includes(String(anchor)) && selected.length > 1 ? String(anchor) : null;
  if (anchorId) {
    const active = group.filter(u => !excluded.has(String(u.id)));
    const ids = (pred) => new Set(active.filter(pred).map(u => String(u.id)));
    anchorSets = {
      lead: ids(u => professionIdsOf(u).includes(anchorId)),
      cover: ids(u => !professionIdsOf(u).includes(anchorId) && professionIdsOf(u).some(p => selected.includes(p))),
    };
  }

  const records = group.length
    ? await fetchPeriods(from, to, group.map(u => String(u.id)))
    : [];

  const clinicsByKey = new Map();
  const keyByMisId = new Map();
  for (const misId of new Set(records.map(r => String(r.clinic_id)))) {
    const { canonical, mc, virtual, ...entry } = await clinicEntry(misId);
    keyByMisId.set(misId, entry.key);
    if (!clinicsByKey.has(entry.key)) clinicsByKey.set(entry.key, { ...entry, ...clinicHours(mc, canonical) });
  }
  const clinics = [...clinicsByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));

  const minGapSafe = Math.max(15, Math.min(24 * 60, Number(minGap) || 60));
  const report = cov.buildReport({
    days,
    records,
    excluded,
    anchor: anchorSets,
    clinics,
    clinicKeyOf: (id) => keyByMisId.get(String(id)) ?? null,
    windowOf: windowResolver(clinicsByKey, custom),
    minGap: minGapSafe,
  });

  // Врачи группы: сколько смен за период и в каких медцентрах. Медцентры по
  // сменам, а не по карточке — рядом с фамилией логотип того филиала, где он
  // на деле принимает. Без смен — либо уволен и не удалён, либо график ещё не
  // составлен; интерфейс их приглушает.
  const shiftsByUser = {};
  for (const r of records) {
    if (Number(r.type) !== 1) continue;
    const id = String(r.user_id);
    const key = keyByMisId.get(String(r.clinic_id));
    const u = (shiftsByUser[id] ||= { shifts: 0, byClinic: {} });
    u.shifts++;
    u.byClinic[key] = (u.byClinic[key] || 0) + 1;
  }
  const rank = (u, p) => (p === anchorId ? 2 : 0) + ((u.profession || []).map(String).includes(p) ? 1 : 0);
  const doctors = group
    .map(u => {
      const s = shiftsByUser[String(u.id)];
      return {
        id: String(u.id),
        name: u.name,
        shifts: s?.shifts || 0,
        clinics: s ? Object.keys(s.byClinic).sort((a, b) => s.byClinic[b] - s.byClinic[a]) : [],
        excluded: excluded.has(String(u.id)),
        // Выбранные специальности врача: эталонная первой (эталоном он и
        // считается), затем основная — по первой подпись и цвет дорожки
        professions: [...new Set(professionIdsOf(u))]
          .filter(p => selected.includes(p))
          .sort((a, b) => rank(u, b) - rank(u, a)),
      };
    })
    .sort((a, b) => (b.shifts > 0) - (a.shifts > 0) || a.name.localeCompare(b.name, 'ru'));

  return {
    from,
    to,
    days,
    professionIds: selected,
    anchor: anchorId,
    professions: selected.map(id => ({ id, name: professionNames.get(id) || `#${id}` })),
    minGap: minGapSafe,
    window: custom ? { from: custom[0], to: custom[1] } : null,
    clinics: clinics.map(({ sortOrder, ...c }) => c),
    doctors,
    ...report,
  };
}

/**
 * Шаблоны выбора (ver. 9.20): «флеболог Альфы + УЗИ», «гинекологи без
 * совместителей». Личные, как и сами галочки, — лежат в settings пользователя,
 * чтобы ехать за ним с компьютера на компьютер, а не жить в одном браузере.
 */
const MAX_PRESETS = 40;

function readPresets(user) {
  const list = user?.settings?.scheduleCoverage?.presets;
  return Array.isArray(list) ? list : [];
}

function normalizePreset(p) {
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))].slice(0, 500);
  const professionIds = ids(p?.professionIds).slice(0, 30);
  if (!professionIds.length) throw new TypeError('В шаблоне нет ни одной специальности');
  const excluded = {};
  for (const pid of professionIds) excluded[pid] = ids(p?.excluded?.[pid]);
  const anchor = p?.anchor && professionIds.includes(String(p.anchor)) ? String(p.anchor) : null;
  return {
    id: String(p?.id || '').slice(0, 40) || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(p?.name || '').trim().slice(0, 120) || 'Без названия',
    professionIds,
    excluded,
    anchor,
  };
}

async function savePresets(user, list) {
  if (!Array.isArray(list)) throw new TypeError('Нужен список шаблонов');
  if (list.length > MAX_PRESETS) throw new TypeError(`Шаблонов не больше ${MAX_PRESETS}`);
  const presets = list.map(normalizePreset);
  const settings = user.settings || {};
  // Новый объект целиком: JSONB, изменённый на месте, Sequelize не замечает
  await user.update({ settings: { ...settings, scheduleCoverage: { ...(settings.scheduleCoverage || {}), presets } } });
  return presets;
}

module.exports = { listProfessions, getReport, readPresets, savePresets, MAX_DAYS };
