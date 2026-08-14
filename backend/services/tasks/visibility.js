/**
 * Видимость событий календаря в модуле «Задачи».
 *
 * Единственное место, где решается, что именно уходит наружу. Любая отдача
 * события другому пользователю обязана проходить здесь: маршрут, который
 * собирает ответ сам, рано или поздно вернёт название чужого визита к врачу.
 *
 * Пять уровней. Первые два — личные, и обещание по ним жёсткое:
 *
 *   private — «только я». Событие не отдаётся вовсе. Слот выглядит свободным,
 *             и на него будут ставить задачи: это честная цена уровня, о
 *             которой владельца предупреждают при выборе.
 *   busy    — «занято, без названия». Наружу уходит длительность и сам факт
 *             занятости. Ни названия, ни описания, ни места.
 *   team    — название видно тем, с кем человек состоит в общей команде.
 *   shared  — название видно явному списку sharedWith (механизм календаря,
 *             существовавший до модуля; не тронут).
 *   public  — видно всей компании. Уровень отпуска и командировки: от них
 *             зависит планирование других.
 *
 * **Администратор не является исключением.** Для private и busy обхода нет ни
 * у владельца пространства, ни у администратора филиала — иначе обещание
 * пришлось бы формулировать как «никто, кроме тех, кто захочет». Права админа
 * действуют на уровнях team и shared, то есть на рабочем содержимом, но не на
 * личном.
 *
 * Возвращается всегда простой объект, а не инстанс Sequelize: инстанс несёт
 * dataValues целиком, и достаточно одного JSON.stringify в маршруте, чтобы
 * скрытое поле уехало клиенту мимо этого фильтра.
 */

/** Уровни в порядке возрастания открытости. */
const LEVELS = ['private', 'busy', 'team', 'shared', 'public'];

/** Личные уровни — те, которые не раскрываются никому, кроме владельца. */
const PERSONAL_LEVELS = new Set(['private', 'busy']);

/** Что делать с событием: отдать целиком, обезличить, не отдавать вовсе. */
const FULL = 'full';
const OPAQUE = 'opaque';
const HIDDEN = 'hidden';

/**
 * Поля, которые уходят наружу у обезличенного события. Список белый, а не
 * чёрный: при добавлении нового поля в модель оно по умолчанию не утечёт.
 */
const OPAQUE_FIELDS = ['id', 'startTime', 'endTime', 'allDay', 'isFloating', 'dayOrder'];

/**
 * Как поступить с событием при показе конкретному зрителю.
 *
 * @param {object} event   событие календаря
 * @param {object} viewer  {id, isAdmin}
 * @param {Set<string>} teammateIds  с кем зритель состоит в общих командах
 */
function decide(event, viewer, teammateIds = new Set()) {
  if (!event) return HIDDEN;

  const ownerId = event.createdBy;
  // Своё видно всегда и целиком — включая уровень «только я».
  if (ownerId && viewer && ownerId === viewer.id) return FULL;

  const level = LEVELS.includes(event.visibility) ? event.visibility : 'private';

  // Личные уровни: обхода нет ни у кого, включая администратора.
  if (level === 'private') return HIDDEN;
  if (level === 'busy') return OPAQUE;

  if (level === 'public') return FULL;

  // Дальше — рабочее содержимое, здесь права администратора действуют.
  if (viewer && viewer.isAdmin) return FULL;

  if (level === 'shared') {
    const list = Array.isArray(event.sharedWith) ? event.sharedWith : [];
    return viewer && list.includes(viewer.id) ? FULL : OPAQUE;
  }

  // team
  return ownerId && teammateIds.has(ownerId) ? FULL : OPAQUE;
}

/**
 * Событие в том виде, в каком его можно отдать зрителю. null — не отдавать.
 *
 * Обезличенное событие получает признак isOpaque: клиент обязан отличать «есть
 * занятое время, содержание закрыто» от «событие без названия». Первое рисуется
 * серой полосой, второе — ошибка данных.
 */
function redact(event, viewer, teammateIds) {
  const verdict = decide(event, viewer, teammateIds);
  if (verdict === HIDDEN) return null;

  const src = typeof event.get === 'function' ? event.get({ plain: true }) : event;

  if (verdict === FULL) return { ...src, isOpaque: false };

  const out = { isOpaque: true, visibility: 'busy' };
  for (const field of OPAQUE_FIELDS) {
    if (src[field] !== undefined) out[field] = src[field];
  }
  return out;
}

/** То же для списка: скрытые события выпадают, а не превращаются в null. */
function redactAll(events, viewer, teammateIds) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const event of events) {
    const safe = redact(event, viewer, teammateIds);
    if (safe) out.push(safe);
  }
  return out;
}

/**
 * Считается ли событие занятым временем для чужого взгляда.
 *
 * Отдельно от redact, потому что расчёт загрузки не отдаёт содержимого и должен
 * уметь работать быстрее. Логика та же и обязана с ней совпадать: событие с
 * уровнем private для постороннего не существует, а значит и часов не занимает —
 * иначе в чужом дне появлялись бы необъяснимые часы, по которым восстанавливался
 * бы факт скрытого дела.
 */
function countsAsBusyFor(event, viewer) {
  if (!event) return false;
  if (event.createdBy && viewer && event.createdBy === viewer.id) return true;
  const level = LEVELS.includes(event.visibility) ? event.visibility : 'private';
  return level !== 'private';
}

module.exports = {
  LEVELS,
  PERSONAL_LEVELS,
  FULL,
  OPAQUE,
  HIDDEN,
  OPAQUE_FIELDS,
  decide,
  redact,
  redactAll,
  countsAsBusyFor,
};
