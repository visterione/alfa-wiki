'use strict';

/**
 * Канал Имобис: SMS и ВКонтакте напрямую (ver. 7.95).
 *
 * Появился не ради экономии на агрегаторе, хотя и ради неё тоже. Главная причина
 * прозаичнее: через Fromni не видно, что стало с сообщением. Её метод отвечает
 * «принято», а статус доставки уходит на её callback-сервер, который занят
 * мостом Renovatio, — и на вопрос «почему SMS не пришла» ответить нечем.
 *
 * У Имобиса статус приходит нам: адрес обработчика передаётся в самом запросе
 * параметром report. Плюс есть песочница, баланс и список имён отправителя.
 *
 * Каскад у них свой и устроен как у Fromni: массив route, порядок задаёт порядок
 * отправки, у каждой ступени свой текст. Поэтому «ВК, потом SMS» — это один
 * запрос, а не два, и остановится он на первой доставленной ступени.
 */

const axios = require('axios');
const https = require('https');

const BASE = process.env.IMOBIS_BASE_URL || 'https://api.imobis.ru/v3';
const SANDBOX_BASE = 'https://sandbox.imobis.ru/v3';

const agent = new https.Agent({ keepAlive: true, family: 4, maxSockets: 8 });

class ChannelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChannelError';
    this.code = code;
  }
}

/**
 * Токен. Один на аккаунт, но допускаем и отдельный на организацию: у клиник
 * могут оказаться разные лицевые счета.
 */
function tokenFor(organization) {
  const perOrg = organization && process.env[`IMOBIS_TOKEN_${String(organization).toUpperCase().replace(/-/g, '_')}`];
  const token = perOrg || process.env.IMOBIS_TOKEN;
  if (!token) throw new ChannelError('no_token', 'Не задан IMOBIS_TOKEN');
  return token;
}

function client(organization, sandbox) {
  return axios.create({
    baseURL: sandbox ? SANDBOX_BASE : BASE,
    headers: { Authorization: `Token ${tokenFor(organization)}`, 'Content-Type': 'application/json' },
    timeout: 30000,
    httpsAgent: agent,
    validateStatus: () => true
  });
}

async function call(organization, method, path, body = {}, { sandbox = false } = {}) {
  let res;
  try {
    res = await client(organization, sandbox).request({ method, url: path, data: body });
  } catch (err) {
    throw new ChannelError('network', err.code || err.message);
  }

  if (res.status >= 200 && res.status < 300) return res.data;

  const data = res.data || {};
  const said = data.description || data.message || data.error;

  // Тело ответа в сообщение об ошибке кладём обязательно. Свернув его в сухое
  // «HTTP 403», мы отличаем отказ API от блокировки на подступах только гаданием
  // — уже проходили это с getAppointmentsV2 и с каналами Fromni.
  const raw = typeof data === 'string'
    ? data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    : JSON.stringify(data).slice(0, 300);

  const error = new ChannelError(res.status === 401 ? 'unauthorized' : 'error',
    `HTTP ${res.status}${said ? ': ' + said : ''}${!said && raw && raw !== '{}' ? ' — ответ: ' + raw : ''}`);
  error.status = res.status;
  error.body = data;
  error.headers = res.headers;
  throw error;
}

// ── Отправка ──────────────────────────────────────────────────────────────

/**
 * Каскадная отправка. Ступени идут в том порядке, в каком переданы, и цепочка
 * останавливается на первой доставленной.
 *
 * @param {Array} route ступени: { channel: 'sms'|'vk'|'viber', text, sender|group, ttl }
 * @param {Object} options
 * @param {string} options.phone      номер получателя
 * @param {string} options.customId   наш идентификатор — вернётся в статусе
 * @param {string} options.reportUrl  куда прислать статус доставки
 * @param {boolean} options.dayOnly   не отправлять ночью (их собственная защита)
 */
async function send(organization, route, options = {}) {
  if (!Array.isArray(route) || !route.length) {
    throw new ChannelError('error', 'Пустой маршрут отправки');
  }

  const body = {
    route: route.map(step => ({ ...step, phone: options.phone })),
    custom_id: options.customId,
    report: options.reportUrl,
    // Их собственные дневные часы. Наши тихие часы точнее — они умеют
    // откладывать на конкретное время, — но эта галка остаётся вторым рубежом
    // на случай, если наша отсрочка почему-то не сработает.
    daydelivery: options.dayOnly === true ? true : undefined
  };

  const data = await call(organization, 'POST', '/message/send', body, { sandbox: options.sandbox });

  // Идентификатор нужен, чтобы связать статус с нашей строкой очереди, если
  // custom_id вдруг не вернётся.
  const id = data && (data.id || data.message_id || (data.result && data.result.id));
  return { externalMessageId: id ? String(id) : null, raw: data };
}

// ── Справки ───────────────────────────────────────────────────────────────

const balance = (organization, sandbox) => call(organization, 'POST', '/balance', {}, { sandbox });
const info = (organization, sandbox) => call(organization, 'POST', '/info', {}, { sandbox });

/**
 * Имена отправителя, зарегистрированные на аккаунте. Без них SMS не уйдёт, а
 * подобрать имя наугад нельзя: оно проходит модерацию у операторов.
 */
async function senders(organization, sandbox) {
  const data = await call(organization, 'POST', '/senders', {}, { sandbox });
  const rows = (data && (data.senders || data.data || data.result)) || data;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Шаблоны аккаунта. У ВК-канала сообщение уходит только по одобренному шаблону,
 * поэтому список нужен рядом с полем текста — как и у Fromni, но здесь его
 * хотя бы видно честно.
 */
async function templates(organization, sandbox) {
  const data = await call(organization, 'GET', '/template/show', {}, { sandbox });
  const rows = (data && (data.templates || data.data || data.result)) || data;
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  platform: 'imobis',
  ChannelError,
  send,
  balance,
  info,
  senders,
  templates,
  tokenFor
};
