/**
 * Общие обозначения модуля отзывов в мобилке.
 *
 * Статусы и категории повторяют backend/config/reviewStatuses.js слово в слово.
 * Дублирование сознательное: отдельной ручки со справочником нет, а тянуть его
 * при каждом открытии карточки ради пяти строк, которые не менялись с запуска
 * модуля, значило бы платить запросом за константу. Если статусы поменяются,
 * менять придётся в двух местах — и это оговорено здесь, чтобы не выяснилось на
 * экране с пустой подписью.
 */

export const REVIEW_STATUSES = [
  {id: 'new', label: 'Новый', color: '#6366f1'},
  {id: 'in_progress', label: 'В работе', color: '#f59e0b'},
  {id: 'request_info', label: 'Запрос сведений', color: '#ec4899'},
  {id: 'verification_done', label: 'Проверка', color: '#14b8a6'},
  {id: 'final', label: 'Решение', color: '#10b981'},
];

/** Допустимые переходы — те же, что проверяет сервер. */
export const NEXT_STATUSES = {
  new: ['in_progress'],
  in_progress: ['request_info', 'verification_done'],
  request_info: ['in_progress', 'verification_done'],
  verification_done: ['in_progress', 'final'],
  final: [],
};

export const statusOf = id => REVIEW_STATUSES.find(s => s.id === id) || null;
export const statusLabel = id => statusOf(id)?.label || id;
export const statusColor = id => statusOf(id)?.color || '#8A8A8E';

export const DECISION_CATEGORIES = {
  resolved: 'Урегулировано',
  compensation: 'Компенсация',
  refund: 'Возврат средств',
  clarification: 'Разъяснение',
  other: 'Другое',
};

export const HISTORY_LABELS = {
  created: 'Создан',
  status_change: 'Смена статуса',
  comment: 'Комментарий',
  file_upload: 'Файлы',
  assignment: 'Назначение',
  finalized: 'Решение принято',
  replied: 'Ответ на площадке',
};

/**
 * Негативным считается отзыв на три звезды и ниже — то же правило, что на
 * сервере (isNegativeReview). От него зависит, кого зовут разбираться.
 */
export const isNegative = rating => Number(rating) <= 3;

export const dateText = value =>
  (value ? new Date(value).toLocaleDateString('ru-RU') : '—');

export const dateTimeText = value => (value
  ? new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  : '—');

/**
 * Сколько отзыв стоит на текущем этапе. Не точная разница, а порядок величины:
 * решение «пора вмешаться» принимается по дням, а не по часам.
 */
export function stageAge(since) {
  if (!since) return null;
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
  if (days < 1) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. на этапе`;
  const weeks = Math.floor(days / 7);
  return weeks < 5 ? `${weeks} нед. на этапе` : `${Math.floor(days / 30)} мес. на этапе`;
}
