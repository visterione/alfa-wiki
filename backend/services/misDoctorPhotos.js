'use strict';

// Фото врачей из МИС для карточек врачей и документа для печати (ver. 9.05).
//
// МИС отдаёт ссылку на фото в getUsers (поле avatar), а сам файл лежит на её
// домене без заголовков CORS и весит под мегабайт. Браузер такую картинку
// показать может, но снять её в документ Word — нет: canvas с чужой картинкой
// «испачкан». Поэтому фото идёт через нас: сервер скачивает, ужимает и отдаёт
// со своего адреса.
//
// Карта «врач → ссылка» строится одним запросом getUsers по всем сотрудникам:
// страница врачей открывает десятки карточек сразу, и десятки одиночных
// запросов к МИС на каждое открытие были бы заметной нагрузкой ради одного
// поля. Сами картинки кэшируются уже ужатыми — повторный показ не ходит в МИС
// вовсе.

const axios = require('axios');
const sharp = require('sharp');

const MAP_TTL_MS = 60 * 60 * 1000;
const PHOTO_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_PHOTOS = 600;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
// Карточка показывает фото размером с палец, документ — около 3 см по
// ширине. 480 пикселей хватает на то и другое с запасом для печати. Квадрат:
// рамка в карточке и в документе квадратная, а прямоугольное фото в Word
// легло бы своими пропорциями. Обрезаем от верха кадра — там лицо.
const PHOTO_SIDE = 480;

// МИС время от времени рвёт соединение (ECONNRESET) на ровном месте, и
// одиночный сбой превращал фото врача в заглушку на весь документ. Один
// повтор через полсекунды закрывает такие сбои; настоящую недоступность МИС
// он не маскирует — второй отказ уходит наверх.
async function withRetry(fn, delayMs) {
  try {
    return await fn();
  } catch (err) {
    await new Promise(r => setTimeout(r, delayMs));
    return fn();
  }
}

function createDoctorPhotos({ misRequest, misBaseUrl, fetchImage = defaultFetchImage, now = () => Date.now(), retryDelayMs = 500 }) {
  const allowedHost = new URL(misBaseUrl).host;
  let avatarMap = null;
  let avatarMapAt = 0;
  let avatarMapPending = null;
  const photos = new Map();

  async function loadAvatarMap() {
    const data = await withRetry(() => misRequest('getUsers', { show_all: true }), retryDelayMs);
    if (Number(data?.error) !== 0 || !Array.isArray(data?.data)) throw new Error('МИС не отдала список сотрудников');
    const map = new Map();
    for (const user of data.data) {
      const url = user.avatar || user.avatar_small;
      if (user.id != null && url) map.set(String(user.id), url);
    }
    return map;
  }

  async function avatarUrl(userId) {
    if (!avatarMap || now() - avatarMapAt > MAP_TTL_MS) {
      // Одновременные запросы ждут один и тот же поход в МИС.
      avatarMapPending = avatarMapPending || loadAvatarMap()
        .then((map) => { avatarMap = map; avatarMapAt = now(); })
        .finally(() => { avatarMapPending = null; });
      await avatarMapPending;
    }
    return avatarMap.get(String(userId)) || null;
  }

  function remember(userId, value) {
    photos.delete(userId);
    photos.set(userId, { value, at: now() });
    // Map помнит порядок вставки — самый старый первым и вылетает.
    while (photos.size > MAX_CACHED_PHOTOS) photos.delete(photos.keys().next().value);
    return value;
  }

  /**
   * Ужатое фото врача (Buffer с JPEG) или null, если в МИС его нет.
   */
  async function getPhoto(userId) {
    const key = String(userId);
    const cached = photos.get(key);
    if (cached && now() - cached.at < PHOTO_TTL_MS) return cached.value;

    const url = await avatarUrl(key);
    if (!url) return remember(key, null);
    // Ходим только на сам сервер МИС: ссылка приходит из её ответа, но
    // превращать наш сервер в скачивалку произвольных адресов незачем.
    let parsed;
    try { parsed = new URL(url, misBaseUrl); } catch { return remember(key, null); }
    if (parsed.host !== allowedHost) return remember(key, null);

    const source = await withRetry(() => fetchImage(parsed.href), retryDelayMs);
    const photo = await sharp(source)
      .rotate()
      .resize({ width: PHOTO_SIDE, height: PHOTO_SIDE, fit: 'cover', position: 'top', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer();
    return remember(key, photo);
  }

  return { getPhoto };
}

async function defaultFetchImage(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: MAX_SOURCE_BYTES,
  });
  return Buffer.from(response.data);
}

module.exports = { createDoctorPhotos };
