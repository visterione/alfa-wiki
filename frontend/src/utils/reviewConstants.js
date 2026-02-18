/**
 * Review Module Constants (Frontend)
 */

// Статусы отзывов (колонки Kanban)
export const REVIEW_STATUSES = [
  { id: 'new', label: 'Новый отзыв', color: '#ef4444' },
  { id: 'in_progress', label: 'В работе', color: '#f97316' },
  { id: 'request_info', label: 'Запрос сведений', color: '#22c55e' },
  { id: 'verification_done', label: 'Проверка завершена', color: '#3b82f6' },
  { id: 'final', label: 'Решение принято', color: '#a855f7' }
];

// Категории решений
export const DECISION_CATEGORIES = [
  { id: 'resolved', label: 'Урегулировано' },
  { id: 'compensation', label: 'Компенсация' },
  { id: 'refund', label: 'Возврат средств' },
  { id: 'clarification', label: 'Разъяснение' },
  { id: 'other', label: 'Другое' }
];

// Бизнес-роли
export const REVIEW_ROLES = [
  { id: 'creator', label: 'Создатель отзывов', description: 'Может создавать новые отзывы' },
  { id: 'negative_handler', label: 'Обработчик негатива', description: 'Работает с негативными отзывами' },
  { id: 'reviewer', label: 'Проверяющий', description: 'Проверяет обработку отзывов' },
  { id: 'publisher', label: 'Публикатор', description: 'Финализирует и публикует решения' }
];

// Типы действий в истории
export const HISTORY_ACTION_LABELS = {
  'created': 'Создан',
  'status_change': 'Изменен статус',
  'comment': 'Комментарий',
  'file_upload': 'Загружен файл',
  'assignment': 'Назначение',
  'finalized': 'Финализирован'
};

// Хелперы
export const getStatusById = (statusId) => {
  return REVIEW_STATUSES.find(s => s.id === statusId);
};

export const getStatusLabel = (statusId) => {
  return getStatusById(statusId)?.label || statusId;
};

export const getStatusColor = (statusId) => {
  return getStatusById(statusId)?.color || '#6b7280';
};

export const isNegativeReview = (rating) => rating <= 3;
export const isPositiveReview = (rating) => rating >= 4;

export const getRatingStars = (rating) => {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
};

export const getCategoryLabel = (categoryId) => {
  return DECISION_CATEGORIES.find(c => c.id === categoryId)?.label || categoryId;
};

export const getRoleLabel = (roleId) => {
  return REVIEW_ROLES.find(r => r.id === roleId)?.label || roleId;
};

// Цвета для ролей доступа
export const ACCESS_ROLE_COLORS = {
  owner: '#10b981',
  editor: '#3b82f6',
  viewer: '#94a3b8'
};

export const ACCESS_ROLE_LABELS = {
  owner: 'Владелец',
  editor: 'Редактор',
  viewer: 'Наблюдатель'
};
