/**
 * Даты модуля «Задачи».
 *
 * Везде работаем со строками YYYY-MM-DD, а не с Date. Причина простая: день
 * здесь — это календарный день сотрудника, а не момент времени. Как только в
 * расчёт попадает Date, появляется часовой пояс, и задача, поставленная на
 * понедельник, у половины пользователей оказывается в воскресенье.
 *
 * Неделя начинается с понедельника: у нас нет ни одного экрана, где неделя
 * читалась бы с воскресенья.
 */

export const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
export const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Локальная дата в ключ YYYY-MM-DD. Именно локальная: toISOString сдвинет день. */
export function toKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromKey(key) {
  return new Date(`${key}T00:00:00`);
}

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
export function dow(key) {
  return (fromKey(key).getDay() + 6) % 7;
}

export const isWeekend = key => dow(key) >= 5;

export function weekStart(key) {
  return addDays(key, -dow(key));
}

export function weekOf(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Дни месяца плюс добивка до целых недель — для сетки 7 колонок. */
export function monthGrid(key) {
  const d = fromKey(key);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const cells = [];
  const lead = (first.getDay() + 6) % 7;
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let i = 1; i <= last.getDate(); i += 1) {
    cells.push(toKey(new Date(d.getFullYear(), d.getMonth(), i)));
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function monthDays(key) {
  return monthGrid(key).filter(Boolean);
}

/** «13 августа» */
export function dstr(key) {
  const d = fromKey(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** «Чт, 13 августа» */
export function dfull(key) {
  return `${DOW[dow(key)]}, ${dstr(key)}`;
}

/** «Чт 13» — для узких мест вроде заголовков таблицы */
export function dshort(key) {
  return `${DOW[dow(key)]} ${fromKey(key).getDate()}`;
}

/**
 * «чт, 20.08.26» — срок в карточке задачи.
 *
 * День недели здесь не украшение: срок обсуждают словами «давай в четверг», и
 * без него дату приходится сверять с календарём. А полная дата рядом нужна по
 * той же причине, что и в списке: «Чт 20» из соседнего месяца выглядит как
 * ближайший четверг.
 */
export function ddate(key) {
  return `${DOW[dow(key)].toLowerCase()}, ${dnum(key)}`;
}

/**
 * «18.08.26» — срок в списке задач.
 *
 * День недели с числом («Вт 18») хорош в календаре, где вокруг стоит неделя и
 * год очевиден. В плоском списке рядом с задачами разных месяцев такой срок
 * приходится домысливать, а даты через полгода читаются как позавчерашние.
 */
export function dnum(key) {
  const d = fromKey(key);
  const pad = value => String(value).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`;
}

export function monthTitle(key) {
  const d = fromKey(key);
  return `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
}

/** Часы в «6,4 ч» — с запятой, как принято в русском тексте. */
export function hoursText(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(1).replace('.', ',')} ч`;
}

/** Длительность смены в часах. Норма дня всегда равна этому значению. */
export function shiftHours(day) {
  if (!day?.enabled || !/^\d{2}:\d{2}$/.test(day.start || '') || !/^\d{2}:\d{2}$/.test(day.end || '')) return 0;
  const [startHour, startMinute] = day.start.split(':').map(Number);
  const [endHour, endMinute] = day.end.split(':').map(Number);
  return Math.max(0, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60);
}

export function scheduleWeeklyHours(schedule) {
  return Object.values(schedule?.days || {}).reduce((sum, day) => sum + shiftHours(day), 0);
}

/**
 * «04:00», «00:30» — длительность часами и минутами.
 *
 * Для мест, где часы стоят рядом иконкой, а не текстом: в столбце карточек и в
 * плане дня «2,5 ч» и «40 мин» соседними строками не выравниваются и читаются
 * как разные величины, а чч:мм — одна колонка цифр одинаковой ширины.
 */
export function clockText(hours) {
  const minutes = Math.round(Math.max(Number(hours) || 0, 0) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** «2 ч», «40 мин» — для оценок, где дробные часы читаются плохо. */
export function estimateText(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.round(h * 60)} мин`;
  if (Number.isInteger(h)) return `${h} ч`;
  return `${h.toFixed(1).replace('.', ',')} ч`;
}
