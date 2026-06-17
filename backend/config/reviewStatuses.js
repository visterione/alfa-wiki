/**
 * Review Module Constants
 * Статусы, категории решений и роли для модуля отзывов
 */

// Статусы отзывов (порядок соответствует колонкам Kanban)
const REVIEW_STATUSES = [
  { id: 'new', label: 'Новый отзыв', color: '#6366f1' },
  { id: 'in_progress', label: 'В работе', color: '#f59e0b' },
  { id: 'request_info', label: 'Запрос сведений', color: '#ec4899' },
  { id: 'verification_done', label: 'Проверка завершена', color: '#14b8a6' },
  { id: 'final', label: 'Решение принято', color: '#10b981' }
];

// Допустимые переходы между статусами
const VALID_STATUS_TRANSITIONS = {
  'new': ['in_progress'],
  'in_progress': ['request_info', 'verification_done'],
  'request_info': ['in_progress', 'verification_done'],
  'verification_done': ['in_progress', 'final'],
  'final': [] // Из финального статуса нельзя перейти
};

// Категории решений (для финализации)
const DECISION_CATEGORIES = [
  { id: 'resolved', label: 'Урегулировано' },
  { id: 'compensation', label: 'Компенсация' },
  { id: 'refund', label: 'Возврат средств' },
  { id: 'clarification', label: 'Разъяснение' },
  { id: 'other', label: 'Другое' }
];

// Бизнес-роли на доске
const REVIEW_ROLES = [
  { id: 'creator', label: 'Создатель отзывов', description: 'Может создавать новые отзывы' },
  { id: 'negative_handler', label: 'Обработчик негатива', description: 'Работает с негативными отзывами' },
  { id: 'reviewer', label: 'Проверяющий', description: 'Проверяет обработку отзывов' },
  { id: 'publisher', label: 'Публикатор', description: 'Финализирует и публикует решения' }
];

// Типы действий в истории
const HISTORY_ACTIONS = {
  CREATED: 'created',
  STATUS_CHANGE: 'status_change',
  COMMENT: 'comment',
  FILE_UPLOAD: 'file_upload',
  ASSIGNMENT: 'assignment',
  FINALIZED: 'finalized',
  REPLIED: 'replied'
};

// Получить статус по ID
const getStatusById = (statusId) => {
  return REVIEW_STATUSES.find(s => s.id === statusId);
};

// Проверить допустимость перехода
const isValidTransition = (fromStatus, toStatus) => {
  const allowed = VALID_STATUS_TRANSITIONS[fromStatus];
  return allowed && allowed.includes(toStatus);
};

// Проверить является ли отзыв негативным (оценка 1-3)
const isNegativeReview = (rating) => {
  return rating <= 3;
};

// Проверить является ли отзыв позитивным (оценка 4-5)
const isPositiveReview = (rating) => {
  return rating >= 4;
};

module.exports = {
  REVIEW_STATUSES,
  VALID_STATUS_TRANSITIONS,
  DECISION_CATEGORIES,
  REVIEW_ROLES,
  HISTORY_ACTIONS,
  getStatusById,
  isValidTransition,
  isNegativeReview,
  isPositiveReview
};
