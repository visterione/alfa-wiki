/**
 * Загрузка в часах от личной нормы.
 *
 * Здесь нет ни одного обращения к базе намеренно: функции принимают уже
 * выбранные события и норму. Это делает расчёт проверяемым без БД и не даёт
 * ему тихо превратиться в место, где ходят запросы за чужими календарями.
 *
 * Главное правило модуля: **наружу отдаются часы и цвет, но не содержание.**
 * Руководитель видит «8,2 из 6,4 ч 🔴», а не то, из чего эти часы сложились.
 * Поэтому расчёт и выборка событий разведены: маршрут «загрузка человека за
 * период» не имеет доступа к названиям в принципе, а не прячет их на выходе.
 */

const { countsAsBusyFor } = require('./visibility');

/** Порог, с которого день считается плотным (жёлтый). */
const TIGHT_RATIO = 0.85;

/** Цвета: g — есть запас, y — плотно, r — переработка, v — отпуск. */
const COLORS = { FREE: 'g', TIGHT: 'y', OVER: 'r', VACATION: 'v' };

/** Длительность события в часах. */
function hoursOf(event) {
  if (!event) return 0;
  const from = new Date(event.startTime).getTime();
  const to = new Date(event.endTime).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return (to - from) / 3600000;
}

/**
 * Занятые часы за день.
 *
 * `viewer` меняет результат, и это не оплошность, а обещание уровня «только я»:
 * для постороннего такое событие не существует и часов не занимает. Иначе в
 * чужом дне оставалась бы необъяснимая разница между суммой видимых блоков и
 * итогом, по которой скрытое дело и восстанавливается.
 *
 * Для самого владельца считаются все события: он планирует свой настоящий день,
 * а не тот, который видят коллеги.
 *
 * Завершённые события из загрузки выпадают: освободившееся время возвращается
 * в свободное сразу, а не в конце дня.
 */
function busyHours(events, viewer) {
  if (!Array.isArray(events)) return 0;
  let sum = 0;
  for (const event of events) {
    if (event.status === 'completed' || event.status === 'cancelled') continue;
    if (!countsAsBusyFor(event, viewer)) continue;
    sum += hoursOf(event);
  }
  return round(sum);
}

/**
 * Загрузка дня целиком.
 *
 * norm === null означает, что человек в модуле не заведён; отпуск передаётся
 * отдельным признаком, потому что это не «ноль часов», а «в этот день задачи
 * не ставятся вовсе».
 */
/**
 * Часы дня: либо считаются из событий, либо берутся готовыми.
 *
 * Готовые нужны там, где день уже посчитан выборкой (loadQuery) и второй раз
 * событий под рукой нет. Раньше такие дни приходили с пустым events, и всё
 * молча помещалось в любой день — ошибка тихая и ровно в том месте, ради
 * которого модуль существует.
 */
function resolveHours(day, viewer) {
  if (typeof day.hours === 'number') return day.hours;
  return busyHours(day.events, viewer);
}

function dayLoad({ events, hours: given, norm, onVacation = false, viewer = null }) {
  if (onVacation) {
    return { hours: null, norm, free: 0, ratio: null, color: COLORS.VACATION, onVacation: true };
  }
  const hours = resolveHours({ events, hours: given }, viewer);
  if (!norm || norm <= 0) {
    return { hours, norm: null, free: 0, ratio: null, color: COLORS.FREE, onVacation: false };
  }
  const ratio = hours / norm;
  return {
    hours,
    norm: round(norm),
    free: round(Math.max(0, norm - hours)),
    ratio: round(ratio),
    color: colorOf(ratio),
    onVacation: false,
  };
}

/**
 * Цвет дня. Переработка начинается строго за нормой: 6,4 из 6,4 — это ещё не
 * красный, потому что норма и есть та граница, до которой день считается
 * нормальным.
 */
function colorOf(ratio) {
  if (ratio > 1) return COLORS.OVER;
  if (ratio >= TIGHT_RATIO) return COLORS.TIGHT;
  return COLORS.FREE;
}

/**
 * Помещается ли оценка в день.
 *
 * Отдельной функцией, потому что от неё зависит развилка при постановке задачи:
 * помещается — задача уходит исполнителю обычным порядком, не помещается —
 * автор обязан выбрать, что изменится.
 */
function fits({ events, hours, norm, estimateHours, onVacation = false, viewer = null }) {
  if (onVacation) return false;
  if (!norm || norm <= 0) return false;
  return resolveHours({ events, hours }, viewer) + estimateHours <= norm + 1e-9;
}

/**
 * Ближайший день, куда оценка помещается.
 *
 * `days` — массив {date, events, norm, onVacation} по возрастанию даты.
 * Возвращается дата или null: «нет окна до конца горизонта» — валидный ответ,
 * и интерфейс обязан его показать, а не подобрать день молча.
 */
function nextFit(days, estimateHours, viewer = null) {
  if (!Array.isArray(days)) return null;
  for (const day of days) {
    if (fits({ ...day, estimateHours, viewer })) return day.date;
  }
  return null;
}

/**
 * Свободное время за период — сумма остатков по дням.
 *
 * Именно сумма остатков, а не «норма × дни минус занятое»: день с переработкой
 * не должен компенсировать соседний свободный. Человек, у которого понедельник
 * перегружен на 3 ч, а пятница пуста, не «в норме за неделю» — у него сломан
 * понедельник.
 */
function freeOverPeriod(days, viewer = null) {
  if (!Array.isArray(days)) return 0;
  let sum = 0;
  for (const day of days) {
    sum += dayLoad({ ...day, viewer }).free;
  }
  return round(sum);
}

/** Дней с переработкой за период. */
function overloadedDays(days, viewer = null) {
  if (!Array.isArray(days)) return 0;
  let count = 0;
  for (const day of days) {
    if (dayLoad({ ...day, viewer }).color === COLORS.OVER) count += 1;
  }
  return count;
}

/**
 * Загрузка команды в процентах от суммы личных норм её участников.
 *
 * От суммы норм, а не от «числа людей × 8 ч»: команда из подрядчиков на
 * part-time иначе выглядела бы вечно недозагруженной, а поддержка со сменным
 * графиком — вечно горящей. Общая цифра на компанию врёт про всех сразу.
 */
function teamLoad(memberDays, viewer = null) {
  let load = 0;
  let capacity = 0;
  let over = 0;
  for (const day of memberDays || []) {
    const result = dayLoad({ ...day, viewer });
    if (result.onVacation || !result.norm) continue;
    load += result.hours;
    capacity += result.norm;
    if (result.color === COLORS.OVER) over += 1;
  }
  return {
    hours: round(load),
    capacity: round(capacity),
    percent: capacity ? Math.round((load / capacity) * 100) : 0,
    freeHours: round(Math.max(0, capacity - load)),
    overloadedDays: over,
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

module.exports = {
  TIGHT_RATIO,
  COLORS,
  hoursOf,
  busyHours,
  resolveHours,
  dayLoad,
  colorOf,
  fits,
  nextFit,
  freeOverPeriod,
  overloadedDays,
  teamLoad,
};
