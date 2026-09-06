'use strict';

/**
 * Канал MAX (ver. 7.87).
 *
 * Второй мессенджер той же пары: у каждого медцентра бот в Telegram и бот в MAX.
 * Наружу модуль выглядит так же, как телеграмный, — отправить текст и разобрать
 * обновление, — поэтому разговор с пациентом, открытая линия и каскад
 * уведомлений о нём ничего не знают.
 *
 * Что отличается по существу:
 *
 *   • курсор. У Telegram он на каждое обновление (update_id), у MAX — один
 *     маркер на пачку. Поэтому канал сам говорит, чем двигать курсор, а
 *     процесс забора не гадает.
 *   • телефон. Кнопка «поделиться контактом» приходит вложением с карточкой
 *     VCARD, номер надо доставать из неё, а не из готового поля.
 *   • кнопки. И обычные, и запрос контакта передаются одинаково — вложением
 *     inline_keyboard, отдельной клавиатуры, как в Telegram, здесь нет.
 *
 * Адрес и способ авторизации проверены запросом 06.09.2026: botapi.max.ru
 * принимает и заголовок, и query-параметр, но в документации query объявлен
 * устаревшим — ходим заголовком.
 */

const axios = require('axios');
const https = require('https');

const API_BASE = process.env.MAX_API_BASE || 'https://botapi.max.ru';
const TIMEOUT = 20000;

const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 5000, family: 4, maxSockets: 16 });

class ChannelError extends Error {
  constructor(code, message, retryAfter) {
    super(message);
    this.name = 'ChannelError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function client(token, timeoutMs) {
  return axios.create({
    baseURL: API_BASE,
    timeout: timeoutMs || TIMEOUT,
    httpsAgent: agent,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    validateStatus: () => true
  });
}

function classify(status, body) {
  const code = (body && body.code) || '';
  const message = (body && body.message) || `HTTP ${status}`;

  // Человек удалил бота или закрыл диалог — канал закрыт, каскад должен уйти
  // на следующую ступень, а не повторять попытку.
  if (status === 403 || /blocked|forbidden|not.allowed/i.test(code)) {
    return new ChannelError('blocked', message);
  }
  if (status === 404 || /not.found/i.test(code)) return new ChannelError('unknown_chat', message);
  if (status === 429) return new ChannelError('rate_limited', message, 1);
  return new ChannelError('error', `${code ? code + ': ' : ''}${message}`);
}

async function call(token, method, path, { params, body, timeoutMs } = {}) {
  let res;
  try {
    res = await client(token, timeoutMs).request({ method, url: path, params, data: body });
  } catch (err) {
    throw new ChannelError('network', err.code || err.message);
  }
  if (res.status >= 200 && res.status < 300) return res.data;
  throw classify(res.status, res.data);
}

// ── Отправка ──────────────────────────────────────────────────────────────

/**
 * Собирает вложение с кнопками. У MAX и обычные кнопки, и запрос контакта —
 * это одно и то же вложение, отдельной клавиатуры здесь нет.
 */
function keyboardAttachment(options) {
  if (options.buttons) {
    return {
      type: 'inline_keyboard',
      payload: {
        buttons: options.buttons.map(row =>
          row.map(b => ({ type: 'callback', text: b.text, payload: b.data })))
      }
    };
  }
  if (options.requestContact) {
    return {
      type: 'inline_keyboard',
      payload: { buttons: [[{ type: 'request_contact', text: options.requestContact }]] }
    };
  }
  return null;
}

async function sendText(bot, userId, text, options = {}) {
  const attachment = keyboardAttachment(options);

  const result = await call(bot.token, 'POST', '/messages', {
    params: { user_id: Number(userId) },
    body: {
      text,
      attachments: attachment ? [attachment] : undefined
    }
  });

  const id = result && result.message && result.message.body && result.message.body.mid;
  return { externalMessageId: id ? String(id) : null };
}

/**
 * Ответ на нажатие кнопки. Как и в Telegram, живёт секунды и протухает —
 * падать из-за него нечего.
 */
async function answerCallback(bot, callbackId, text) {
  try {
    await call(bot.token, 'POST', '/answers', {
      params: { callback_id: callbackId },
      body: text ? { notification: text } : {}
    });
  } catch (err) {
    console.warn('[max] ответ на кнопку:', err.message);
  }
}

// ── Разбор входящего ──────────────────────────────────────────────────────

/**
 * Достаёт номер из карточки контакта. MAX присылает VCARD строкой, готового
 * поля с телефоном в ней нет.
 */
function phoneFromContact(payload) {
  if (!payload) return null;

  const vcf = payload.vcf_info || '';
  const tel = String(vcf).match(/TEL[^:]*:\s*([+\d\s()-]{6,})/i);
  if (tel) return tel[1].trim();

  const info = payload.max_info || payload.tam_info || {};
  return info.phone || info.contact_phone || null;
}

function senderOf(user = {}) {
  return {
    username: user.username || null,
    firstName: user.first_name || user.name || null,
    lastName: user.last_name || null
  };
}

function parseUpdate(update) {
  const type = update.update_type;

  if (type === 'bot_started') {
    const userId = String((update.user && update.user.user_id) || '');
    return {
      type: 'command',
      command: '/start',
      text: '/start',
      chatId: userId,          // писать пациенту можно по его user_id
      externalUserId: userId,
      externalMessageId: null,
      from: senderOf(update.user)
    };
  }

  if (type === 'message_created' && update.message) {
    const m = update.message;
    const sender = (m.sender && m.sender.user_id) || (m.recipient && m.recipient.user_id);
    const userId = String(sender || '');
    const base = {
      chatId: userId,
      externalUserId: userId,
      externalMessageId: m.body && m.body.mid ? String(m.body.mid) : null,
      from: senderOf(m.sender)
    };

    const attachments = (m.body && m.body.attachments) || m.attachments || [];
    const contact = attachments.find(a => a.type === 'contact');
    if (contact) {
      return { ...base, type: 'contact', phone: phoneFromContact(contact.payload), contactUserId: userId };
    }

    const media = attachments.find(a => ['image', 'photo', 'file', 'audio', 'video'].includes(a.type));
    const text = (m.body && m.body.text) || '';

    if (media) {
      const kind = media.type === 'image' ? 'photo' : (media.type === 'audio' ? 'voice' : media.type);
      return {
        ...base,
        type: 'media',
        text,
        media: {
          kind,
          // У MAX файл приходит готовой ссылкой, а не идентификатором. Забираем
          // её так же сразу: жить вечно она не обязана.
          url: (media.payload && (media.payload.url || media.payload.token)) || null,
          title: media.payload && media.payload.filename
        }
      };
    }

    if (text.startsWith('/')) {
      return { ...base, type: 'command', command: text.split(/[\s@]/)[0].toLowerCase(), text };
    }
    if (text) return { ...base, type: 'text', text };
    return null;
  }

  if (type === 'message_callback' && update.callback) {
    const userId = String((update.callback.user && update.callback.user.user_id) || '');
    return {
      type: 'button',
      callbackId: update.callback.callback_id,
      data: update.callback.payload,
      chatId: userId,
      externalUserId: userId,
      externalMessageId: null,
      from: senderOf(update.callback.user)
    };
  }

  return null;
}

// ── Обновления и настройка ────────────────────────────────────────────────

async function getMe(token) {
  return call(token, 'GET', '/me');
}

/**
 * Забор обновлений. Курсор у MAX один на пачку: сервер сам возвращает маркер,
 * с которого продолжать, — поэтому наружу отдаём и обновления, и новый курсор.
 */
async function getUpdates(token, cursor, timeoutSec = 30) {
  const params = {
    timeout: timeoutSec,
    types: 'message_created,message_callback,bot_started'
  };
  if (cursor) params.marker = cursor;

  const data = await call(token, 'GET', '/updates', {
    params,
    timeoutMs: timeoutSec * 1000 + 15000
  });

  return {
    updates: (data && data.updates) || [],
    cursor: data && data.marker ? Number(data.marker) : cursor
  };
}

// У MAX курсор общий на пачку, поэтому подтверждать каждое обновление
// по отдельности нечем — процесс забора двигает его после разбора всей пачки.
function cursorOf() {
  return null;
}

/**
 * Скачивание файла. У MAX ссылка приходит прямо во вложении, отдельного шага
 * «узнать адрес» нет — поэтому fileLink здесь просто возвращает то, что уже
 * известно, а забирает файл общий с Telegram код.
 */
async function fileLink(bot, fileIdOrUrl) {
  return { url: fileIdOrUrl, size: null, suggestedName: null };
}

async function fileStream(url) {
  const res = await axios.get(url, { responseType: 'stream', timeout: 60000, httpsAgent: agent });
  return { stream: res.data, contentType: res.headers['content-type'] || null };
}

async function setWebhook(token, url) {
  return call(token, 'POST', '/subscriptions', { body: { url } });
}

/**
 * Снятие подписки. Адрес обязателен, поэтому без него сначала спрашиваем, что
 * подписано, и снимаем всё: вызывающему знать про это незачем — у Telegram
 * тот же вызов адреса не требует.
 */
async function deleteWebhook(token, url) {
  if (url) return call(token, 'DELETE', '/subscriptions', { params: { url } });

  const data = await call(token, 'GET', '/subscriptions');
  const subscriptions = (data && data.subscriptions) || [];
  for (const s of subscriptions) {
    if (s.url) await call(token, 'DELETE', '/subscriptions', { params: { url: s.url } });
  }
  return { removed: subscriptions.length };
}

async function getWebhookInfo(token) {
  const data = await call(token, 'GET', '/subscriptions');
  const first = (data && data.subscriptions && data.subscriptions[0]) || null;
  return { url: first ? first.url : '', pending_update_count: 0 };
}

module.exports = {
  platform: 'max',
  ChannelError,
  sendText,
  answerCallback,
  parseUpdate,
  getMe,
  getUpdates,
  cursorOf,
  fileLink,
  fileStream,
  setWebhook,
  deleteWebhook,
  getWebhookInfo
};
