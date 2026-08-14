/**
 * Выборка загрузки: часы и цвет по людям и дням.
 *
 * Отдельный файл, потому что у него есть свойство, которое нужно защищать:
 * **он не умеет возвращать содержание событий.** Из базы берутся только поля,
 * нужные для арифметики, и наружу уходят числа. Маршрут «загрузка команды»
 * физически не может проговориться — не потому, что аккуратно написан, а
 * потому что названия в нём нет.
 *
 * Отпуск — событие с типом vacation. Это единственный вид личного, который по
 * умолчанию виден всем: от чужого отпуска зависит планирование, и прятать его
 * значит расставлять задачи на людей, которых нет.
 */

const { Op } = require('sequelize');
const { CalendarEvent, User } = require('../../models');
const workload = require('./workload');

const VACATION_TYPE = 'vacation';

/** Поля, которые вообще выбираются из календаря. Названия здесь нет намеренно. */
const LOAD_FIELDS = ['id', 'createdBy', 'startTime', 'endTime', 'visibility', 'status', 'eventType', 'isFloating'];

/** Дни периода в виде YYYY-MM-DD. */
function daysBetween(start, end) {
  const out = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor <= last) {
    out.push(toKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function toKey(date) {
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Загрузка по людям и дням.
 *
 * @param {string[]} userIds  чьи дни считаем — область видимости определяется
 *                            вызывающим, здесь она не перепроверяется
 * @param {object}   viewer   {id, isAdmin} — от него зависит, считается ли
 *                            личное «только я» (у чужого взгляда не считается)
 * @returns {Map<string, Map<string, object>>}  userId → дата → результат dayLoad
 */
async function loadMatrix(userIds, start, end, viewer) {
  const ids = [...new Set(userIds || [])].filter(Boolean);
  const result = new Map();
  if (!ids.length) return result;

  const [events, users] = await Promise.all([
    CalendarEvent.findAll({
      attributes: LOAD_FIELDS,
      where: {
        createdBy: { [Op.in]: ids },
        startTime: { [Op.lte]: new Date(`${end}T23:59:59`) },
        endTime: { [Op.gte]: new Date(`${start}T00:00:00`) },
      },
      raw: true,
    }),
    User.findAll({ attributes: ['id', 'dailyNormHours'], where: { id: { [Op.in]: ids } }, raw: true }),
  ]);

  const norms = new Map(users.map(u => [u.id, u.dailyNormHours === null ? null : Number(u.dailyNormHours)]));
  const days = daysBetween(start, end);

  // Раскладываем события по владельцу и дню один раз: иначе на каждую клетку
  // таблицы пришёлся бы проход по всему массиву, а таблица — это люди × дни.
  const byUserDay = new Map();
  const vacations = new Set();
  for (const event of events) {
    const key = `${event.createdBy}|${toKey(event.startTime)}`;
    if (event.eventType === VACATION_TYPE) {
      vacations.add(key);
      continue;
    }
    if (!byUserDay.has(key)) byUserDay.set(key, []);
    byUserDay.get(key).push(event);
  }

  for (const userId of ids) {
    const perDay = new Map();
    for (const date of days) {
      const key = `${userId}|${date}`;
      perDay.set(date, workload.dayLoad({
        events: byUserDay.get(key) || [],
        norm: norms.get(userId) ?? null,
        onVacation: vacations.has(key),
        viewer,
      }));
    }
    result.set(userId, perDay);
  }
  return result;
}

/** Плоский вид для ответа маршрута: [{userId, days: [{date, hours, norm, color, free}]}]. */
function toRows(matrix) {
  const rows = [];
  for (const [userId, perDay] of matrix) {
    rows.push({
      userId,
      days: [...perDay].map(([date, load]) => ({
        date,
        hours: load.hours,
        norm: load.norm,
        free: load.free,
        color: load.color,
        onVacation: load.onVacation,
      })),
    });
  }
  return rows;
}

/** Дни одного человека в форме, которую ждут workload.nextFit и freeOverPeriod. */
async function daysOf(userId, start, end, viewer) {
  const matrix = await loadMatrix([userId], start, end, viewer);
  const perDay = matrix.get(userId) || new Map();
  return [...perDay].map(([date, load]) => ({
    date,
    hours: load.hours,
    norm: load.norm,
    free: load.free,
    color: load.color,
    onVacation: load.onVacation,
  }));
}

module.exports = { VACATION_TYPE, LOAD_FIELDS, daysBetween, toKey, loadMatrix, toRows, daysOf };
