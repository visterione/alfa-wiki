'use strict';

/**
 * Сроки шагов считаются в рабочих часах, а не в календарных.
 *
 * «4 часа на создание учётки» в пятницу вечером календарно истекают в субботу
 * ночью, и в понедельник утром задача уже просрочена, хотя никто ничего не
 * нарушал. Поэтому часы отсчитываются только внутри рабочего дня, выходные и
 * праздники пропускаются.
 *
 * Праздники берём из rb_holidays — того же справочника, по которому строится
 * табель. Заводить второй список праздников в проекте, где он уже есть,
 * означало бы гарантированное расхождение к следующему январю.
 */

const { RbHoliday } = require('../../models');

// Рабочий день клиники по умолчанию. Отдельной настройки не заводим: SLA здесь
// — инструмент «не потерять заявку», а не учёт рабочего времени. Если появится
// потребность считать по-разному в разных филиалах, это станет полем медцентра.
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 18;
const HOURS_PER_DAY = DAY_END_HOUR - DAY_START_HOUR;

// Праздники меняются раз в год, а спрашивают их на каждое создание задачи.
const CACHE_TTL_MS = 30 * 60 * 1000;
let cache = { at: 0, dates: new Set() };

async function holidaySet() {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.dates;
  try {
    const rows = await RbHoliday.findAll({ attributes: ['date'], raw: true });
    cache = { at: Date.now(), dates: new Set(rows.map(r => String(r.date))) };
  } catch (error) {
    // Справочник недоступен — считаем по будням. Уронить создание задачи из-за
    // календаря праздников было бы обменом плохого на худшее.
    console.warn('[onboarding/sla] Не удалось прочитать праздники:', error.message);
    cache = { at: Date.now(), dates: new Set() };
  }
  return cache.dates;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWorkingDay(date, holidays) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  return !holidays.has(toDateKey(date));
}

/** Начало следующего рабочего дня. */
function nextWorkingDayStart(date, holidays) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(DAY_START_HOUR, 0, 0, 0);
  while (!isWorkingDay(next, holidays)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Срок через `hours` рабочих часов от `from`.
 *
 * Если отсчёт начинается вне рабочего времени, он переносится на ближайшее
 * рабочее: задача, поставленная в 23:00, получает свои четыре часа с утра, а не
 * задним числом.
 *
 * @param {number} hours Рабочих часов
 * @param {Date}   [from=new Date()]
 * @returns {Promise<Date>}
 */
async function dueAfterWorkingHours(hours, from = new Date()) {
  const holidays = await holidaySet();
  let cursor = new Date(from);

  // Приводим старт к рабочему времени
  if (!isWorkingDay(cursor, holidays) || cursor.getHours() >= DAY_END_HOUR) {
    cursor = nextWorkingDayStart(cursor, holidays);
  } else if (cursor.getHours() < DAY_START_HOUR) {
    cursor.setHours(DAY_START_HOUR, 0, 0, 0);
  }

  let left = Number(hours) || 0;
  // Потолок на случай нелепой конфигурации: без него ошибка в описании шага
  // превратилась бы в бесконечный цикл внутри запроса.
  let guard = 0;

  while (left > 0 && guard++ < 2000) {
    const dayEnd = new Date(cursor);
    dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

    const availableHours = (dayEnd - cursor) / 3600000;
    if (left <= availableHours) {
      cursor = new Date(cursor.getTime() + left * 3600000);
      left = 0;
      break;
    }

    left -= availableHours;
    cursor = nextWorkingDayStart(cursor, holidays);
  }

  return cursor;
}

/** Сколько рабочих часов просрочки — для эскалации и подсветки на доске. */
async function overdueWorkingHours(dueAt, now = new Date()) {
  if (!dueAt || now <= dueAt) return 0;
  const holidays = await holidaySet();

  let cursor = new Date(dueAt);
  let hours = 0;
  let guard = 0;

  while (cursor < now && guard++ < 2000) {
    if (!isWorkingDay(cursor, holidays) || cursor.getHours() >= DAY_END_HOUR) {
      cursor = nextWorkingDayStart(cursor, holidays);
      continue;
    }
    if (cursor.getHours() < DAY_START_HOUR) {
      cursor.setHours(DAY_START_HOUR, 0, 0, 0);
      continue;
    }

    const dayEnd = new Date(cursor);
    dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);
    const until = now < dayEnd ? now : dayEnd;
    hours += (until - cursor) / 3600000;
    cursor = until >= dayEnd ? nextWorkingDayStart(cursor, holidays) : new Date(now);
  }

  return Math.round(hours * 10) / 10;
}

module.exports = {
  dueAfterWorkingHours,
  overdueWorkingHours,
  HOURS_PER_DAY,
  DAY_START_HOUR,
  DAY_END_HOUR,
  // Экспортируется только для тестов: они должны проверять расчёт, не заводя
  // строк в справочнике праздников.
  _internals: { isWorkingDay, nextWorkingDayStart, toDateKey }
};
