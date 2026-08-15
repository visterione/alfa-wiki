/**
 * Справочники и даты модуля «Задачи».
 *
 * Подписи статусов обязаны совпадать с вебом (frontend/src/pages/Tasks/utils/
 * labels.js): человек открывает одну и ту же задачу и там, и здесь, и «не
 * обработана» не может называться в мобилке иначе.
 *
 * Даты — строками YYYY-MM-DD, как и на бэкенде. День здесь календарный день
 * сотрудника, а не момент времени: стоит пропустить это через Date с часовым
 * поясом, и задача на понедельник у части людей уедет в воскресенье.
 */

export const STATUS_LABEL = {
  new: 'не обработана',
  plan: 'в плане',
  work: 'в работе',
  review: 'на проверке',
  done: 'готово',
  stuck: 'анализируется',
};

/** Цвет статуса берётся из темы по ключу — см. toneColor. */
export const STATUS_TONE = {
  new: 'warning',
  plan: 'primary',
  work: 'primary',
  review: 'secondary',
  done: 'success',
  stuck: 'error',
};

export const MODE_LABEL = {
  single: 'Один исполнитель',
  shared: 'Одна на всех',
  split: 'Разделена на части',
  mixed: 'Смешанная',
};

/** Цвета загрузки. Ключи приходят с сервера: g/y/r/v/o (выходной). */
export const LOAD_COLOR = {
  g: 'success',
  y: 'warning',
  r: 'error',
  v: 'textTertiary',
  o: 'textTertiary',
};

export const LOAD_TITLE = {
  g: 'есть запас',
  y: 'плотно',
  r: 'переработка',
  v: 'отпуск',
};

export function toneColor(theme, key) {
  return theme[key] || theme.textSecondary;
}

/* ── Даты ─────────────────────────────────────────────────────────────────── */

export const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
export const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Локальная дата в ключ. Именно локальная: toISOString сдвинул бы день. */
export function toKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const fromKey = key => new Date(`${key}T00:00:00`);
export const today = () => toKey(new Date());

export function addDays(key, count) {
  const d = fromKey(key);
  d.setDate(d.getDate() + count);
  return toKey(d);
}

export function addMonths(key, count) {
  const d = fromKey(key);
  d.setMonth(d.getMonth() + count);
  return toKey(d);
}

/** 0 — понедельник. */
export const dow = key => (fromKey(key).getDay() + 6) % 7;
export const isWeekend = key => dow(key) >= 5;

export const weekStart = key => addDays(key, -dow(key));
export const weekOf = key => {
  const start = weekStart(key);
  return Array.from({length: 7}, (_, i) => addDays(start, i));
};

/** Сетка месяца, добитая до целых недель — под 7 колонок. */
export function monthGrid(key) {
  const d = fromKey(key);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const cells = [];
  const lead = (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7;
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let i = 1; i <= last.getDate(); i += 1) {
    cells.push(toKey(new Date(d.getFullYear(), d.getMonth(), i)));
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

export const dstr = key => `${fromKey(key).getDate()} ${MONTHS[fromKey(key).getMonth()]}`;
export const dfull = key => `${DOW[dow(key)]}, ${dstr(key)}`;
export const dshort = key => `${DOW[dow(key)]} ${fromKey(key).getDate()}`;
export const monthTitle = key =>
  `${MONTHS_NOM[fromKey(key).getMonth()]} ${fromKey(key).getFullYear()}`;

/** «6,4 ч» — с запятой, как принято в русском тексте. */
export function hoursText(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(1).replace('.', ',')} ч`;
}

/** «2 ч», «40 мин» — дробные часы в оценках читаются плохо. */
export function estimateText(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.round(h * 60)} мин`;
  if (Number.isInteger(h)) return `${h} ч`;
  return `${h.toFixed(1).replace('.', ',')} ч`;
}

/** Длительность события. У плавающих блоков время начала условное. */
export function eventHours(event) {
  const from = new Date(event.startTime).getTime();
  const to = new Date(event.endTime).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return (to - from) / 3600000;
}

/** События одного дня: жёсткие встречи сверху, плавающие блоки за ними. */
export function dayEvents(events, date) {
  return (events || [])
    .filter(e => String(e.startTime).slice(0, 10) === date)
    .sort((a, b) => {
      if (a.isFloating !== b.isFloating) return a.isFloating ? 1 : -1;
      return String(a.startTime).localeCompare(String(b.startTime));
    });
}

export const userName = user => user?.displayName || user?.username || 'Без имени';
