'use strict';

/**
 * Виджет связи для сайтов клиник (ver. 8.06).
 *
 * Кнопка в углу сайта, из которой человек попадает в наш Telegram-бот, в MAX
 * или звонит в регистратуру. До сих пор это делал Битрикс, и каждая правка —
 * убрать канал, поменять цвет, сменить номер — была правкой чужой системы.
 * Теперь настройка живёт здесь, а на сайте стоит один неизменный тег <script>.
 *
 * ПОЧЕМУ ЛОГИКА ВЫНЕСЕНА ИЗ МАРШРУТА. Всё, что здесь есть, — это проверка
 * значений, которые попадут на чужую страницу. Ошибка тут стоит дороже обычной:
 * ссылка канала подставляется в href на сайте клиники, и `javascript:` в ней
 * означала бы выполнение нашего кода в origin клиники руками администратора
 * вики. Такое место должно быть покрыто тестами, а маршрут с базой тестами не
 * покроешь — отсюда отдельный модуль без единого обращения к БД.
 *
 * ЧТО ВИДИТ УЛИЦА. Наружу отдаётся только publicView: набор включённых каналов,
 * цвет и подписи. Ни идентификатора филиала, ни списка разрешённых адресов, ни
 * внутреннего названия виджета там нет — ключ виджета лежит открыто в коде
 * чужого сайта, и считать его секретом нельзя.
 */

const crypto = require('crypto');

// Канал — это способ связи, а не мессенджер: телефон здесь равноправен.
const CHANNEL_TYPES = ['telegram', 'max', 'phone'];

const CHANNEL_TITLES = {
  telegram: 'Telegram',
  max: 'MAX',
  phone: 'Позвонить'
};

// Больше шести кнопок в углу экрана телефона не помещается, и список из них
// перестаёт быть выбором.
const MAX_CHANNELS = 6;

// Заголовок и приветствие в окошке не показываются (ver. 8.08, решение
// заказчика: шапка съедала место, а список каналов говорит сам за себя).
// Из настройки они не убраны намеренно: title остаётся подписью окна для
// экранных дикторов, а вернуть шапку — это правка вида, а не данных.
const DEFAULT_APPEARANCE = {
  color: '#2f6fed',
  position: 'right',
  bottomOffset: 24,
  title: 'Связаться с нами',
  greeting: '',
  buttonLabel: 'Написать нам'
};

class WidgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WidgetError';
  }
}

/**
 * Ключ виджета. Не секрет — он лежит в открытом коде сайта, — но и не должен
 * подбираться перебором: по чужому ключу видно, какие каналы у соседней клиники
 * и по какому номеру звонят её пациенты.
 */
function generateKey() {
  return `w${crypto.randomBytes(9).toString('hex')}`;
}

/**
 * Ссылка канала. Разрешён только https: адрес уходит в href на чужой странице,
 * и любая другая схема там — способ выполнить код на сайте клиники.
 */
function safeUrl(raw, what) {
  const value = String(raw || '').trim();
  if (!value) throw new WidgetError(`Не указана ссылка канала «${what}»`);
  if (value.length > 300) throw new WidgetError(`Слишком длинная ссылка канала «${what}»`);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new WidgetError(`Ссылка канала «${what}» не похожа на адрес: ${value}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new WidgetError(`Ссылка канала «${what}» должна начинаться с https://`);
  }
  return parsed.toString();
}

/**
 * Номер для набора. Хранится в наборном виде (+7900…), а красиво разбивает его
 * уже сам виджет: на кнопке нужен один вид, в href tel: — другой.
 */
function normalizePhone(raw) {
  const value = String(raw || '').trim();
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 5 || digits.length > 15) {
    throw new WidgetError(`«${value}» не похоже на телефонный номер`);
  }
  // Восьмёрку в начале российского номера приводим к +7: tel: с восьмёркой
  // работает не везде, а из-за границы не работает вовсе.
  const normalized = digits.length === 11 && digits.startsWith('8')
    ? `7${digits.slice(1)}`
    : digits;
  return `+${normalized}`;
}

/**
 * Каналы в том порядке, в каком их выставил администратор: порядок в массиве и
 * есть порядок кнопок. Ошибки не проглатываются — иначе канал молча исчезает с
 * сайта, а в интерфейсе выглядит сохранённым.
 */
function normalizeChannels(raw) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_CHANNELS) {
    throw new WidgetError(`Каналов не больше ${MAX_CHANNELS}`);
  }

  return raw.map((item) => {
    if (!item || !CHANNEL_TYPES.includes(item.type)) {
      throw new WidgetError(`Неизвестный канал «${item && item.type}»`);
    }

    const title = CHANNEL_TITLES[item.type];
    const label = String(item.label || '').trim().slice(0, 60) || title;
    // Вторая строка кнопки. Пустая — значит её нет вовсе: у телефона она чаще
    // всего лишняя, а где-то там пишут часы приёма вместо приглашения.
    const note = String(item.note || '').trim().slice(0, 80);
    const enabled = item.enabled !== false;

    const value = item.type === 'phone'
      ? normalizePhone(item.value)
      : safeUrl(item.value, title);

    return { type: item.type, enabled, label, note, value };
  });
}

function normalizeAppearance(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_APPEARANCE };

  if (source.color !== undefined) {
    const color = String(source.color || '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      throw new WidgetError('Цвет задаётся в виде #rrggbb');
    }
    out.color = color.toLowerCase();
  }

  if (source.position !== undefined) {
    const position = String(source.position || '').trim();
    if (!['right', 'left'].includes(position)) {
      throw new WidgetError('Угол — «right» или «left»');
    }
    out.position = position;
  }

  if (source.bottomOffset !== undefined) {
    // Отступ снизу нужен там, где у сайта своя плашка внизу: без него кнопка
    // ложится поверх кнопки «наверх» или согласия на cookie.
    const offset = Number(source.bottomOffset);
    if (!Number.isFinite(offset) || offset < 0 || offset > 300) {
      throw new WidgetError('Отступ снизу — от 0 до 300 пикселей');
    }
    out.bottomOffset = Math.round(offset);
  }

  for (const [field, limit] of [['title', 60], ['greeting', 200], ['buttonLabel', 30]]) {
    if (source[field] !== undefined) {
      out[field] = String(source[field] || '').trim().slice(0, limit);
    }
  }

  return out;
}

/** Приводит адрес сайта к виду «схема + хост + порт»: сравнивать можно только так. */
function normalizeOrigin(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).origin.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeOrigins(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const origin = normalizeOrigin(item);
    if (!origin) throw new WidgetError(`«${item}» не похоже на адрес сайта`);
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * Пускать ли виджет на этот сайт.
 *
 * Это защита от встраивания нашего виджета на чужую страницу, а НЕ проверка
 * права: заголовок Origin ставит браузер, и запрос не из браузера подставит
 * туда что угодно. Отдаём мы здесь только то, что и так висит на публичном
 * сайте, поэтому большего от списка и не требуется. Пустой список — «где
 * угодно»: у части сайтов адрес меняется чаще, чем до нас доходит эта новость.
 */
function originAllowed(widget, origin) {
  const allowed = Array.isArray(widget.allowedOrigins) ? widget.allowedOrigins : [];
  if (allowed.length === 0) return true;

  const value = normalizeOrigin(origin);
  // Запрос без Origin — не браузер: ни отличить, ни осмысленно отказать.
  if (!value) return true;

  return allowed.some(item => normalizeOrigin(item) === value);
}

/** То, что уезжает на сайт. Всё остальное остаётся внутри. */
function publicView(widget) {
  const appearance = normalizeAppearance(widget.appearance);
  const channels = (Array.isArray(widget.channels) ? widget.channels : [])
    .filter(c => c && c.enabled !== false)
    .map(c => ({ type: c.type, label: c.label, note: c.note || '', value: c.value }));

  return {
    key: widget.key,
    title: appearance.title,
    greeting: appearance.greeting,
    buttonLabel: appearance.buttonLabel,
    color: appearance.color,
    position: appearance.position,
    bottomOffset: appearance.bottomOffset,
    channels,
    // По нему сайт понимает, что настройка сменилась, а мы — что кэш браузера
    // отдал вчерашнее.
    updatedAt: widget.updatedAt ? new Date(widget.updatedAt).toISOString() : null
  };
}

module.exports = {
  CHANNEL_TYPES,
  CHANNEL_TITLES,
  MAX_CHANNELS,
  DEFAULT_APPEARANCE,
  WidgetError,
  generateKey,
  normalizeChannels,
  normalizeAppearance,
  normalizeOrigins,
  normalizeOrigin,
  originAllowed,
  publicView
};
