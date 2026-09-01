'use strict';

/**
 * Рабочие чаты, в которые врача зовут после запуска.
 *
 * До ver. 7.64 ссылки на групповые чаты кидали руками: кто вспомнил — тот и
 * кинул, и раз за разом врач оказывался не в том чате, а иногда и ни в одном.
 * Теперь список настраивается по филиалам и уходит одним письмом, когда закрыт
 * последний шаг чек-листа.
 *
 * Голые ссылки вида «t.me/+AbCdEf» в письме от незнакомого адресата человек
 * открывать не станет, и правильно сделает. Поэтому у каждой строки в письме
 * есть название чата, аватарка и кнопка «Вступить»: видно, куда именно ведёт
 * ссылка, ещё до нажатия.
 *
 * Превью забирается со страницы приглашения (og-теги) в момент настройки, а не
 * при отправке письма. Причина: страница может не ответить, и тогда письмо
 * ушло бы с голыми ссылками ровно в тот момент, когда его читают. Здесь же
 * скачивается и аватарка — телеграмовский CDN отдаёт её по временному адресу,
 * который через месяц перестанет открываться прямо в отправленном письме.
 */

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');

const axios = require('axios');
const sharp = require('sharp');
const { Op } = require('sequelize');

const { OnbChatLink } = require('../../models');
const { publicBase } = require('./links');
const chatInvites = require('../chatInvites');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'onboarding-chats');

// Подпапка внутри uploads выбрана вне /uploads/onboarding намеренно: та закрыта
// guard'ом, потому что там сканы диплома. Аватарка чата — публичная картинка,
// и её должен открыть почтовый клиент врача, у которого нет ни сессии, ни
// токена.
const AVATAR_URL_PREFIX = '/uploads/onboarding-chats';

const AVATAR_PX = 160;
const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Телеграм отдаёт страницу с превью только «браузеру»: на пустой или
// библиотечный User-Agent прилетает заглушка со ссылкой на приложение, без
// названия и фотографии группы.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Адрес ──────────────────────────────────────────────────────────────────

/**
 * Приведение и проверка ссылки.
 *
 * Схема только http/https: ссылка уходит в письмо и открывается на чужом
 * устройстве, а «tg://» и «javascript:» там делать нечего.
 */
function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'Укажите ссылку на чат' };

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: 'Это не похоже на ссылку' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Нужна обычная ссылка http или https' };
  }
  return { ok: true, url: parsed.toString(), host: parsed.hostname };
}

/**
 * Защита от запроса во внутреннюю сеть.
 *
 * Ссылку задаёт администратор портала, но за превью ходит сервер — и адрес
 * вроде «http://127.0.0.1:9001/api/...» превратил бы настройку чатов в
 * инструмент чтения внутренних сервисов. Проверяем не имя, а то, во что оно
 * разрешилось: «localtest.me» тоже указывает на 127.0.0.1.
 */
async function isPublicHost(hostname) {
  let addresses;
  try {
    addresses = net.isIP(hostname)
      ? [{ address: hostname }]
      : await dns.lookup(hostname, { all: true });
  } catch {
    return false;
  }
  return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;    // link-local, включая метаданные облака
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const value = address.toLowerCase();
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fe80') || value.startsWith('fc') || value.startsWith('fd')) return true;
  // IPv4, завёрнутый в IPv6 (::ffff:127.0.0.1), — та же внутренняя сеть.
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

// ── Превью ─────────────────────────────────────────────────────────────────

/**
 * Текст страницы с учётом её кодировки.
 *
 * Читаем байтами и декодируем сами: половина русских сайтов до сих пор отдаёт
 * windows-1251, а axios в режиме text считает всё utf-8 — название группы
 * приезжало кракозябрами. Кодировку берём из заголовка, а если её там нет —
 * из <meta charset>, для чего хватает первых килобайт в латинице.
 */
function decodeBody(buffer, contentType) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '');
  const head = buffer.slice(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  const charset = (fromHeader?.[1] || fromMeta?.[1] || 'utf-8').toLowerCase();

  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    // Неизвестное имя кодировки — не повод отказываться от страницы: в utf-8
    // разберётся хотя бы латиница, а название всё равно правится руками.
    return buffer.toString('utf8');
  }
}

function metaContent(html, property) {
  // Порядок атрибутов в разметке не гарантирован: og-тег встречается и как
  // <meta property="og:title" content="…">, и наоборот.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern);
    if (found) return decodeEntities(found[1]).trim();
  }
  return '';
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Ссылка на групповой чат самого портала — «…/chat/join/<токен>».
 *
 * Такую страницу нет смысла читать HTTP-ом: наружу отдаётся SPA без og-тегов,
 * а за именем группы всё равно нужен вход. Зато и ходить никуда не надо —
 * группа лежит в нашей же базе.
 */
function portalInviteToken(url) {
  try {
    const parsed = new URL(url);
    const base = new URL(publicBase());
    if (parsed.host !== base.host) return null;
    const found = parsed.pathname.match(/^\/chat\/join\/([^/]+)\/?$/);
    return found ? decodeURIComponent(found[1]) : null;
  } catch {
    return null;
  }
}

async function portalPreview(url, token) {
  const chat = await chatInvites.findByToken(token);
  if (!chat) {
    // Ссылка выключена или отозвана. Для настраивающего это то же самое, что
    // протухшее приглашение в телеграм: чат сохранится, но врача по нему не
    // позовёт никто.
    return { ok: false, url, error: 'Пригласительная ссылка портала не действует' };
  }
  return {
    ok: true,
    url,
    portal: true,
    title: String(chat.name || 'Групповой чат').slice(0, 255),
    description: '',
    imageUrl: null,
    // Аватар группы уже лежит у нас на диске — качать его по сети незачем.
    localImage: chat.avatar || null
  };
}

/**
 * Читает название, подпись и адрес аватарки со страницы приглашения.
 *
 * Разбираются обычные og-теги, так что годится любой мессенджер, который их
 * отдаёт, а не только телеграм. Отдают, однако, не все и не всегда то: у MAX и
 * VK в og лежит описание самого приложения, а не группы, WhatsApp не отдаёт
 * ничего. Поэтому прочитанное — заготовка: название правится руками, аватарка
 * при желании загружается файлом.
 *
 * Возвращает то, что удалось разобрать, и причину — если нет. Ошибку не бросаем:
 * ссылку всё равно можно сохранить и подписать руками, а превью дочитать позже.
 * Закрытый чат без предпросмотра — обычное дело.
 */
async function fetchPreview(rawUrl) {
  const check = normalizeUrl(rawUrl);
  if (!check.ok) return { ok: false, error: check.error };

  const token = portalInviteToken(check.url);
  if (token) return portalPreview(check.url, token);

  if (!await isPublicHost(check.host)) {
    return { ok: false, url: check.url, error: 'Такой адрес недоступен снаружи' };
  }

  let html;
  try {
    const response = await axios.get(check.url, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 3,
      responseType: 'arraybuffer',
      // Телеграм для несуществующего приглашения отвечает не ошибкой, а
      // страницей «Link expired» с кодом 200, поэтому статус разбираем сами.
      validateStatus: (status) => status >= 200 && status < 400,
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ru,en;q=0.8' }
    });
    html = decodeBody(Buffer.from(response.data), response.headers['content-type']);
  } catch (error) {
    return { ok: false, url: check.url, error: shortReason(error) };
  }

  const title = metaContent(html, 'og:title');
  const description = metaContent(html, 'og:description');
  const image = metaContent(html, 'og:image');

  if (!title) {
    return { ok: false, url: check.url, error: 'Страница чата не показала название' };
  }

  return {
    ok: true,
    url: check.url,
    title: title.slice(0, 255),
    // В телеграме og:description — это описание группы, а его пишут не всегда и
    // не для новичков. В подпись оно попадает только как заготовка, которую
    // администратор поправит на «Чат регистратуры вашего филиала».
    description: description.slice(0, 255),
    // og:image сплошь и рядом относительный («/s/img/og-logo.png» у MAX) —
    // достраиваем до полного адреса, иначе картинка молча не скачается.
    imageUrl: image ? absoluteImage(image, check.url) : null
  };
}

function absoluteImage(image, pageUrl) {
  try {
    return new URL(image, pageUrl).toString();
  } catch {
    return null;
  }
}

function shortReason(error) {
  if (error.code === 'ECONNABORTED') return 'Страница чата не ответила вовремя';
  if (error.response) return `Страница чата ответила ${error.response.status}`;
  return 'Не удалось открыть страницу чата';
}

/** Скачивает аватарку по адресу из og:image. */
async function downloadAvatar(imageUrl) {
  const check = normalizeUrl(imageUrl);
  if (!check.ok) return null;
  if (!await isPublicHost(check.host)) return null;

  try {
    const response = await axios.get(check.url, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 3,
      responseType: 'arraybuffer',
      maxContentLength: MAX_IMAGE_BYTES,
      headers: { 'User-Agent': BROWSER_UA }
    });

    return saveAvatar(Buffer.from(response.data));
  } catch (error) {
    // Без аватарки письмо остаётся рабочим: вместо неё рисуется кружок с
    // буквой. Ронять сохранение ссылки из-за картинки незачем.
    console.warn('[onboarding/chats] Аватарка не скачалась:', error.message);
    return null;
  }
}

/**
 * Приводит любую картинку к одному виду и кладёт в uploads.
 *
 * Квадрат 160 px в JPEG: в письме аватарка показывается 48×48, но у почты на
 * телефоне плотность вдвое-втрое выше, а WEBP умеют не все клиенты.
 * Прозрачность не нужна — скругление рисует уже письмо.
 */
async function saveAvatar(buffer) {
  const jpeg = await sharp(buffer)
    .resize(AVATAR_PX, AVATAR_PX, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82 })
    .toBuffer();

  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(AVATAR_DIR, filename), jpeg);
  return filename;
}

/**
 * Аватар группы самого портала. Берём копию, а не ссылаемся на файл чата:
 * аватарку группы поменяют или снимут, а письмо к тому моменту уже отправлено,
 * и картинка в нём должна остаться той, что была.
 */
async function copyLocalAvatar(relativePath) {
  try {
    // Путь приходит из нашей же базы («uploads/chat-avatars/…»), но за пределы
    // uploads он выводить не должен ни при каких обстоятельствах.
    const root = path.join(__dirname, '..', '..', 'uploads');
    const full = path.resolve(root, String(relativePath).replace(/^\/?uploads\/?/, ''));
    if (!full.startsWith(root + path.sep)) return null;
    return await saveAvatar(fs.readFileSync(full));
  } catch (error) {
    console.warn('[onboarding/chats] Аватар чата портала не скопировался:', error.message);
    return null;
  }
}

/** Картинка превью: у портального чата с диска, у остальных — из сети. */
async function storeAvatar(preview) {
  if (!preview?.ok) return null;
  if (preview.localImage) return copyLocalAvatar(preview.localImage);
  if (preview.imageUrl) return downloadAvatar(preview.imageUrl);
  return null;
}

function removeAvatar(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(AVATAR_DIR, path.basename(filename)));
  } catch {
    // Файла уже нет — это ровно то состояние, которого мы добивались.
  }
}

/**
 * Забрать превью и сохранить его в строке. Одним куском, потому что нужен в
 * трёх местах: при создании, при правке адреса и по кнопке «обновить».
 */
async function refresh(link, { keepTitle = true } = {}) {
  const preview = await fetchPreview(link.url);

  if (!preview.ok) {
    await link.update({ fetchedAt: new Date(), fetchError: preview.error });
    return link;
  }

  const patch = { fetchedAt: new Date(), fetchError: null };
  // Название, поправленное руками, обновление не затирает: «Альфа | Ресепшн
  // 24/7» из телеграма администратор один раз переписал в «Чат регистратуры»,
  // и возвращать это назад по кнопке «обновить» — вредительство.
  if (!keepTitle || !link.title) patch.title = preview.title;

  const filename = await storeAvatar(preview);
  if (filename) {
    removeAvatar(link.avatarPath);
    patch.avatarPath = filename;
  }

  await link.update(patch);
  return link;
}

// ── Чтение ─────────────────────────────────────────────────────────────────

/**
 * Чаты, которые уходят врачу этого филиала: филиальные плюс сетевые.
 *
 * Именно объединение, а не «филиальные, иначе сетевые», как у исполнителей
 * шагов (assignments.js). Там сетевое назначение — запасной вариант, здесь же
 * общий чат сети и чат филиала нужны оба, и врач должен быть в обоих.
 *
 * Свой филиал идёт первым: с ним человек будет работать каждый день.
 */
async function forMedCenter(medCenterId) {
  const rows = await OnbChatLink.findAll({
    where: {
      isActive: true,
      [Op.or]: [{ medCenterId: medCenterId || null }, { medCenterId: null }]
    },
    order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']]
  });

  const own = rows.filter(row => row.medCenterId);
  const network = rows.filter(row => !row.medCenterId);
  return [...own, ...network].map(toMailItem);
}

function toMailItem(link) {
  return {
    title: link.title,
    subtitle: link.subtitle || '',
    url: link.url,
    // Абсолютный адрес: относительный «/uploads/…» в письме указывает на домен
    // почтового клиента и не откроется никогда.
    avatarUrl: link.avatarPath ? `${publicBase()}${AVATAR_URL_PREFIX}/${link.avatarPath}` : null
  };
}

/** Для экрана настроек: там же нужен путь к картинке и состояние превью. */
function toJson(link) {
  return {
    id: link.id,
    medCenterId: link.medCenterId,
    url: link.url,
    title: link.title,
    subtitle: link.subtitle,
    avatarUrl: link.avatarPath ? `${AVATAR_URL_PREFIX}/${link.avatarPath}` : null,
    sortOrder: link.sortOrder,
    isActive: link.isActive,
    fetchedAt: link.fetchedAt,
    fetchError: link.fetchError,
    // Портальный чат открывается только после входа в «Альфа-Вики», а учётной
    // записи у врача нет. Экран настроек предупреждает об этом на месте.
    isPortal: Boolean(portalInviteToken(link.url))
  };
}

module.exports = {
  AVATAR_DIR,
  normalizeUrl,
  fetchPreview,
  downloadAvatar,
  saveAvatar,
  storeAvatar,
  portalInviteToken,
  removeAvatar,
  refresh,
  forMedCenter,
  toMailItem,
  toJson
};
