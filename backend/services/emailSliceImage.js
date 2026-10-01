'use strict';

/**
 * Нарезка картинки под «Картинку с кнопкой» (ver. 9.12).
 *
 * ── Зачем резать ─────────────────────────────────────────────────────────────
 *
 * Дизайнер присылает макет письма одной картинкой, и кнопка на нём уже
 * нарисована — в своём месте, своим шрифтом. Настоящую кнопку поверх картинки в
 * письме не положить: Gmail вырезает position, а отрицательные отступы Outlook
 * понимает по-своему. Стирать нарисованную кнопку и ставить нашу рядом тоже не
 * выход: фон в баннере на телефоне масштабируется, а кнопка нет, и она съезжает
 * с того места, которое для неё продумали.
 *
 * Поэтому картинка режется на куски — полоса сверху, средний ряд «слева | кнопка
 * | справа», полоса снизу — и собирается обратно таблицей без зазоров. Ссылку
 * получает только кусок с кнопкой. Все куски задаются долями одной картинки и
 * масштабируются вместе, так что на телефоне зона остаётся ровно на кнопке, а
 * Outlook видит обычные картинки в таблице — это он умеет.
 *
 * ── Почему лениво, по адресу ─────────────────────────────────────────────────
 *
 * Тем же путём, что и иконки (см. emailIconImage.js): рендерер письма только
 * собирает адреса кусков, а режет их маршрут /api/email/slice при первом
 * запросе и дальше отдаёт из кэша на диске. Иначе рендер пришлось бы делать
 * асинхронным ради одного блока, а предпросмотр пересобирается на каждое
 * движение ползунка.
 *
 * ── Почему адрес подписан ────────────────────────────────────────────────────
 *
 * Маршрут открыт без входа: по нему ходит прокси Gmail. У иконок это безопасно,
 * потому что вариантов конечное число. Здесь прямоугольник задаётся четырьмя
 * числами, и открытый маршрут позволил бы кому угодно нарезать любую картинку
 * писем на миллионы кусков и забить диск кэшем. Подпись выдаёт только
 * рендерер, так что нарезать можно ровно то, что стоит в каком-то письме.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const crypto = require('crypto');

const UPLOADS = path.join(__dirname, '..', 'uploads', 'email');
const DIR = path.join(UPLOADS, 'slices');

// Координаты зоны — в десятитысячных долях картинки. Доли, а не пиксели, потому
// что рендерер не знает размера файла (и не должен лезть за ним на диск), а
// десятитысячные — потому что на картинке в 1200px это точнее пикселя.
const SCALE = 10000;

// Зона меньше двух процентов по стороне — это промах мышью, а не кнопка.
const MIN_SIDE = 200;

// Край зоны ближе полупроцента к краю картинки прилипает к нему. Иначе от
// небрежного выделения остаётся полоска в пиксель шириной — лишний кусок,
// лишний запрос и шов, который виден на тёмном фоне.
const SNAP = 50;

const secret = () => process.env.EMAIL_OPTOUT_SECRET || process.env.JWT_SECRET || '';

/**
 * Картинка, которую можно резать: только загруженная через конструктор.
 *
 * Чужой адрес резать нечем — файла на диске нет, а тянуть картинку с чужого
 * сервера по запросу почтового прокси значило бы сделать из портала открытый
 * прокси. Для чужого адреса рендерер откатывается к картинке целиком.
 */
function parseSource(src) {
  const m = String(src || '').trim()
    .match(/^\/uploads\/email\/(\d{4}-\d{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|gif)$/i);
  if (!m) return null;
  return { month: m[1], id: m[2].toLowerCase(), ext: m[3].toLowerCase() };
}

const clampUnit = (v) => Math.min(SCALE, Math.max(0, Math.round(Number(v) * SCALE)));

/**
 * Зона из документа ({ x, y, w, h } долями от 0 до 1) → края в десятитысячных.
 *
 * null — зона не задана или нарисована так, что кнопкой быть не может. Это не
 * ошибка письма: рендерер покажет картинку целиком.
 */
function normalizeZone(zone) {
  if (!zone || typeof zone !== 'object') return null;
  const nums = ['x', 'y', 'w', 'h'].map(k => Number(zone[k]));
  if (nums.some(n => !Number.isFinite(n))) return null;
  const [x, y, w, h] = nums;

  let l = clampUnit(x);
  let t = clampUnit(y);
  let r = clampUnit(x + w);
  let b = clampUnit(y + h);
  if (l < SNAP) l = 0;
  if (t < SNAP) t = 0;
  if (r > SCALE - SNAP) r = SCALE;
  if (b > SCALE - SNAP) b = SCALE;

  if (r - l < MIN_SIDE || b - t < MIN_SIDE) return null;
  return { l, t, r, b };
}

const sign = (source, rect) => crypto
  .createHmac('sha256', secret())
  .update(`slice:${source.month}/${source.id}.${source.ext}:${rect.l}-${rect.t}-${rect.r}-${rect.b}`)
  .digest('hex')
  .slice(0, 20);

function verify(source, rect, signature) {
  const expected = Buffer.from(sign(source, rect));
  const given = Buffer.from(String(signature || ''));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// GIF режется в PNG: куски анимации разъехались бы по кадрам, а первый кадр в
// PNG хотя бы остаётся картинкой, которую видно.
const outExt = (ext) => (ext === 'gif' ? 'png' : ext);

function sliceUrl(source, rect, baseUrl = '') {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}/api/email/slice/${source.month}/${source.id}/${rect.l}-${rect.t}-${rect.r}-${rect.b}.${outExt(source.ext)}?s=${sign(source, rect)}`;
}

/**
 * Разбор адреса куска. Всё, что не прошло проверку, — null, и маршрут отвечает
 * 404, не объясняя, что именно не так.
 */
function parseRequest({ month, id, rect, ext, signature }) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) return null;
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
  const m = String(rect || '').match(/^(\d{1,5})-(\d{1,5})-(\d{1,5})-(\d{1,5})$/);
  if (!m) return null;
  const [l, t, r, b] = m.slice(1).map(Number);
  if ([l, t, r, b].some(n => n > SCALE) || l >= r || t >= b) return null;

  // Исходник ищется по всем трём расширениям: у куска PNG может быть и
  // исходный PNG, и исходный GIF, и в адресе этого не видно.
  const want = String(ext);
  const candidates = want === 'jpg' ? ['jpg'] : want === 'png' ? ['png', 'gif'] : [];
  for (const srcExt of candidates) {
    const source = { month: String(month), id: String(id), ext: srcExt };
    if (verify(source, { l, t, r, b }, signature)) return { source, rect: { l, t, r, b } };
  }
  return null;
}

/**
 * Путь к готовому куску. Режет, если такого ещё не резали.
 *
 * null — исходника нет на диске: письмо старое, картинку удалили. Почтовому
 * клиенту это 404 и пустая рамка, а не ошибка сервера.
 */
async function sliceFile({ source, rect }) {
  const file = path.join(DIR, `${source.month}-${source.id}-${rect.l}-${rect.t}-${rect.r}-${rect.b}.${outExt(source.ext)}`);
  try {
    await fsp.access(file, fs.constants.R_OK);
    return file;
  } catch {
    // Куска нет — режем.
  }

  const original = path.join(UPLOADS, source.month, `${source.id}.${source.ext}`);
  try {
    await fsp.access(original, fs.constants.R_OK);
  } catch {
    return null;
  }

  const sharp = require('sharp');
  const meta = await sharp(original).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) return null;

  // Края считаются одной и той же формулой для всех кусков. Поэтому соседние
  // куски сходятся без щели и без нахлёста: правый край левого куска и левый
  // край кнопки — одно и то же число.
  const edge = (u, size) => Math.round((u * size) / SCALE);
  const left = edge(rect.l, W);
  const top = edge(rect.t, H);
  const width = Math.max(1, edge(rect.r, W) - left);
  const height = Math.max(1, edge(rect.b, H) - top);

  let pipeline = sharp(original).extract({ left, top, width, height });
  pipeline = outExt(source.ext) === 'jpg'
    ? pipeline.jpeg({ quality: 86, mozjpeg: true })
    : pipeline.png({ compressionLevel: 9 });
  const out = await pipeline.toBuffer();

  await fsp.mkdir(DIR, { recursive: true });
  // Через временное имя, как и иконки: почтовый прокси не должен забрать
  // кусок, дописанный наполовину.
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, out);
  await fsp.rename(tmp, file);
  return file;
}

// ── Фон баннера под размер (ver. 9.13) ───────────────────────────────────────
//
// Баннер кладёт фото фоном ячейки и вписывает его свойством
// background-size:cover. Часть почтовых клиентов этого свойства не знает и
// рисует фон в натуральную величину. Файл у нас хранится шириной 1200px, вдвое
// шире письма, — и в таком клиенте фото выходило вдвое крупнее баннера, с
// обрезанными краями. Outlook тем временем растягивал его VML-рамкой под
// прямоугольник баннера и искажал пропорции.
//
// Лечится тем, что фон режется на сервере ровно по размеру баннера, с той же
// обрезкой по центру, что делает cover. Такой картинке вписываться не нужно:
// в натуральную величину она и есть баннер. Живёт здесь, а не отдельно,
// потому что устроена так же, как куски: лениво по подписанному адресу, с
// кэшем на диске, только для картинок, загруженных в конструктор.

// Потолок размера — двойная ширина письма и с запасом по высоте: вариант для
// телефона делается вдвое крупнее, а баннер выше 700px никто не рисует.
const COVER_MAX = 1400;
const COVER_MIN = 20;

const signCover = (source, w, h) => crypto
  .createHmac('sha256', secret())
  .update(`cover:${source.month}/${source.id}.${source.ext}:${w}x${h}`)
  .digest('hex')
  .slice(0, 20);

function coverUrl(source, w, h, baseUrl = '') {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const W = Math.round(w);
  const H = Math.round(h);
  return `${base}/api/email/cover/${source.month}/${source.id}/${W}x${H}.${outExt(source.ext)}?s=${signCover(source, W, H)}`;
}

function parseCoverRequest({ month, id, size, ext, signature }) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) return null;
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
  const m = String(size || '').match(/^(\d{2,4})x(\d{2,4})$/);
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  if ([w, h].some(n => n < COVER_MIN || n > COVER_MAX)) return null;
  const want = String(ext);
  const candidates = want === 'jpg' ? ['jpg'] : want === 'png' ? ['png', 'gif'] : [];
  for (const srcExt of candidates) {
    const source = { month: String(month), id: String(id), ext: srcExt };
    const expected = Buffer.from(signCover(source, w, h));
    const given = Buffer.from(String(signature || ''));
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return { source, w, h };
  }
  return null;
}

async function coverFile({ source, w, h }) {
  const file = path.join(DIR, `${source.month}-${source.id}-cover-${w}x${h}.${outExt(source.ext)}`);
  try {
    await fsp.access(file, fs.constants.R_OK);
    return file;
  } catch {
    // Не готовили — готовим.
  }
  const original = path.join(UPLOADS, source.month, `${source.id}.${source.ext}`);
  try {
    await fsp.access(original, fs.constants.R_OK);
  } catch {
    return null;
  }

  const sharp = require('sharp');
  // fit: cover с центром — ровно то, что делает background-size:cover с
  // background-position:center. Мелкую картинку растягиваем: иначе в баннере
  // остались бы пустые поля, а cover в браузере её бы растянул точно так же.
  let pipeline = sharp(original).resize({ width: w, height: h, fit: 'cover', position: 'centre' });
  pipeline = outExt(source.ext) === 'jpg'
    ? pipeline.jpeg({ quality: 84, mozjpeg: true, progressive: true })
    : pipeline.png({ compressionLevel: 9 });
  const out = await pipeline.toBuffer();

  await fsp.mkdir(DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, out);
  await fsp.rename(tmp, file);
  return file;
}

module.exports = {
  coverUrl,
  parseCoverRequest,
  coverFile,
  SCALE,
  parseSource,
  normalizeZone,
  sliceUrl,
  parseRequest,
  sliceFile,
};
