/**
 * Подписи и форматирование модуля онбординга.
 *
 * Свои, а не импортированные из веба: словари там лежат внутри JSX-компонентов
 * (frontend/src/pages/Onboarding/JournalTab.js, bits.js), общего модуля под них
 * нет, и тащить сюда веб-код всё равно не вышло бы. Но списки обязаны совпадать
 * дословно — журнал одной и той же заявки не должен читаться по-разному на
 * телефоне и в браузере.
 */

// ── Стадии и статусы ────────────────────────────────────────────────────────

/**
 * Цвет бейджа стадии. Берётся из палитры темы (см. theme.js), поэтому
 * принимает её на вход: тот же зелёный в тёмной теме светлее.
 */
export function statusColor(status, c) {
  if (status === 'launched') return c.success;
  if (status === 'submitted' || status === 'revision') return c.warning;
  if (status === 'rejected' || status === 'cancelled') return c.textTertiary;
  return c.primary;
}

// ── Журнал ──────────────────────────────────────────────────────────────────

// Точки красим по смыслу события, а не по типу: человек ищет в журнале «где
// что-то пошло не так», и красное должно бросаться в глаза.
const EVENT_TONE = {
  rejected: 'bad',
  cancelled: 'bad',
  revision: 'warn',
  task_unassigned: 'warn',
  chief_unassigned: 'warn',
  sla_reminded: 'warn',
  sla_escalated: 'bad',
  approved: 'ok',
  launched: 'ok',
  task_completed: 'ok',
  closed_unverified: 'warn',
  mis_created: 'ok',
  services_picked: 'ok',
};

const EVENT_LABELS = {
  created: 'Заявка создана',
  submitted: 'Отправлена на согласование',
  approved: 'Согласована',
  revision: 'Возвращена на доработку',
  rejected: 'Отклонена',
  mis_created: 'Пользователь создан в «Реновации»',
  task_opened: 'Задача поставлена',
  task_claimed: 'Задача взята в работу',
  task_completed: 'Задача закрыта',
  closed_unverified: 'Закрыта без подтверждения из МИС',
  task_unassigned: 'Задача без исполнителя',
  chief_unassigned: 'Не назначен главврач филиала',
  doctor_services_invited: 'Врачу отправлен список услуг',
  services_picked: 'Врач отметил услуги',
  durations_applied: 'Длительности перенесены в настройки врача',
  launched: 'Врач запущен',
  cancelled: 'Процесс отменён',
  medcenter_changed: 'Сменён филиал',
  sla_reminded: 'Напоминание о просрочке',
  sla_escalated: 'Эскалация просрочки',
};

export function eventLabel(action) {
  return EVENT_LABELS[action] || action;
}

export function eventTone(action, c) {
  const tone = EVENT_TONE[action];
  if (tone === 'bad') return c.error;
  if (tone === 'warn') return c.warning;
  if (tone === 'ok') return c.success;
  return c.textTertiary;
}

/** Подробности, ради которых в журнал и заглядывают. */
export function eventDetails(event) {
  const payload = event.payload || {};
  if (event.action === 'revision' && payload.note) return payload.note;
  if (event.action === 'rejected' && payload.reason) return payload.reason;
  if (event.action === 'cancelled' && payload.reason) return payload.reason;
  if (event.action === 'sla_reminded' || event.action === 'sla_escalated') {
    return payload.hours ? `Просрочка ${payload.hours} рабочих часов` : null;
  }
  if (event.action === 'durations_applied' && payload.applied) {
    return `Услуг с изменённой длительностью: ${payload.applied}`;
  }
  if (event.action === 'mis_created' && payload.misUserId) {
    return `doctor_id ${payload.misUserId}`;
  }
  if (event.action === 'doctor_services_invited' && payload.mail === false) {
    return `Письмо не ушло: ${payload.reason || 'причина не указана'}`;
  }
  return null;
}

// ── Даты ────────────────────────────────────────────────────────────────────

export function dateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function timeOf(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return dateTime(value);
  return date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
}

export function dateRu(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});
}

export function dayLabel(date) {
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Сегодня';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Вчера';

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/** Срок задачи: до какого числа либо на сколько рабочих часов просрочена. */
export function dueText(task) {
  if (!task.dueAt) return '';
  if (task.overdue) return `просрочка ${task.overdueHours} ч`;
  return dateTime(task.dueAt);
}

/** События по дням: внутри дня важно время, между днями — сам факт перерыва. */
export function groupByDay(events) {
  const days = new Map();
  for (const event of events) {
    const date = new Date(event.createdAt);
    const key = Number.isNaN(date.getTime())
      ? 'unknown'
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!days.has(key)) days.set(key, {key, label: dayLabel(date), items: []});
    days.get(key).items.push(event);
  }
  return [...days.values()];
}

// ── Значения полей анкеты ───────────────────────────────────────────────────

export function professionsText(list) {
  return (list || []).map(p => p.name).join(', ') || '—';
}

// Копия formatPhone из frontend/src/pages/Anketa/fields.js: телефон в базе
// лежит цифрами, и без разбивки читается как одно длинное число
export function formatPhone(digits) {
  const value = String(digits || '').replace(/\D/g, '').slice(0, 11);
  if (!value) return '';
  const rest = value.startsWith('7') || value.startsWith('8') ? value.slice(1) : value;
  const parts = [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6, 8), rest.slice(8, 10)];
  let out = '+7';
  if (parts[0]) out += ` (${parts[0]}`;
  if (parts[0].length === 3) out += ')';
  if (parts[1]) out += ` ${parts[1]}`;
  if (parts[2]) out += `-${parts[2]}`;
  if (parts[3]) out += `-${parts[3]}`;
  return out;
}

// Сокращения, а не полные названия: так же, как в вебе (Anketa/fields.js).
// Дни хранятся номерами с единицы, понедельник = 1.
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function weekdaysText(value) {
  if (!Array.isArray(value) || !value.length) return '';
  return value.map(day => DAYS[day - 1]).filter(Boolean).join(', ').toLowerCase();
}

export function timeRangeText(value) {
  if (!value?.from || !value?.to) return '';
  return `${value.from}–${value.to}`;
}

/**
 * Значение поля в виде, пригодном для чтения. Дни недели хранятся номерами, а
 * интервал приёма объектом — печатать их как есть нельзя.
 */
export function fieldText(type, value) {
  if (value === undefined || value === null || value === '') return '';
  if (type === 'weekdays') return weekdaysText(value);
  if (type === 'timerange') return timeRangeText(value);
  if (type === 'phone') return formatPhone(value);
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  return String(value);
}

/**
 * Строка повторяемого блока: слева год (или срок, или подпись), справа суть.
 *
 * У каждого блока свой порядок чтения: у образования год ведёт, у ресурсов —
 * подпись со ссылкой. Общая склейка через « · » давала «2008 · РязГМУ ·
 * Лечебное дело · Рязань» и читалась как список тегов.
 */
export function repeatRow(key, row) {
  if (key === 'education' || key === 'qualification') {
    return {
      lead: row.year || '—',
      title: row.institution,
      tail: [row.specialty, row.city].filter(Boolean).join(' · '),
    };
  }
  if (key === 'certificates') {
    return {lead: `до ${row.validUntil || '—'}`, title: row.specialization, tail: ''};
  }
  if (key === 'papers') {
    return {
      lead: row.year || '—',
      title: row.topic || row.publication,
      tail: row.topic && row.publication ? row.publication : '',
    };
  }
  if (key === 'conferences') {
    return {
      lead: row.year || '—',
      title: row.event,
      tail: [row.place, row.extra].filter(Boolean).join(' · '),
    };
  }
  if (key === 'resources') {
    return {lead: row.label || 'ссылка', title: row.url || '—', tail: '', url: row.url};
  }
  return {lead: '', title: Object.values(row).filter(Boolean).join(' · '), tail: ''};
}

export function withProtocol(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function fileSizeText(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

// Порядок — как в анкете: сначала лицо, потом документы.
export const FILE_KINDS = [
  {key: 'photo', title: 'Портретное фото'},
  {key: 'diploma', title: 'Диплом'},
  {key: 'certificate', title: 'Сертификаты'},
];
