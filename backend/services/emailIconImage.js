'use strict';

/**
 * Иконка письма — картинкой (ver. 8.53).
 *
 * Почта не показывает SVG: Gmail вырезает его вместе с тегом, Outlook рисует
 * пустоту, а <img src="...svg"> открывается в лучшем случае в одном клиенте из
 * пяти. Поэтому иконка, которую человек выбрал в конструкторе, доезжает до
 * получателя обычным PNG.
 *
 * Рисуем сами и на лету, а не складываем готовые файлы в репозиторий: у одной
 * иконки столько вариантов, сколько сочетаний цвета, подложки и размера, и
 * заранее их не угадать. Каждый нарисованный вариант остаётся на диске — второй
 * раз одна и та же иконка не рисуется, а почтовым клиентам адрес отдаётся с
 * годовым сроком жизни, потому что по этому адресу картинка никогда не меняется
 * (все параметры в самом адресе).
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

const clampSize = (value) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 28;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
};

/**
 * Разбор запроса в набор параметров, из которого получается имя файла.
 *
 * Разбор отдельно от отрисовки, потому что по этим же параметрам собирается
 * адрес на стороне рендерера письма: имя файла обязано совпасть, иначе кэш не
 * попадёт ни разу.
 */
function normalize({ key, size, color, bg } = {}) {
  const name = String(key || '').toLowerCase();
  if (!ICONS[name]) return null;
  return {
    key: name,
    size: clampSize(size),
    color: hex(color, '#1C1C1E'),
    bg: bg ? hex(bg, null) : null,
  };
}

const fileNameOf = (p) => `${p.key}-${p.size}-${p.color.slice(1)}${p.bg ? `-on-${p.bg.slice(1)}` : ''}.png`;

/**
 * SVG иконки в её собственной системе координат 24×24.
 *
 * С подложкой глиф ужимается до 58% и встаёт в середину круга — доля подобрана
 * по тому, как это выглядит у иконок с самым широким контуром (конверт, дом):
 * при 65% они уже упираются в края круга.
 */
function buildSvg(p) {
  const px = p.size * 2;
  const body = ICONS[p.key].body;
  const stroke = `fill="none" stroke="${p.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

  const glyph = p.bg
    ? `<circle cx="12" cy="12" r="12" fill="${p.bg}"/>`
      + `<g transform="translate(5.04 5.04) scale(0.58)" ${stroke}>${body}</g>`
    : `<g ${stroke}>${body}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24">${glyph}</svg>`;
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

/** Адрес иконки в письме. Все параметры в нём — по ним же зовётся iconFile. */
function iconUrl(params, baseUrl = '') {
  const p = normalize(params);
  if (!p) return '';
  const query = `size=${p.size}&color=${p.color.slice(1)}${p.bg ? `&bg=${p.bg.slice(1)}` : ''}`;
  return `${String(baseUrl).replace(/\/+$/, '')}/api/email/icon/${p.key}.png?${query}`;
}

module.exports = { iconFile, iconUrl, normalize, buildSvg, MAX_SIZE };
