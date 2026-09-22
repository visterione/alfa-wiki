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

// Площадки, для которых GetLoyalty не поддерживает отправку ответов
export const PLATFORMS_REPLY_UNSUPPORTED = [
  'Докту',
  'Google Maps',
  'DocDoc',
  'Plaso.pro',
  'НаПоправку'
];

// ─── Логотипы площадок ────────────────────────────────────────────────────────
//
// Файлы лежат в frontend/public/platform-logos/ и отдаются как статика — так же,
// как логотипы лабораторий в сравнении цен. Знак площадки узнаётся быстрее
// названия: на доске карточки просматривают по диагонали, и «Яндекс» в строке
// мелких серых подписей теряется, а красный кружок — нет.
//
// Логотипы есть только у площадок, которыми сеть действительно пользуется.
// Остальные (Google Maps, Фламп, Зун) остаются просто названием: рисовать
// знак ради одного-двух отзывов в год незачем, и отсутствие файла — не ошибка.
// Чтобы добавить площадку, положите PNG рядом с остальными и впишите строку.
const PLATFORM_LOGOS = {
  'яндекс карты': 'yandex.png',
  '2гис':         '2gis.png',
  'продокторов':  'prodoctorov.png',
  'docdoc':       'docdoc.png',
  'напоправку':   'napopravku.png',
  'докту':        'doctu.png'
};

// Ключ ищется по нормализованному названию: регистр, лишние пробелы и точки
// значения не имеют. Точки — из-за старых написаний вроде «Яндекс.Карты»,
// которые ещё встречаются в справочнике отдельных досок.
const platformLogoKey = (name) => (name || '').toLowerCase().replace(/[.\s]+/g, ' ').trim();

export const getPlatformLogo = (name) => {
  const file = PLATFORM_LOGOS[platformLogoKey(name)];
  return file ? `${process.env.PUBLIC_URL || ''}/platform-logos/${file}` : null;
};

// Типы действий в истории
export const HISTORY_ACTION_LABELS = {
  'created': 'Создан',
  'status_change': 'Изменен статус',
  'comment': 'Комментарий',
  'file_upload': 'Загружен файл',
  'assignment': 'Назначение',
  'finalized': 'Финализирован',
  'replied': 'Ответ на площадке'
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

// ─── Длительность этапа / таймеры ─────────────────────────────────────────────

/**
 * Человекочитаемая длительность между двумя моментами.
 * Возвращает компактную строку: «5 мин», «3 ч 20 мин», «2 дн 4 ч».
 */
export const formatDuration = (fromDate, toDate = Date.now()) => {
  if (!fromDate) return '—';
  const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
  if (isNaN(ms) || ms < 0) return '—';

  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} мин`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const mins = totalMinutes % 60;
    return mins ? `${totalHours} ч ${mins} мин` : `${totalHours} ч`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days} дн ${hours} ч` : `${days} дн`;
};

/** Человекочитаемая длительность из миллисекунд (для статистики). */
export const formatMsDuration = (ms) => {
  if (ms == null || isNaN(ms)) return '—';
  return formatDuration(new Date(0), new Date(ms));
};

/**
 * Уровень «застоя» отзыва на этапе по времени в текущем статусе.
 * Возвращает { level, color, label } — для подсветки таймера на карточке.
 * Пороги подобраны под рабочий цикл обработки отзыва.
 */
export const getStageUrgency = (stageEnteredAt, now = Date.now()) => {
  const hours = (new Date(now).getTime() - new Date(stageEnteredAt).getTime()) / 3600000;
  if (hours >= 72) return { level: 'critical', color: '#ef4444', label: 'Долгий застой' };
  if (hours >= 24) return { level: 'warning', color: '#f59e0b', label: 'Требует внимания' };
  return { level: 'fresh', color: '#10b981', label: 'В норме' };
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
