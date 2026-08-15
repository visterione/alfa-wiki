/** Недельное рабочее расписание модуля «Задачи». */

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function minutes(value) {
  if (!TIME_RE.test(String(value || ''))) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function shiftHours(day) {
  if (!day?.enabled) return 0;
  const from = minutes(day.start);
  const to = minutes(day.end);
  return from === null || to === null || to <= from ? 0 : round((to - from) / 60);
}

function normalizeSchedule(value) {
  if (value === null || value === undefined) return null;
  const source = value.days || value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Расписание должно содержать дни недели');
  }
  const days = {};
  for (const key of DAY_KEYS) {
    const day = source[key] || {};
    if (!day.enabled) {
      days[key] = { enabled: false };
      continue;
    }
    const start = String(day.start || '');
    const end = String(day.end || '');
    const from = minutes(start);
    const to = minutes(end);
    if (from === null || to === null || to <= from) {
      throw new Error(`${DAY_LABELS[key]}: укажите корректное начало и конец смены`);
    }
    days[key] = { enabled: true, start, end };
  }
  if (!DAY_KEYS.some(key => days[key].enabled)) throw new Error('Выберите хотя бы один рабочий день');
  return { days };
}

function keyForDate(date) {
  const jsDay = new Date(`${String(date).slice(0, 10)}T12:00:00`).getDay();
  return DAY_KEYS[(jsDay + 6) % 7];
}

function forDate(value, date) {
  if (!value) return { isWorking: false, start: null, end: null, norm: null };
  const day = (value.days || value)[keyForDate(date)] || {};
  if (!day.enabled) return { isWorking: false, start: null, end: null, norm: 0 };
  return { isWorking: true, start: day.start, end: day.end, norm: shiftHours(day) };
}

function weeklyHours(value) {
  if (!value) return 0;
  const days = value.days || value;
  return round(DAY_KEYS.reduce((sum, key) => sum + shiftHours(days[key]), 0));
}

function fromDailyNorm(norm) {
  const n = Number(norm);
  if (!Number.isFinite(n) || n <= 0) return null;
  const durationMinutes = Math.round(Math.min(n, 9) * 60);
  const endMinutes = 9 * 60 + durationMinutes;
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  return { days: Object.fromEntries(DAY_KEYS.map((key, index) => [key,
    index < 5 ? { enabled: true, start: '09:00', end } : { enabled: false },
  ])) };
}

function round(value) { return Math.round(value * 100) / 100; }

module.exports = { DAY_KEYS, DAY_LABELS, normalizeSchedule, keyForDate, forDate, shiftHours, weeklyHours, fromDailyNorm };
