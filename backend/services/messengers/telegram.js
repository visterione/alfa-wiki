'use strict';

/**
 * Канал Telegram (ver. 7.84).
 *
 * Один из сменных модулей доставки. Все каналы — наши боты, Fromni, в будущем
 * Имобис напрямую — устроены одинаково: умеют отправить текст и внятно сказать,
 * чем закончилось. Благодаря этому порядок каскада (бот → Notify → SMS) живёт в
 * настройке, а не в коде, и провайдера можно поменять, не трогая отправителей.
 *
 * Наружу отдаём нормализованное обновление, чтобы логика диалога не знала, из
 * какого мессенджера пришёл человек: у MAX формат свой, а разговор один и тот же.
 */

const axios = require('axios');
const https = require('https');

const API_BASE = 'https://api.telegram.org';
const TIMEOUT = 20000;

// Форс IPv4 и keep-alive — та же причина, что у клиента Fromni: из дата-центра
// IPv6-маршрут до внешних API бывает неживым, а простаивающее соединение рвёт
// файрвол. Проверено 06.09.2026: по IPv4 api.telegram.org отвечает за ~0.26 с.
const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000,
  family: process.env.TELEGRAM_IPV6 ? 0 : 4,
  maxSockets: 16
});

/**
 * Ошибка отправки с машиночитаемой причиной — по ней каскад решает, что делать
 * дальше: уходить на следующую ступень или повторить попытку позже.
 *
 * blocked      — человек заблокировал бота или удалил чат, канал закрыт навсегда
 * unknown_chat — такого чата нет (сменил аккаунт, чужой chatId)
 * rate_limited — слишком часто, в retryAfter лежит пауза в секундах
 * network      — не дозвонились, имеет смысл повторить
 * error        — всё остальное
 */
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
    baseURL: `${API_BASE}/bot${token}`,
    timeout: timeoutMs || TIMEOUT,
    httpsAgent: agent,
    // Разбираем коды сами: 403 и 400 здесь не аварии, а нормальные ответы,
    // из которых мы узнаём состояние подписки.
    validateStatus: () => true
  });
}

function classify(status, body) {
  const desc = (body && body.description) || '';
  if (status === 403 || /bot was blocked|user is deactivated|bot can't initiate/i.test(desc)) {
    return new ChannelError('blocked', desc || 'Бот заблокирован пользователем');
  }
  if (/chat not found|user not found/i.test(desc)) {
    return new ChannelError('unknown_chat', desc);
  }
  if (status === 429) {
    const retryAfter = (body && body.parameters && body.parameters.retry_after) || 1;
    return new ChannelError('rate_limited', desc || 'Слишком часто', retryAfter);
  }
  return new ChannelError('error', desc || `HTTP ${status}`);
}

async function call(token, method, payload, timeoutMs) {
  let res;
  try {
    res = await client(token, timeoutMs).post(`/${method}`, payload);
  } catch (err) {
    throw new ChannelError('network', err.code || err.message);
  }
  const body = res.data;
  if (res.status === 200 && body && body.ok) return body.result;
  throw classify(res.status, body);
}

// ── Отправка ──────────────────────────────────────────────────────────────

/**
 * Отправляет текст. Кнопки под сообщением (inline) передаются массивом рядов:
 * [[{ text: 'Подтверждаю', data: 'confirm:123' }]]
 *
 * @returns {Promise<{ externalMessageId: string }>}
 */
async function sendText(bot, chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode || 'HTML',
    disable_web_page_preview: true
  };

  if (options.buttons) {
    payload.reply_markup = {
      inline_keyboard: options.buttons.map(row =>
        row.map(b => ({ text: b.text, callback_data: b.data }))
      )
    };
  } else if (options.requestContact) {
    // Обычная клавиатура вместо inline: только она умеет попросить телефон.
    payload.reply_markup = {
      keyboard: [[{ text: options.requestContact, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    };
  } else if (options.removeKeyboard) {
    payload.reply_markup = { remove_keyboard: true };
  }

  const result = await call(bot.token, 'sendMessage', payload);
  return { externalMessageId: String(result.message_id) };
}

/**
 * Гасит «часики» на нажатой кнопке. Telegram ждёт этого ответа несколько секунд,
 * и без него у человека кнопка выглядит зависшей.
 */
async function answerCallback(bot, callbackId, text) {
  try {
    await call(bot.token, 'answerCallbackQuery', { callback_query_id: callbackId, text });
  } catch (err) {
    // Ответ на кнопку живёт секунды и протухает — падать из-за этого нечего.
    console.warn('[telegram] answerCallbackQuery:', err.message);
  }
}

// ── Разбор входящего ──────────────────────────────────────────────────────

/**
 * Приводит обновление Telegram к общему для всех каналов виду.
 * Возвращает null для того, что нам неинтересно (правки сообщений и т.п.).
 */
function parseUpdate(update) {
  if (update.message) {
    const m = update.message;
    const base = {
      chatId: String(m.chat.id),
      externalUserId: String(m.from.id),
      externalMessageId: String(m.message_id),
      from: {
        username: m.from.username || null,
        firstName: m.from.first_name || null,
        lastName: m.from.last_name || null
      }
    };

    if (m.contact) {
      return { ...base, type: 'contact', phone: m.contact.phone_number, contactUserId: m.contact.user_id ? String(m.contact.user_id) : null };
    }
    if (m.text && m.text.startsWith('/')) {
      return { ...base, type: 'command', command: m.text.split(/[\s@]/)[0].toLowerCase(), text: m.text };
    }
    if (m.text) {
      return { ...base, type: 'text', text: m.text };
    }

    // Вложения приводим к одному виду: тип и идентификатор файла у Telegram.
    // Ссылку получаем позже, при скачивании к себе — она живёт около часа.
    const media =
      (m.photo && { kind: 'photo', fileId: m.photo[m.photo.length - 1].file_id }) ||
      (m.document && { kind: 'file', fileId: m.document.file_id, title: m.document.file_name }) ||
      (m.voice && { kind: 'voice', fileId: m.voice.file_id }) ||
      (m.video && { kind: 'video', fileId: m.video.file_id }) ||
      null;

    if (media) return { ...base, type: 'media', media, text: m.caption || '' };
    return null;
  }

  if (update.callback_query) {
    const q = update.callback_query;
    return {
      type: 'button',
      callbackId: q.id,
      data: q.data,
      chatId: String(q.message.chat.id),
      externalUserId: String(q.from.id),
      externalMessageId: q.message ? String(q.message.message_id) : null,
      from: {
        username: q.from.username || null,
        firstName: q.from.first_name || null,
        lastName: q.from.last_name || null
      }
    };
  }

  return null;
}

// ── Настройка ─────────────────────────────────────────────────────────────

async function getMe(token) {
  return call(token, 'getMe', {});
}

async function setWebhook(token, url, secret) {
  return call(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
}

/**
 * Забирает накопившиеся обновления. Долгое ожидание (timeout) — не опрос по
 * таймеру: соединение висит открытым, пока не появится сообщение, поэтому
 * задержка получается почти такой же, как у вебхука, а запросов почти нет.
 *
 * offset подтверждает всё, что меньше него: обновления, разобранные в прошлый
 * раз, Telegram больше не пришлёт.
 */
async function getUpdates(token, offset, timeoutSec = 30) {
  // Своё ожидание держим заведомо дольше телеграмного, иначе axios оборвёт
  // соединение раньше, чем сервер ответит пустым списком, и каждый цикл будет
  // выглядеть сетевой ошибкой.
  return call(token, 'getUpdates', {
    offset,
    timeout: timeoutSec,
    allowed_updates: ['message', 'callback_query']
  }, timeoutSec * 1000 + 15000);
}

async function deleteWebhook(token) {
  return call(token, 'deleteWebhook', { drop_pending_updates: false });
}

async function getWebhookInfo(token) {
  return call(token, 'getWebhookInfo', {});
}

module.exports = {
  platform: 'telegram',
  ChannelError,
  sendText,
  answerCallback,
  parseUpdate,
  getMe,
  getUpdates,
  setWebhook,
  deleteWebhook,
  getWebhookInfo
};
