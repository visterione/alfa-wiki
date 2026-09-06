'use strict';

/**
 * Канал Fromni: Notify, ВК и SMS (ver. 7.86).
 *
 * Вторая ступень каскада. Своих ботов мы забрали себе, а всё остальное остаётся
 * у агрегатора — тот же договор, те же цены, те же одобренные шаблоны Notify.
 * Меняется одно: кто нажимает «отправь». Раньше это делал мост Renovatio,
 * теперь мы.
 *
 * Порядок внутри Fromni задаётся массивом channels — в их документации прямо
 * сказано «до первой доставки, порядок в массиве задаёт порядок отправки».
 * Поэтому переизобретать каскад Notify → SMS не нужно, он остаётся у них.
 */

const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

const BASE = process.env.FROMNI_BASE_URL || 'https://api.fromni.com/user';

// Ключи по организациям — те же, что у синхронизации подписчиков.
const KEY_ENV = {
  'alfa': 'FROMNI_KEY_ALFA',
  'alfa-deti': 'FROMNI_KEY_ALFA_DETI',
  'alfa-liniya': 'FROMNI_KEY_ALFA_LINIYA',
  'alfa-prof': 'FROMNI_KEY_ALFA_PROF',
  'alfa-smile': 'FROMNI_KEY_ALFA_SMILE',
  'alfa-3k': 'FROMNI_KEY_ALFA_3K'
};

// Запасной порядок ступеней. Основной приходит из настроек (services/
// notifications/settings.js) — этот нужен, если вызывающий его не передал.
const CASCADE = (process.env.FROMNI_CASCADE || 'notify+vk,sms+webchat').split(',').map(s => s.trim());

// Старый nginx у Fromni просит legacy-ренегоциацию TLS, которую OpenSSL 3
// запрещает по умолчанию, — та же настройка, что у синхронизации подписчиков.
const agent = new https.Agent({
  keepAlive: true,
  family: 4,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT | crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
});

function keyFor(organization) {
  const name = KEY_ENV[organization];
  const key = name && process.env[name];
  if (!key) throw new Error(`Нет ключа Fromni для организации «${organization}»`);
  return key;
}

function client(organization) {
  return axios.create({
    baseURL: BASE,
    headers: { Authorization: `Token ${keyFor(organization)}`, 'Content-Type': 'application/json' },
    timeout: 60000,
    httpsAgent: agent
  });
}

// Подключения меняются раз в никогда, а спрашивать их на каждое сообщение —
// лишний запрос к небыстрому API.
const connectionsCache = new Map(); // organization -> { at, byChannel }
const CACHE_TTL = 30 * 60 * 1000;

async function connectionsOf(organization) {
  const hit = connectionsCache.get(organization);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.byChannel;

  const { data } = await client(organization).post('/channels/connections', {});
  const rows = Array.isArray(data && data.data) ? data.data : (Array.isArray(data) ? data : []);

  const byChannel = {};
  for (const row of rows) {
    const name = row.channel || row.name;
    if (!name) continue;
    (byChannel[name] = byChannel[name] || []).push(row.id);
  }

  connectionsCache.set(organization, { at: Date.now(), byChannel });
  return byChannel;
}

/**
 * Собирает ступени каскада из того, что реально подключено у организации.
 * Имя вида «notify+vk» — это комбинация, и подключения ей нужны от обеих частей.
 */
async function channelsFor(organization, order = CASCADE) {
  const available = await connectionsOf(organization);

  const out = [];
  for (const name of order) {
    const connections = name.split('+').flatMap(part => available[part] || []);
    if (connections.length) out.push({ name, connections });
  }
  return out;
}

/**
 * Отправляет уведомление на телефон. Дальше Fromni сама идёт по ступеням до
 * первой доставки.
 *
 * @param {Object}   texts  тексты по ступеням: { 'sms+webchat': 'коротко', ... }
 *                          и `default` для остальных. У SMS длина считается
 *                          сегментами, и один лишний символ стоит второй SMS —
 *                          поэтому текст на ступень свой, а не общий.
 * @returns {Promise<{externalMessageId: string, channel: string}>}
 */
async function sendText(organization, phone, texts, order = CASCADE) {
  const channels = await channelsFor(organization, order);
  if (!channels.length) {
    throw new Error(`У организации «${organization}» не найдено подключений для каскада ${order.join(' → ')}`);
  }

  const fallback = typeof texts === 'string' ? texts : texts.default;

  const { data } = await client(organization).post('/notifications/send', {
    phone,
    // Текст на каждую ступень свой. Fromni это умеет: в её API у канала есть
    // собственное поле message, и порядок массива задаёт порядок отправки.
    channels: channels.map(c => ({ ...c, message: { text: (texts && texts[c.name]) || fallback } }))
  });

  if (!data || (data.result && data.result.error)) {
    throw new Error((data && data.result && data.result.message) || 'Fromni отказала в отправке');
  }

  return { externalMessageId: data.id || null, channel: channels.map(c => c.name).join('→') };
}

/**
 * Зарегистрированные шаблоны. Нужны не для отправки — её метод ищет совпадение
 * сам, — а чтобы администратор видел, с чем именно текст должен совпасть.
 *
 * Цена вопроса: не нашёлся шаблон — Notify не сработает, и сообщение молча
 * уйдёт SMS-кой. Расхождение в одном слове превращает дешёвый канал в дорогой,
 * и заметить это можно только по счёту в конце месяца.
 */
async function templates(organization) {
  const { data } = await client(organization).post('/template2/list', {});
  const rows = Array.isArray(data && data.data) ? data.data : (Array.isArray(data) ? data : []);

  return rows.map(t => ({
    id: t.id || t._id || null,
    name: t.name || t.title || '',
    text: t.text || (t.message && t.message.text) || '',
    channels: t.channels || t.channelNames || []
  }));
}

module.exports = { platform: 'fromni', sendText, channelsFor, connectionsOf, templates, CASCADE, KEY_ENV };
