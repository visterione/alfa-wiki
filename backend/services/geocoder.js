'use strict';

/**
 * Адрес точки конкурента → координаты, для карты клиник.
 *
 * Через Nominatim (OpenStreetMap): ключей не требует, платы тоже, а карта
 * в вики и так рисуется тайлами OSM — брать координаты из другого источника
 * значило бы ловить расхождения между подложкой и метками.
 *
 * Условия использования Nominatim жёсткие: не больше запроса в секунду и
 * осмысленный User-Agent. Отсюда очередь с паузой и никакой параллельности.
 * Полсотни адресов геокодируются около минуты — операция разовая, результат
 * ложится в базу навсегда.
 *
 * Формат запроса подобран на живых адресах зеркала, и он неочевиден:
 *
 *   «Краснодар, улица Кожевенная, 44»  — 1 попадание из 8
 *   «улица Кожевенная, 44»             — 10 из 15
 *   «улица Кожевенная, 44, Краснодар»  — вытягивает ещё половину остатка
 *
 * То есть город впереди адреса ломает разбор, а в конце — помогает. Поэтому
 * спрашиваем дважды: сначала с городом в конце, потом без города вовсе.
 *
 * И главное — ответу верим не на слово. Геокодер охотно отдаёт уверенное
 * «нашёл» на совершенно другой посёлок: «улица Московская, 79/6, Краснодар»
 * приводит в станицу Бесскорбную за двести километров. Поэтому город из
 * ответа сверяется с ожидаемым, и при расхождении точка помечается как
 * требующая проверки, а не молча ставится куда попало.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Требование Nominatim: не чаще раза в секунду. Берём с запасом.
const DELAY_MS = 1100;

// Своё имя и контакт — обязательны по их правилам, анонимных банят
const USER_AGENT = 'alfa-wiki/1.0 (competitor price map; stecenko.work@gmail.com)';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Сокращения в человеческий вид.
 *
 * ВАЖНО: границу слова \b здесь использовать нельзя — в JS она определена
 * по [A-Za-z0-9_], и с кириллицей не срабатывает вовсе. Опираемся на начало
 * строки и разделители явно.
 */
const ABBREVIATIONS = [
  [/(^|[\s,])ул\.?\s*/gi, '$1улица '],
  [/(^|[\s,])(пр-?кт|пр-?т|просп)\.?\s*/gi, '$1проспект '],
  [/(^|[\s,])ш\.\s*/gi, '$1шоссе '],
  [/(^|[\s,])пер\.\s*/gi, '$1переулок '],
  [/(^|[\s,])наб\.\s*/gi, '$1набережная '],
  [/(^|[\s,])б-?р\.?\s*/gi, '$1бульвар '],
  [/(^|[\s,])мкр\.?\s*/gi, '$1микрорайон '],
  [/(^|[\s,])пл\.\s*/gi, '$1площадь '],
  // «д. 55» — служебное слово, геокодеру мешает; «им.» тоже лишнее
  [/(^|[\s,])д\.\s*(?=\d)/gi, '$1'],
  [/(^|[\s,])им\.\s*/gi, '$1'],
  [/(^|[\s,])г\.\s*/gi, '$1'],
  // корпуса и помещения до дома всё равно не уточняют
  [/,?\s*корп\.?\s*\d+/gi, ''],
  [/,?\s*стр\.?\s*\d+/gi, ''],
  [/,?\s*пом\.?\s*\d+/gi, '']
];

function normalizeAddress(address) {
  let text = String(address || '');
  for (const [pattern, replacement] of ABBREVIATIONS) text = text.replace(pattern, replacement);
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, '');
}

/** Город в начале адреса — наш же дубль, для запроса он помеха. */
function stripLeadingCity(address, city) {
  if (!city) return address;
  const escaped = String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return address.replace(new RegExp(`^${escaped},?\\s*`, 'i'), '');
}

/** Варианты запроса от точного к грубому. */
function buildQueries({ address, city }) {
  const normalized = normalizeAddress(address);
  if (!normalized) return [];

  const cleanCity = String(city || '').trim();
  const street = stripLeadingCity(normalized, cleanCity);

  const queries = [];
  if (cleanCity) queries.push(`${street}, ${cleanCity}, Россия`);
  queries.push(`${street}, Россия`);
  return [...new Set(queries)];
}

/** Город из ответа геокодера — он лежит в разных полях у разных типов мест. */
function cityFromAnswer(answer) {
  const a = answer?.address || {};
  return a.city || a.town || a.village || a.municipality || a.county || null;
}

/**
 * Совпадает ли найденный город с ожидаемым.
 *
 * Сравниваем по началу слова: геокодер возвращает то «Сочи», то «городской
 * округ Сочи», а «Нижний Новгород» — целиком. Пяти букв хватает, чтобы
 * отличить Краснодар от Красноярска, но не спотыкаться на форме записи.
 */
function citiesMatch(expected, found) {
  if (!expected || !found) return false;
  const a = String(expected).toLowerCase().replace(/ё/g, 'е');
  const b = String(found).toLowerCase().replace(/ё/g, 'е');
  return a.includes(b) || b.includes(a) || b.includes(a.slice(0, 5));
}

async function ask(query) {
  const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=ru&addressdetails=1&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      console.warn(`   ⚠️  геокодер ответил ${res.status} на «${query}»`);
      return null;
    }
    const found = await res.json();
    return Array.isArray(found) && found.length ? found[0] : null;
  } catch (err) {
    console.warn(`   ⚠️  геокодер не ответил на «${query}»: ${err.message}`);
    return null;
  }
}

/**
 * Один адрес.
 *
 * Возвращает { lat, lon, city, matchesCity } либо null. `matchesCity: false`
 * означает «координаты есть, но они, возможно, не от того города» — такую
 * точку нельзя ставить на карту молча.
 */
async function geocodeOne({ address, city }, { pauseBetween = true } = {}) {
  const queries = buildQueries({ address, city });

  for (let i = 0; i < queries.length; i++) {
    if (i > 0 && pauseBetween) await sleep(DELAY_MS);

    const answer = await ask(queries[i]);
    if (!answer) continue;

    const lat = Number(answer.lat);
    const lon = Number(answer.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const foundCity = cityFromAnswer(answer);
    const matchesCity = city ? citiesMatch(city, foundCity) : true;

    // Не совпал город — пробуем следующий, более грубый вариант: вдруг он
    // приведёт куда надо. Если других нет, вернём что есть, но с пометкой.
    if (!matchesCity && i < queries.length - 1) continue;

    return {
      lat,
      lon,
      city: foundCity,
      matchesCity,
      query: queries[i],
      display: answer.display_name || null
    };
  }

  return null;
}

/**
 * Пачка адресов по очереди, с паузой между запросами.
 *
 * onProgress зовётся после каждого адреса — прогон идёт минуту и дольше,
 * и без него интерфейсу нечего показывать.
 */
async function geocodeMany(items, { onProgress = null } = {}) {
  const results = [];

  for (let i = 0; i < items.length; i++) {
    // Пауза перед запросом, а не после: последний адрес не должен задерживать
    // возврат на лишнюю секунду
    if (i > 0) await sleep(DELAY_MS);

    const point = await geocodeOne(items[i]);
    results.push({ item: items[i], point });
    if (onProgress) onProgress({ done: i + 1, total: items.length, point });
  }

  return results;
}

module.exports = {
  normalizeAddress,
  buildQueries,
  citiesMatch,
  geocodeOne,
  geocodeMany,
  DELAY_MS
};
