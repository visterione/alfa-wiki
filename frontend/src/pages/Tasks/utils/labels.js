/**
 * Подписи и цвета статусов.
 *
 * Собраны в одном месте, потому что одни и те же состояния встречаются на пяти
 * экранах, и «не обработана» на доске обязана называться так же, как во
 * входящих. Формулировки здесь не косметика: именно они объясняют человеку
 * разницу между «работа идёт» и «до задачи ещё никто не дошёл».
 */

export const STATUS_LABEL = {
  new: 'не обработана',
  plan: 'в плане',
  work: 'в работе',
  review: 'на проверке',
  done: 'готово',
  stuck: 'анализируется',
};

/** Классы-модификаторы для бейджей — см. Tasks.css. */
export const STATUS_TONE = {
  new: 'warn',
  plan: 'info',
  work: 'info',
  review: 'violet',
  done: 'ok',
  stuck: 'bad',
};

/** Колонки доски. Порядок — это путь задачи слева направо. */
export const BOARD_COLUMNS = [
  ['new', 'Не обработано'],
  ['stuck', 'Анализируется'],
  ['work', 'В работе'],
  ['review', 'На проверке'],
  ['done', 'Готово'],
];

export const MODE_LABEL = {
  single: 'Один исполнитель',
  shared: 'Одна на всех',
  split: 'Разделена на части',
  mixed: 'Смешанная',
};

export const MODE_SHORT = {
  shared: 'на всех',
  split: 'по частям',
  mixed: 'смешанная',
};

export const ACCESS_LABEL = {
  all: 'Вся компания',
  members: 'Только участники',
  invite: 'По приглашению',
};

export const TEAM_ROLE_LABEL = {
  member: 'Участник',
  viewer: 'Наблюдатель',
  lead: 'Руководитель команды',
};

/** Уровни видимости личного — с честным описанием последствий каждого. */
export const VISIBILITY_OPTIONS = [
  ['private', 'Только я', 'Слот выглядит свободным — на него будут ставить задачи'],
  ['busy', 'Занято, без названия', 'Коллеги видят полосу и длительность, название — нет'],
  ['team', 'Название видно команде', 'Видно тем, с кем вы состоите в общей команде'],
  ['public', 'Видно всей компании', 'Для отпуска и командировок: от них зависят планы других'],
];

/** Цвет загрузки → класс. Порог жёлтого — 85% нормы, красного — переработка. */
export const LOAD_TONE = { g: 'ok', y: 'warn', r: 'bad', v: 'muted' };

export const LOAD_TITLE = {
  g: 'есть запас',
  y: 'плотно',
  r: 'переработка',
  v: 'отпуск',
};

/** Инициалы для аватарки-заглушки. */
export function initials(user) {
  const name = user?.displayName || user?.username || '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Цвет аватарки выводится из идентификатора, а не хранится.
 *
 * Палитра приглушённая: аватарки стоят рядами по всей таблице загрузки, и
 * насыщенные цвета там перебивают то единственное, что должно бросаться в
 * глаза — красную полосу переработки.
 */
const AVATAR_COLORS = [
  '#7FB3D5', '#7DCEA0', '#F5B041', '#C39BD3', '#76D7C4',
  '#F1948A', '#85C1E9', '#F7DC6F', '#BB8FCE', '#73C6B6',
];

export function avatarColor(id) {
  const key = String(id || '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function userName(user) {
  return user?.displayName || user?.username || 'Без имени';
}
