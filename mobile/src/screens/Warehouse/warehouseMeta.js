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
