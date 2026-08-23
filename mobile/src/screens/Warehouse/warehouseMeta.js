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

/** Подпись кабинета одинаково во всех списках: номер плюс название, если оно есть. */
export const roomText = room => (room
  ? `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}`
  : '—');

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
      groupKey,
      groupTitle,
      where: groupTitle || mc.name,
    });

    for (const building of mc.buildings || []) {
      for (const floor of building.floors || []) {
        const title = [building.name, floor.name || `${floor.number} этаж`]
          .filter(Boolean).join(' · ');
        for (const room of floor.rooms || []) push(room, `f${floor.id}`, title);
      }
    }
    // Кабинеты, не привязанные к этажу, идут последними: их единицы, и наверху
    // они разрывали бы порядок обхода здания.
    for (const room of mc.rooms || []) push(room, `mc${mc.id}`, 'Без этажа');
  }
  return out;
}

/**
 * Совпадение кабинета со строкой поиска: и по номеру, и по названию.
 *
 * Название приводится к строке здесь, а не у вызывающих: кабинеты приходят и
 * разобранными через flattenRooms (там имя уже нормализовано), и прямо из
 * дерева локаций, где оно может быть null.
 */
export const roomMatches = (room, needle) => !needle
  || String(room.number).toLowerCase().includes(needle)
  || String(room.name || '').toLowerCase().includes(needle);
