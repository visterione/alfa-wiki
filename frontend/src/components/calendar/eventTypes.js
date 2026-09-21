/**
 * Типы событий календаря: название, цвет, способ показать время.
 *
 * Справочник лежал в трёх копиях — на странице календаря, в фильтрах сайдбара
 * и в повестке. Копии успели разойтись: тип «Задача» не был заведён ни в одной
 * из них, и блок запланированной задачи рисовался серым прямоугольником с
 * подписью «task». Чтобы следующий тип не пришлось заводить трижды, справочник
 * один, а копии импортируют его.
 */

import { estimateText } from '../../pages/Tasks/utils/dates';

export const EVENT_TYPES = {
  personal: { label: 'Личное', color: '#4a90e2' },
  meeting: { label: 'Встреча', color: '#10b981' },
  deadline: { label: 'Дедлайн', color: '#ef4444' },
  reminder: { label: 'Напоминание', color: '#f59e0b' },
  // Блок запланированной задачи. Фиолетовый — тот же, которым модуль «Задачи»
  // помечает себя в интерфейсе, чтобы человек узнавал источник блока без
  // подписи.
  task: { label: 'Задача', color: 'var(--secondary)' },
  accreditation: { label: 'Аккредитация', color: '#ef4444' },
  vehicle_service: { label: 'ТО транспорта', color: '#f59e0b' },
  doctor_schedule: { label: 'Расписание врача', color: '#8b5cf6' },
};

/** Тип, под которым показывается событие с незнакомым eventType. */
const FALLBACK = EVENT_TYPES.personal;

/**
 * Типы, у которых цвет диктует тип, а не событие.
 *
 * Блок задачи человек не создаёт руками и цвет ему не выбирает — его заводит
 * планировщик модуля «Задачи». Но в модели у поля color стоит умолчание
 * `#4a90e2`, поэтому «цвета нет» у такого блока не бывает: в базе лежит синий
 * от личного события. Просто «своё важнее типа» здесь не работает — тип обязан
 * перебить умолчание.
 */
const TYPE_OWNS_COLOR = new Set(['task']);

export function eventTypeLabel(event) {
  return EVENT_TYPES[event?.eventType]?.label || event?.eventType || FALLBACK.label;
}

/** Цвет события: свой, если человек его выбирал, иначе цвет типа. */
export function eventColor(event) {
  const type = EVENT_TYPES[event?.eventType];
  if (type && TYPE_OWNS_COLOR.has(event.eventType)) return type.color;
  return event?.color || type?.color || FALLBACK.color;
}

/**
 * Фон-подложка того же цвета.
 *
 * Через color-mix, а не приписыванием «20» к hex: цвет типа может быть токеном
 * (`var(--secondary)`), и склейка строк на нём не работает. 13% — это та же
 * прозрачность, что давал прежний суффикс.
 */
export function eventSoftColor(event) {
  return `color-mix(in srgb, ${eventColor(event)} 13%, transparent)`;
}

/**
 * Заголовок события. У блока задачи впереди её код (РЕМ-42, РЕМ-42/2 у части):
 * названия частей коротки и похожи друг на друга, и без кода в списке дня не
 * видно, к какой задаче относится блок. Код приходит с сервера.
 */
export function eventTitle(event) {
  return event?.taskCode ? `${event.taskCode} · ${event.title}` : event?.title;
}

const hhmm = (value) => new Date(value).toLocaleTimeString('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Что писать во времени события.
 *
 * У блока задачи времени начала нет: часы ему проставлены условно, подряд от
 * начала смены, — так их хранит планировщик модуля «Задачи», и сам модуль их
 * не показывает. Календарь тоже не должен: «09:00» человек прочитает как
 * договорённость, которой не было. Вместо часов — длительность.
 */
export function eventTimeText(event, { range = false } = {}) {
  if (event?.isFloating) {
    const hours = (new Date(event.endTime) - new Date(event.startTime)) / 3600000;
    return estimateText(hours);
  }
  return range ? `${hhmm(event.startTime)} – ${hhmm(event.endTime)}` : hhmm(event.startTime);
}
