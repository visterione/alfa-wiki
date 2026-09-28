'use strict';

/**
 * Клиент LPTracker Direct API — CRM партнёра, который звонит нашим молчунам
 * (ver. 8.95).
 *
 * В 8.52 формат лида был наш собственный: спецификации у нас не было, и мы
 * отдавали карточку пациента «в понятной раскладке» на произвольный адрес.
 * Теперь известен и партнёр, и его API (docs.direct.lptracker.ru), и главное —
 * известно, что проект у них уже подготовлен под наши визиты: в нём заведены
 * поля appointment_id, patient_name, clinic_title, time_start, doctor_name и
 * шаги воронки «Обзвон роботом», «Подтвердил», «Отменил», «AI · Не дозвонились».
 * Наша задача сузилась до одного: положить лид в проект. Сценарий разговора,
 * нейронка и телефония — целиком у них.
 *
 * ПОЧЕМУ ПОЛЯ ИЩУТСЯ ПО ИМЕНИ, А НЕ ХРАНЯТСЯ ЧИСЛАМИ В НАСТРОЙКЕ. Кастомные
 * поля адресуются числовыми id, своими у каждого проекта. Вписывать полсотни
 * чисел руками в карточку филиала — способ завести настройку, которая
 * молча разъедется с проектом после первой правки на их стороне. Имена же
 * partner придумал сам и по смыслу поля: мы спрашиваем список полей проекта и
 * сопоставляем по имени. Не нашлось — поле пропускается со записью в журнал, а
 * не подставляется наугад в чужое.
 *
 * ПРО ЛИМИТ. У них 3 запроса в секунду на аккаунт, при превышении 503. Один лид
 * — это до трёх запросов (вход, поиск контакта, создание), поэтому все обращения
 * идут через общую очередь модуля: заявки разбираются пачкой, и без неё вечерний
 * десяток молчунов упёрся бы в лимит на первой же секунде.
 */

const axios = require('axios');

const BASE_URL = 'https://direct.lptracker.ru';

// Подпись всех наших действий в их журнале. Обязательное поле входа: они
// показывают его в истории лида, и «Alfa-Wiki» там полезнее пустой строки.
const SERVICE = 'Alfa-Wiki';
const API_VERSION = '1.0';

const TIMEOUT = 15000;

// Токен живёт 24 часа. Держим 12: обновить дешевле, чем узнать об истечении
// посреди разбора очереди.
const TOKEN_TTL_MS = 12 * 3600 * 1000;

// Список полей проекта меняется руками и редко — часа кэша достаточно, чтобы
// разбор сотни заявок не превратился в сотню лишних запросов.
const CUSTOMS_TTL_MS = 3600 * 1000;

// ── Очередь запросов ──────────────────────────────────────────────────────

// 3 запроса в секунду — их предел. Берём 340 мс на запрос: с запасом на то, что
// их счётчик считает по своим часам, а не по нашим.
const MIN_GAP_MS = 340;

let chain = Promise.resolve();
let lastAt = 0;

/**
 * Пропускает запросы по одному, не чаще предела. Очередь общая на процесс, а не
 * на филиал: лимит у партнёра на аккаунт, а аккаунт у нас один.
 */
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastAt);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastAt = Date.now();
    return fn();
  });

  // Цепочку продолжаем удачей независимо от исхода: один упавший запрос не
  // должен уносить с собой все стоящие за ним.
  chain = run.then(() => undefined, () => undefined);
  return run;
}

// ── Ошибки ────────────────────────────────────────────────────────────────

/**
 * Ошибка их API. Код держим отдельно от текста: на 401 мы перевходим, на
 * остальное — нет, и разбирать это по подстроке сообщения не годится.
 */
class LpError extends Error {
  constructor(message, code = null, body = null) {
    super(message);
    this.name = 'LpError';
    this.code = code;
    this.body = body;
  }
}

/**
 * Разбирает ответ. У них успех и отказ приезжают одинаковым 200, отличаясь полем
 * status, — поэтому код состояния HTTP здесь почти ничего не значит.
 *
 * Формат отказа в документации описан как { code, message }, а на деле приезжает
 * { status: 'error', errors: [{ code, message }] }. Разбираем оба: подстраиваться
 * под один — значит однажды получить «неизвестная ошибка» вместо причины.
 */
function unwrap(res) {
  const body = res && res.data;

  if (body && body.status === 'success') return body.result;

  const first = Array.isArray(body && body.errors) ? body.errors[0] : null;
  const code = (first && first.code) || (body && body.code) || res.status || null;
  const message = (first && first.message) || (body && body.message) || `HTTP ${res.status}`;

  throw new LpError(`LPTracker: ${message}`, Number(code) || null, body);
}

// ── Токен ─────────────────────────────────────────────────────────────────

// На логин, а не на филиал: аккаунт один на сеть, и второй вход тем же логином
// просто занял бы ещё одну их сессию.
const tokens = new Map();

async function login(config) {
  const res = await throttled(() => axios.post(`${BASE_URL}/login`, {
    login: config.login,
    password: config.password,
    service: SERVICE,
    version: API_VERSION
  }, { timeout: TIMEOUT, validateStatus: () => true }));

  const result = unwrap(res);
  const token = result && result.token;
  if (!token) throw new LpError('LPTracker: вход прошёл, но токена в ответе нет', null, res.data);

  tokens.set(config.login, { token, at: Date.now() });
  return token;
}

async function tokenFor(config) {
  if (!config || !config.login || !config.password) {
    throw new LpError('LPTracker: не заданы логин и пароль');
  }

  const hit = tokens.get(config.login);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
  return login(config);
}

/** Забыть токен — после 401 и из проверки подключения. */
function forget(login_) {
  if (login_) tokens.delete(login_);
  else tokens.clear();
}

/**
 * Запрос с токеном. 401 означает, что сессию у нас отобрали: перевходим и
 * повторяем ровно один раз — иначе неверный пароль устроил бы цикл входов.
 */
async function request(config, method, path, body = null, { retried = false } = {}) {
  const token = await tokenFor(config);

  const res = await throttled(() => axios({
    method,
    url: `${BASE_URL}${path}`,
    data: body || undefined,
    headers: { token, 'Content-Type': 'application/json' },
    timeout: TIMEOUT,
    validateStatus: () => true
  }));

  try {
    return unwrap(res);
  } catch (err) {
    if (err.code === 401 && !retried) {
      forget(config.login);
      return request(config, method, path, body, { retried: true });
    }
    throw err;
  }
}

// ── Справочники проекта ───────────────────────────────────────────────────

const projects = (config) => request(config, 'get', '/projects');

const funnel = (config, projectId) => request(config, 'get', `/project/${projectId}/funnel`);

const customs = (config, projectId) => request(config, 'get', `/project/${projectId}/customs`);

// Кэш полей: ключ — проект, значение — карта «имя поля → id».
const customsCache = new Map();

/**
 * Карта полей проекта по имени. Имя приводим к нижнему регистру и режем пробелы:
 * поля заводят руками, и «Patient_name» с пробелом на конце — вопрос времени.
 */
async function fieldMap(config, projectId, { fresh = false } = {}) {
  const key = String(projectId);
  const hit = customsCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CUSTOMS_TTL_MS) return hit.map;

  const rows = await customs(config, projectId);
  const map = new Map();
  for (const field of Array.isArray(rows) ? rows : []) {
    if (!field || field.id == null || !field.name) continue;
    map.set(String(field.name).trim().toLowerCase(), { id: field.id, type: field.type });
  }

  customsCache.set(key, { at: Date.now(), map });
  return map;
}

function forgetFields(projectId) {
  if (projectId) customsCache.delete(String(projectId));
  else customsCache.clear();
}

/**
 * Превращает наши значения в их `custom`: { id поля: значение }.
 *
 * @param {Map} map     карта полей проекта из fieldMap
 * @param {Object} values  наши значения под именами полей партнёра
 * @returns {{custom: Object, missing: string[]}} missing — чего в проекте нет;
 *   зовущий пишет это в журнал, потому что молча пропущенное поле означает
 *   звонок без даты визита, и выяснять это будут по записи разговора.
 */
function customFor(map, values) {
  const custom = {};
  const missing = [];

  for (const [name, value] of Object.entries(values)) {
    if (value == null || value === '') continue;

    const field = map.get(name.trim().toLowerCase());
    if (!field) { missing.push(name); continue; }
    custom[String(field.id)] = String(value);
  }

  return { custom, missing };
}

// ── Контакт ───────────────────────────────────────────────────────────────

/**
 * Ищет контакт по телефону, при отсутствии — создаёт.
 *
 * Поиск обязателен, а не «на всякий случай»: пациент ходит в клинику годами, и
 * без него каждый визит заводил бы новую карточку с тем же номером. У партнёра
 * на контакте висит история звонков, и она нужна целиком — робот не должен
 * звонить как впервые тому, кто месяц назад просил больше не звонить.
 *
 * @returns {Promise<{id: number, created: boolean}>}
 */
async function contactFor(config, projectId, { phone, name }) {
  if (!phone) throw new LpError('LPTracker: контакт без телефона заводить нечем');

  const found = await request(config, 'get',
    `/contact/search?project_id=${encodeURIComponent(projectId)}&phone=${encodeURIComponent(phone)}`);

  const first = Array.isArray(found) ? found[0] : null;
  if (first && first.id) return { id: first.id, created: false };

  const created = await request(config, 'post', '/contact', {
    project_id: Number(projectId),
    // Имя обязательное. Безымянный пациент бывает — в МИС карточку заводят с
    // одним телефоном, — и отдавать в этом случае номер лучше, чем пустую
    // строку: в списке контактов партнёра его хотя бы видно.
    name: name || phone,
    details: [{ type: 'phone', data: phone }]
  });

  if (!created || !created.id) {
    throw new LpError('LPTracker: контакт создан, но id в ответе нет', null, created);
  }
  return { id: created.id, created: true };
}

// ── Лид ───────────────────────────────────────────────────────────────────

/**
 * Создаёт лид. Шаг воронки передаётся, когда он задан в настройке: именно
 * попадание на шаг «Обзвон роботом» и запускает у них автоворонку, а без шага
 * лид ляжет на «Новый лид» и никуда не поедет.
 */
async function createLead(config, { projectId, contactId, name, funnelId, custom }) {
  const body = { contact_id: contactId, name };
  if (funnelId) body.funnel = Number(funnelId);
  if (custom && Object.keys(custom).length) body.custom = custom;

  const lead = await request(config, 'post', '/lead', body);
  if (!lead || !lead.id) throw new LpError('LPTracker: лид создан, но id в ответе нет', null, lead);
  return lead;
}

module.exports = {
  BASE_URL, SERVICE, LpError,
  login, tokenFor, forget, request,
  projects, funnel, customs, fieldMap, forgetFields, customFor,
  contactFor, createLead
};
