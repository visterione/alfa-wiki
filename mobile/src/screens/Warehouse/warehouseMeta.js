/**
 * Общие обозначения складского модуля в мобилке.
 *
 * Вынесено отдельно, потому что статус актива показывают четыре экрана из семи,
 * и разъехавшиеся подписи («В ремонте» против «Ремонт») читались бы как разные
 * состояния. Формулировки те же, что в вебе, — человек ходит и туда, и сюда.
 */

export const ASSET_STATUS = {
  in_use: 'В работе',
  maintenance: 'На техобслуживании',
  repair: 'В ремонте',
  storage: 'На хранении',
  reserved: 'Зарезервировано',
  written_off: 'Списано',
};

/** Цвет статуса берётся из палитры темы, поэтому функция, а не таблица. */
export const statusColor = (c, status) => ({
  in_use: c.success,
  maintenance: c.warning,
  repair: c.error,
  storage: c.textSecondary,
  reserved: c.info,
  written_off: c.textTertiary,
}[status] || c.textSecondary);

export const INVENTORY_STATUS = {
  open: 'Открыта',
  counting: 'Идёт пересчёт',
  closed: 'Закрыта',
  cancelled: 'Отменена',
};

/**
 * Количество без хвоста нулей у штук.
 *
 * В ведомости лежат и метры портьеры, и миллилитры спирта, поэтому дробные
 * значения нужны. Но «14,000 шт» на узком экране читается как ошибка ввода.
 */
export const qtyText = value => {
  const n = Number(value || 0);
  return n % 1 === 0
    ? n.toLocaleString('ru-RU')
    : n.toLocaleString('ru-RU', {maximumFractionDigits: 3});
};

export const moneyText = value =>
  `${Number(value || 0).toLocaleString('ru-RU', {maximumFractionDigits: 0})} ₽`;

export const dateText = value =>
  (value ? new Date(value).toLocaleDateString('ru-RU') : '—');

/**
 * Область описи одной строкой: «Каб. 305, 307 и ещё 3» либо название отделения.
 *
 * Номера, а не полные пути: в строке списка помещается три-четыре, и различают
 * описи как раз номера. Общая функция, потому что область читают три места —
 * список описей, шапка пересчёта и веб, — и разные формулировки выглядели бы как
 * разные описи.
 */
export const inventoryScopeText = (session) => {
  const rooms = session?.rooms?.length
    ? session.rooms
    : (session?.room ? [session.room] : []);
  if (rooms.length > 3) {
    return `Каб. ${rooms.slice(0, 3).map(r => r.number).join(', ')} и ещё ${rooms.length - 3}`;
  }
  if (rooms.length) return `Каб. ${rooms.map(r => r.number).join(', ')}`;
  return session?.department?.name || 'вся сеть';
};

/**
 * Подпись места одинаково во всех списках: у кабинета номер плюс название, у
 * склада — одно название (ver. 7.47). Без второго правила везде, где строку
 * собирают из номера, получалось бы «Каб. Склад».
 */
export const roomText = (room) => {
  if (!room) return '—';
  if (room.isService) return room.name || room.number;
  return `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}`;
};

/**
 * Дерево локаций → плоский список кабинетов.
 *
 * Вложенные списки на телефоне читаются хуже, чем один столбец с подписями
 * уровней, и выбирают в нём всё равно кабинет, а не корпус. Общая функция,
 * потому что кабинет выбирают три экрана — размещение, этикетки и открытие
 * описи, — и разъехавшиеся подписи выглядели бы как разные списки.
 *
 * Группа (groupKey/groupTitle) сохраняется, потому что этикетки на двери
 * отмечают целым этажом: без неё пришлось бы собирать этажи обратно из строк.
 */
export function flattenRooms(tree) {
  const out = [];
  for (const mc of tree?.medCenters || []) {
    const push = (room, groupKey, groupTitle) => out.push({
      id: room.id,
      number: room.number,
      name: room.name || '',
      label: roomText(room),
      hasStorage: Boolean((room.storages || []).length),
      // Места хранения нужны там, где имущество кладут на полку: заведение
      // позиции и приход требуют storageId, а отдельной ручки под него нет
      storages: room.storages || [],
      medCenterId: mc.id,
      medCenterName: mc.name,
      // Отделение кабинета: по нему опись по отделению понимает, какие кабинеты
      // она накрывает, — иначе с телефона нельзя было бы показать, что кабинет
      // уже пересчитывают в рамках описи всего отделения.
      departmentId: room.departmentId || null,
      groupKey,
      groupTitle,
      where: groupTitle || mc.name,
    });

    // Этажи медцентра плоским списком (ver. 7.48). Разбор старого ответа с
    // корпусами оставлен запасным путём: сборка может оказаться новее сервера.
    const floors = mc.floors?.length
      ? mc.floors
      : (mc.buildings || []).flatMap(b => b.floors || []);
    for (const floor of floors) {
      const title = floor.name || `${floor.number} этаж`;
      for (const room of floor.rooms || []) push(room, `f${floor.id}`, title);
    }
    // Кабинеты, не привязанные к этажу, идут последними: их единицы, и наверху
    // они разрывали бы порядок обхода здания.
    for (const room of mc.rooms || []) push(room, `mc${mc.id}`, 'Без этажа');
    // Склады — своей группой в самом низу: они не часть обхода здания, но
    // выбирать их приходится там же, где кабинеты (ver. 7.47).
    for (const room of mc.services || []) push(room, `svc${mc.id}`, 'Склады');
  }
  return out;
}

/**
 * Поиск по названиям — тем же правилом, что и на сервере
 * (backend/services/warehouse/search.js).
 *
 * Запрос дробится на слова, и строка подходит, когда КАЖДОЕ слово нашлось хоть
 * в одном из полей, в любом порядке: в названиях из 1С слова стоят как придётся
 * («Блок системный HP»), а набирают их тоже как придётся. «ё» и «е» не
 * различаются — в одной ведомости соседствуют «Ёмкость» и «Емкость», и
 * набравший одно не находил другого.
 */
const normalizeSearch = value => String(value || '').toLowerCase().replace(/ё/g, 'е');

export function matchesSearch(q, values) {
  const all = normalizeSearch(q).split(/[\s,;]+/).filter(Boolean);
  // Односимвольные слова отбрасываем — они не сужают поиск, — но если после
  // отсева не осталось ничего, берём что дали: «3» это номер кабинета, а не
  // «показать всё».
  const long = all.filter(w => w.length >= 2);
  const words = long.length ? long : all;
  if (!words.length) return true;
  const hay = normalizeSearch(values.filter(Boolean).join(' '));
  return words.every(word => hay.includes(word));
}

/**
 * Совпадение кабинета со строкой поиска: и по номеру, и по названию.
 *
 * Название приводится к строке здесь, а не у вызывающих: кабинеты приходят и
 * разобранными через flattenRooms (там имя уже нормализовано), и прямо из
 * дерева локаций, где оно может быть null.
 */
export const roomMatches = (room, needle) => matchesSearch(needle, [room.number, room.name]);
