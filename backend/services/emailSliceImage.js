'use strict';

/**
 * Нарезка картинки под «Картинку с кнопкой» (ver. 9.18).
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

module.exports = {
  SCALE,
  parseSource,
  normalizeZone,
  sliceUrl,
  parseRequest,
  sliceFile,
};
