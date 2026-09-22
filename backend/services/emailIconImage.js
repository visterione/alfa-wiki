'use strict';

/**
 * Иконка письма — картинкой (ver. 8.53, оформление — 8.54).
 *
 * Почта не показывает SVG: Gmail вырезает его вместе с тегом, Outlook рисует
 * пустоту, а <img src="...svg"> открывается в лучшем случае в одном клиенте из
 * пяти. Поэтому иконка, которую человек выбрал в конструкторе, доезжает до
 * получателя обычным PNG.
 *
 * Рисуем сами и на лету, а не складываем готовые файлы в репозиторий: у одной
 * иконки столько вариантов, сколько сочетаний цвета, подложки, скругления,
 * толщины линии и размера, и заранее их не угадать. Каждый нарисованный вариант
 * остаётся на диске — второй раз одна и та же иконка не рисуется, а почтовым
 * клиентам адрес отдаётся с годовым сроком жизни, потому что по этому адресу
 * картинка никогда не меняется (все параметры лежат в самом адресе).
 *
 * Размер: PNG делается вдвое крупнее, чем иконка стоит в письме. На экране с
 * двойной плотностью — а это любой телефон — картинка ровно по размеру выглядит
 * замыленной.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { ICONS } = require('./emailIcons');

const DIR = path.join(__dirname, '..', 'uploads', 'email', 'icons');

// Потолок размера: иконка крупнее 128px в письме — это уже картинка, и для неё
// в блоке есть отдельное поле.
const MAX_SIZE = 128;
const MIN_SIZE = 12;

/** Цвет из адреса: только шестнадцатеричный, без решётки и без вольностей. */
const hex = (value, fallback) => {
  const v = String(value || '').replace(/^#/, '').trim();
  return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : fallback;
};

/**
 * Число из адреса в заданной вилке. Всё, что не число, — это умолчание.
 *
 * Пустота проверяется отдельно и до Number: `Number(null)` и `Number('')` дают
 * ноль, а не NaN, и незаданное скругление превращалось в нулевое — круглая
 * подложка молча становилась квадратной, а незаданная толщина линии падала до
 * самой тонкой. Пустой параметр в адресе (`?radius=`) — это «не задано», а не
 * «ноль».
 */
const clamp = (value, min, max, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
};

/**
 * Разбор запроса в набор параметров, из которого получается имя файла.
 *
 * Разбор отдельно от отрисовки, потому что по этим же параметрам собирается
 * адрес на стороне рендерера письма: имя файла обязано совпасть, иначе кэш не
 * попадёт ни разу.
 */
function normalize({ key, size, color, bg, radius, scale, stroke } = {}) {
  const name = String(key || '').toLowerCase();
  if (!ICONS[name]) return null;
  const badge = bg ? hex(bg, null) : null;
  return {
    key: name,
    size: clamp(size, MIN_SIZE, MAX_SIZE, 28),
    color: hex(color, '#1C1C1E'),
    bg: badge,
    // Скругление подложки — доля половины стороны: 50% это круг, 0% квадрат,
    // между ними скруглённый квадрат. Одной настройкой вместо выбора формы:
    // список из трёх кнопок закрывает три случая, ползунок — все.
    radius: clamp(radius, 0, 50, 50),
    // Сколько места в подложке занимает сама иконка. Без подложки ужимать
    // нечего — глиф и есть картинка целиком.
    scale: badge ? clamp(scale, 30, 100, 58) : 100,
    stroke: clamp(stroke, 0.5, 4, 2),
  };
}

const num = (n) => String(n).replace('.', '_');

/**
 * Имя файла на диске.
 *
 * Оно же ключ кэша, поэтому в него входит всё, что влияет на картинку. Ничего,
 * что пришло из адреса, сюда не попадает напрямую: имя проверено по набору,
 * цвета — по шестнадцатеричному виду, числа зажаты в вилки.
 */
const fileNameOf = (p) => [
  p.key,
  p.size,
  p.color.slice(1),
  p.bg ? `on-${p.bg.slice(1)}-r${num(p.radius)}-s${num(p.scale)}` : '',
  `w${num(p.stroke)}`,
].filter(Boolean).join('-') + '.png';

/**
 * SVG иконки в её собственной системе координат 24×24.
 *
 * Толщина линии не пересчитывается под ужатый глиф намеренно: иконка в
 * подложке рисуется в своих пропорциях и линии у неё тоньше — так же, как у
 * любой иконки меньшего размера. Кому нужно иначе, поднимает толщину полем.
 */
function buildSvg(p) {
  const px = p.size * 2;
  const body = ICONS[p.key];
  const stroke = `fill="none" stroke="${p.color}" stroke-width="${p.stroke}" stroke-linecap="round" stroke-linejoin="round"`;

  if (!p.bg) return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24"><g ${stroke}>${body}</g></svg>`;

  const k = p.scale / 100;
  const offset = Math.round(((24 - 24 * k) / 2) * 1000) / 1000;
  const r = Math.round((12 * p.radius / 50) * 1000) / 1000;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24">`
    + `<rect x="0" y="0" width="24" height="24" rx="${r}" ry="${r}" fill="${p.bg}"/>`
    + `<g transform="translate(${offset} ${offset}) scale(${k})" ${stroke}>${body}</g>`
    + '</svg>';
}

/**
 * Путь к готовому PNG. Рисует, если такого ещё не рисовали.
 *
 * Возвращает null для неизвестной иконки: это не ошибка сервера, а ссылка на
 * иконку, которой в наборе больше нет, — письмо от этого падать не должно.
 */
async function iconFile(params) {
  const p = normalize(params);
  if (!p) return null;

  const file = path.join(DIR, fileNameOf(p));
  try {
    await fsp.access(file, fs.constants.R_OK);
    return file;
  } catch {
    // Файла нет — рисуем.
  }

  const sharp = require('sharp');
  await fsp.mkdir(DIR, { recursive: true });
  const png = await sharp(Buffer.from(buildSvg(p))).png({ compressionLevel: 9 }).toBuffer();

  // Пишем через временное имя: два письма могут собираться одновременно, и
  // почтовый клиент не должен успеть забрать файл, дописанный наполовину.
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, png);
  await fsp.rename(tmp, file);
  return file;
}

/**
 * Адрес иконки в письме.
 *
 * Умолчания в адрес не попадают: письмо на пять пунктов и так несёт пять
 * ссылок, а Gmail обрезает всё тяжелее 102 КБ. Разбор на той стороне подставит
 * ровно те же значения, поэтому имя файла от этого не меняется.
 */
function iconUrl(params, baseUrl = '') {
  const p = normalize(params);
  if (!p) return '';
  const q = [`size=${p.size}`, `color=${p.color.slice(1)}`];
  if (p.bg) {
    q.push(`bg=${p.bg.slice(1)}`);
    if (p.radius !== 50) q.push(`radius=${p.radius}`);
    if (p.scale !== 58) q.push(`scale=${p.scale}`);
  }
  if (p.stroke !== 2) q.push(`stroke=${p.stroke}`);
  return `${String(baseUrl).replace(/\/+$/, '')}/api/email/icon/${p.key}.png?${q.join('&')}`;
}

module.exports = { iconFile, iconUrl, normalize, buildSvg, fileNameOf, MAX_SIZE };
