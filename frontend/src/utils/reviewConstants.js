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

// Площадки, где Альфа Парсер отвечает сам (ver. 8.80) — имена справочника.
// СберЗдоровье в справочнике «DocDoc». У ДокТу ответ платный и у сети
// отключён.
const COLLECTOR_REPLY_PLATFORMS = ['ПроДокторов', 'Яндекс Карты', '2ГИС', 'Фламп', 'НаПоправку', 'DocDoc'];

/**
 * Можно ли предложить ответ на площадке. Отвечает только парсер (GetLoyalty
 * отключён в ver. 8.84), поэтому нужен его ключ отзыва. Окончательно решает
 * сервер: если место ещё в режиме сверки, он объяснит, почему нельзя.
 */
export function canReplyOnPlatform(review) {
  return !!review?.sourceKey && COLLECTOR_REPLY_PLATFORMS.includes(review?.platform?.name);
}

// Жалобу из вики принимают ПроДокторов, Яндекс, 2ГИС и ДокТу (ver. 8.85).
// У НаПоправку и СберЗдоровья кнопки жалобы нет даже в их кабинетах. Причины
// окно берёт у сервера, здесь только — активна ли кнопка.
const COMPLAINT_PLATFORMS = ['ПроДокторов', 'Яндекс Карты', '2ГИС', 'Фламп', 'Докту'];

/** Показывать ли кнопку «Пожаловаться» — у любого отзыва, связанного с площадкой. */
export function hasPlatformLink(review) {
  return !!review?.sourceKey;
}

/**
 * Можно ли сейчас пожаловаться. Где нельзя — кнопка остаётся на месте, но
 * неактивна: по просьбе заказчика без окон с объяснениями.
 */
export function canComplainOnPlatform(review) {
  return hasPlatformLink(review)
    && !review?.platformRemovedAt
    && review?.syncMeta?.complaint?.state !== 'sending'
    && COMPLAINT_PLATFORMS.includes(review?.platform?.name);
}

/**
 * Отзыв на самой площадке — как его видит пациент. Парсер кладёт ссылку в
 * syncMeta.direct.url: у ПроДокторов и НаПоправку это сам отзыв, у Яндекса
 * и 2ГИС — отзывы организации (на отдельный отзыв они ссылаться не дают).
 * У архива GetLoyalty — то, что он оставил в externalUrl.
 */
export function reviewPublicUrl(review) {
  const url = review?.syncMeta?.direct?.url || review?.externalUrl;
  return url && /^https?:\/\//.test(url) ? url : null;
}

const REMOVED_REASONS = {
  moderation: 'снят модерацией площадки',
  hidden: 'скрыт площадкой',
  missing: 'удалён с площадки',
};

/** Подпись для отзыва, которого больше нет на площадке, или null. */
export function platformRemovedLabel(review) {
  if (!review?.platformRemovedAt) return null;
  const date = new Date(review.platformRemovedAt).toLocaleDateString('ru-RU');
  return `${REMOVED_REASONS[review.platformRemovedReason] || 'удалён с площадки'} ${date}`;
}

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
  'replied': 'Ответ на площадке',
  'complained': 'Жалоба на площадку',
  'platform_removed': 'Удалён с площадки',
  'platform_restored': 'Снова на площадке'
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
