'use strict';

/**
 * Клиент к alfa-parser — парсеру прайсов клиник-конкурентов.
 *
 * Парсер стоит на отдельной машине в локальной сети и слушает по HTTP.
 * Общий для двух потребителей: маршрута-прокси (routes/parser-proxy.js),
 * через который с ним говорит интерфейс, и ночной синхронизации
 * (services/competitorPricesSync.js).
 *
 * Настройка в backend/.env:
 *   PARSER_BASE_URL   http://<адрес-парсера>:8000
 *   PARSER_API_TOKEN  тот же ключ, что в .env парсера
 */

const axios = require('axios');

// Каталог отдаётся страницами по 500 услуг, каждая собирается за доли секунды.
// 30 секунд — запас на медленную сеть, а не на долгую работу.
const REQUEST_TIMEOUT = 30000;

// Коды, по которым видно, что до парсера не достучались вовсе, — в отличие от
// случая, когда он ответил, но ответ нам не понравился
const UNREACHABLE = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND'];

// Читаются на каждый вызов, а не при загрузке модуля: иначе правка .env
// начинает действовать только после перезапуска, и это легко принять
// за неработающую настройку
const parserUrl = () => (process.env.PARSER_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const hasToken = () => Boolean(process.env.PARSER_API_TOKEN);

async function get(path, params = {}) {
  const response = await axios.get(`${parserUrl()}${path}`, {
    params,
    headers: { 'X-Api-Key': process.env.PARSER_API_TOKEN || '' },
    timeout: REQUEST_TIMEOUT
  });
  return response.data;
}

async function post(path, body = {}) {
  const response = await axios.post(`${parserUrl()}${path}`, body, {
    headers: { 'X-Api-Key': process.env.PARSER_API_TOKEN || '' },
    timeout: REQUEST_TIMEOUT
  });
  return response.data;
}

const ping = () => get('/api/ping');
const listSources = async () => (await get('/api/sources')).sources || [];
const getSource = (parserSourceId) => get(`/api/sources/${encodeURIComponent(parserSourceId)}`);
const listServices = (parserSourceId, { after = 0, limit = 500 } = {}) =>
  get(`/api/sources/${encodeURIComponent(parserSourceId)}/services`, { after, limit });

/**
 * Весь каталог источника, страница за страницей.
 *
 * Листается курсором `after`, а не через offset: у clinic23 по Краснодару
 * 6778 услуг, и offset на таком объёме способен пропустить услугу, если
 * обход допишет строки прямо посреди выгрузки.
 *
 * Страницы собираются в память целиком, и только потом идёт запись в базу.
 * Иначе транзакция висела бы открытой всё время, пока мы ходим по сети,
 * — а это до полутора минут на медленной связи. Самый большой источник
 * весит здесь пару десятков мегабайт; если каталоги вырастут на порядок,
 * это место придётся переделать на потоковую запись.
 */
async function fetchCatalog(parserSourceId, { limit = 500, onPage = null } = {}) {
  const services = [];
  let after = 0;
  let total = 0;

  for (;;) {
    const page = await listServices(parserSourceId, { after, limit });
    services.push(...(page.services || []));
    total = page.total ?? total;
    if (onPage) onPage({ fetched: services.length, total });

    if (page.next_after === null || page.next_after === undefined) break;
    after = page.next_after;
  }

  return { services, total };
}

/**
 * Разбор ошибки в пригодный для показа вид.
 *
 * Разница между «парсер не запущен», «ключи разошлись» и «на парсере ключ
 * не настроен» видна только здесь: наверх всё это уехало бы одинаковой
 * пятисоткой, и причину пришлось бы искать по логам двух машин сразу.
 */
function describeError(err) {
  if (UNREACHABLE.includes(err.code)) {
    return {
      status: 502,
      error: 'parser_unreachable',
      message: `Парсер не отвечает по адресу ${parserUrl()}. Проверьте, что он запущен и виден из сети.`
    };
  }

  switch (err.response?.status) {
    case 401:
      return {
        status: 502,
        error: 'parser_key_rejected',
        message: 'Парсер не принял ключ. PARSER_API_TOKEN в вики и в парсере должны совпадать.'
      };
    case 503:
      return {
        status: 502,
        error: 'parser_key_missing',
        message: 'На парсере не задан PARSER_API_TOKEN — его API выключен.'
      };
    case 404:
      return { status: 404, error: 'not_found', message: 'Парсер не знает такого источника' };
    default:
      return { status: 502, error: 'parser_error', message: 'Парсер вернул ошибку. Подробности в логах.' };
  }
}

module.exports = {
  UNREACHABLE,
  parserUrl,
  hasToken,
  get,
  post,
  ping,
  listSources,
  getSource,
  listServices,
  fetchCatalog,
  describeError
};
