/**
 * Справочники и работа с датами для календаря.
 *
 * Значения (ключи типов, приоритетов, статусов и цвета по умолчанию) обязаны
 * совпадать с вебом и с валидацией на сервере (backend/routes/calendar.js):
 * события общие, и одно и то же событие открывают и там, и здесь.
 */

export const EVENT_TYPES = {
  personal: {label: 'Личное', color: '#4a90e2'},
  meeting: {label: 'Встреча', color: '#10b981'},
  deadline: {label: 'Дедлайн', color: '#ef4444'},
  reminder: {label: 'Напоминание', color: '#f59e0b'},
  accreditation: {label: 'Аккредитация', color: '#ef4444'},
  vehicle_service: {label: 'ТО транспорта', color: '#f59e0b'},
  doctor_schedule: {label: 'Расписание врача', color: '#8b5cf6'},
};

// Типы, которые можно выбрать руками. Остальные приезжают из других разделов
// (аккредитации, транспорт, расписание врачей) и создаются не здесь.
export const EDITABLE_TYPES = ['personal', 'meeting', 'deadline', 'reminder'];

export const PRIORITIES = {
  low: {label: 'Низкий', color: '#94a3b8'},
  medium: {label: 'Средний', color: '#3b82f6'},
  high: {label: 'Высокий', color: '#f59e0b'},
  urgent: {label: 'Срочный', color: '#ef4444'},
};

export const STATUSES = {
  planned: {label: 'Запланировано'},
  in_progress: {label: 'В процессе'},
  completed: {label: 'Завершено'},
  cancelled: {label: 'Отменено'},
};

export const VISIBILITY = {
  private: {label: 'Только я', hint: 'Для коллег этот слот выглядит свободным'},
  busy: {label: 'Занято, без названия', hint: 'Видны время и длительность, содержание скрыто'},
  team: {label: 'Название видно команде', hint: 'Видно участникам ваших общих команд'},
  shared: {label: 'Избранным', hint: 'Видно выбранным сотрудникам'},
  public: {label: 'Видно всей компании', hint: 'Подходит для отпуска и командировок'},
};

export const FREQUENCIES = {
  daily: {label: 'Ежедневно'},
  weekly: {label: 'Еженедельно'},
  monthly: {label: 'Ежемесячно'},
  yearly: {label: 'Ежегодно'},
};

// Готовые интервалы напоминаний. Свои значения в минутах сервер тоже примет,
// но на телефоне список кнопок удобнее поля ввода.
export const REMINDER_PRESETS = [
  {minutes: 5, label: 'за 5 мин'},
  {minutes: 15, label: 'за 15 мин'},
  {minutes: 30, label: 'за 30 мин'},
  {minutes: 60, label: 'за час'},
  {minutes: 180, label: 'за 3 часа'},
  {minutes: 1440, label: 'за день'},
  {minutes: 10080, label: 'за неделю'},
];

export const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function eventColor(event) {
  return event?.color || EVENT_TYPES[event?.eventType]?.color || EVENT_TYPES.personal.color;
}

export function typeLabel(eventType) {
  return EVENT_TYPES[eventType]?.label || 'Событие';
}

/** Ключ дня в местном времени. toISOString() не годится: он переводит в UTC и
 *  вечерние события уезжают на соседний день. */
export function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addMonths(date, delta) {
  const d = new Date(date);
  // Сначала первое число: иначе 31 марта минус месяц даст 3 марта
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return d;
}

/**
 * Шесть недель, начиная с понедельника, накрывающие весь месяц.
 * Шесть — всегда: сетка постоянной высоты не прыгает при листании.
 */
export function monthGrid(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  // getDay(): 0 — воскресенье, а неделя у нас начинается с понедельника
  const shift = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - shift);

  const weeks = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function formatTime(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDayTitle(date) {
  const d = new Date(date);
  const today = new Date();
  if (sameDay(d, today)) return 'Сегодня';
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (sameDay(d, tomorrow)) return 'Завтра';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Вчера';
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`;
}

export function formatDateTime(date) {
  const d = new Date(date);
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}, ${formatTime(d)}`;
}

/** Человеческая подпись к напоминанию: 15 → «за 15 мин», 1440 → «за день». */
export function reminderLabel(minutes) {
  const preset = REMINDER_PRESETS.find(p => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes % 1440 === 0) return `за ${minutes / 1440} дн.`;
  if (minutes % 60 === 0) return `за ${minutes / 60} ч`;
  return `за ${minutes} мин`;
}

/**
 * Событие целиком попадает в день?
 *
 * Длинные события (с ночёвкой, «весь день» на неделю) должны показываться в
 * каждом дне, который они накрывают, а не только в дне начала.
 */
export function eventOnDay(event, date) {
  const from = startOfDay(date).getTime();
  const to = endOfDay(date).getTime();
  const start = new Date(event.startTime).getTime();
  const end = new Date(event.endTime || event.startTime).getTime();
  return start <= to && end >= from;
}
