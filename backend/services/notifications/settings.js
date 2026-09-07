'use strict';

/**
 * Настройки рассылки: порядок каскада и тихие часы (ver. 7.94).
 *
 * Лежат в settings одной строкой на сеть: заводить таблицу под два значения не
 * за чем, а править их должен администратор, а не программист в .env.
 */

const { Setting } = require('../../models');

const CASCADE_KEY = 'notif_cascade';
const QUIET_KEY = 'notif_quiet_hours';
const IMOBIS_KEY = 'notif_imobis';

// «bot» — наши Telegram и MAX, остальные имена — ступени Fromni, как они
// называются в её API. Порядок массива и есть порядок отправки.
// Telegram и MAX порознь с 8.04: это два разных мессенджера с разной
// аудиторией, и приоритет между ними — решение заказчика, а не порядок выдачи
// из базы, каким он был, пока ступень называлась «bot».
const DEFAULT_CASCADE = ['telegram', 'max', 'notify+vk', 'sms+webchat'];

// Наши боты. Держим списком, а не проверкой «не imobis и не fromni»: список
// провайдеров открытый, и следующий чужой канал не должен по умолчанию
// оказаться нашим ботом.
const BOT_STEPS = ['telegram', 'max'];

// Имобис напрямую. Имя отправителя придумать нельзя — оно проходит модерацию у
// операторов, поэтому берётся из аккаунта (npm run imobis:check) и вписывается
// сюда. Группа ВК нужна каналу vk: без неё ступень собрать не из чего.
const DEFAULT_IMOBIS = {
  // Токен с 8.04 живёт здесь, а не в .env. Причина не техническая: модуль
  // передают человеку, который в консоль не ходит, а токен придётся менять —
  // они протухают. Пусто означает «взять IMOBIS_TOKEN из окружения», поэтому
  // то, что уже настроено на бою, продолжает работать без правок.
  //
  // Открытым текстом — так же, как токены ботов в messenger_bots с 7.84.
  // Шифрование потребовало бы ключа шифрования, а он лёг бы в тот же .env, от
  // которого уходим; доступ к таблице равен доступу к серверу, и разделить их
  // нам нечем.
  token: '',
  sender: '',
  vkGroup: null,
  sandbox: false,
  // Разные клиники могут иметь разные одобренные имена — тогда общее значение
  // выше служит запасным.
  senders: {},
  vkGroups: {}
};

const DEFAULT_QUIET = {
  enabled: true,
  from: '21:00',
  to: '09:00',
  // Бот по умолчанию не молчит: сообщение в мессенджере не будит так, как SMS,
  // а человек, записавшийся поздно вечером, ждёт подтверждения сразу.
  channels: ['notify+vk', 'sms+webchat']
};

// Настройки читаются на каждое сообщение — держим их в памяти минуту, чтобы не
// ходить в базу на каждую строку очереди.
const cache = new Map();
const TTL = 60000;

async function read(key, fallback) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const row = await Setting.findByPk(key);
  const value = row && row.value != null ? row.value : fallback;
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function write(key, value, description) {
  await Setting.upsert({ key, value, description });
  cache.delete(key);
  return value;
}

const cascade = () => read(CASCADE_KEY, DEFAULT_CASCADE);
const quietHours = () => read(QUIET_KEY, DEFAULT_QUIET);
const imobis = () => read(IMOBIS_KEY, DEFAULT_IMOBIS);

// ── Филиалы и события (ver. 8.03) ─────────────────────────────────────────
//
// Настройка ищется по трём уровням, от частного к общему:
//
//   1. событие         — свой каскад у шаблона (просьбу об отзыве не шлём SMS);
//   2. филиал          — свои тихие часы и своё имя отправителя;
//   3. общая настройка — то, что было единственным до 8.03.
//
// Пусто на любом уровне означает «спросить следующий», а не «ничего»: филиал,
// которому нечего переопределять, строки в notif_branch_settings не имеет
// вовсе, и заводить её ради копии общих значений незачем — они разъедутся при
// первой же правке общих.

// Настройки филиалов читаются на каждое сообщение, поэтому держим их в памяти
// той же минуту, что и общие.
const branchCache = new Map();

async function branch(medCenterId) {
  if (!medCenterId) return null;

  const hit = branchCache.get(medCenterId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  // require здесь, а не наверху файла: models подтягивает почти весь проект, а
  // settings.js грузится из него же — на верхнем уровне это кольцо.
  const { NotifBranchSettings } = require('../../models');
  const row = await NotifBranchSettings.findOne({ where: { medCenterId } });
  const value = row ? row.toJSON() : null;

  branchCache.set(medCenterId, { at: Date.now(), value });
  return value;
}

function forgetBranch(medCenterId) {
  if (medCenterId) branchCache.delete(medCenterId);
  else branchCache.clear();
}

/**
 * Порядок ступеней для конкретной отправки.
 *
 * @param {Object} where
 * @param {Array}  where.eventCascade каскад шаблона события, если задан
 * @param {string} where.medCenterId  филиал визита
 */
async function cascadeFor({ eventCascade = null, medCenterId = null } = {}) {
  if (Array.isArray(eventCascade) && eventCascade.length) return eventCascade;

  const own = await branch(medCenterId);
  if (own && Array.isArray(own.cascade) && own.cascade.length) return own.cascade;

  return cascade();
}

async function quietHoursFor(medCenterId) {
  const own = await branch(medCenterId);
  return (own && own.quietHours) || quietHours();
}

async function imobisFor(medCenterId) {
  const own = await branch(medCenterId);
  const base = await imobis();
  if (!own || !own.imobis) return base;

  // Сливаем, а не подменяем: филиал переопределяет своё — имя отправителя,
  // иногда токен, — а песочницу и остальное наследует. Пустые ключи в настройке
  // филиала не хранятся (см. PUT /branches), поэтому простого слияния хватает и
  // «пусто у филиала» само означает «как в общих».
  return { ...base, ...own.imobis };
}

/** Выключенный филиал не получает оповещений вовсе — см. миграцию 8.03. */
async function branchEnabled(medCenterId) {
  const own = await branch(medCenterId);
  return own ? own.isEnabled !== false : true;
}

/**
 * Разбивает каскад на группы подряд идущих ступеней одного провайдера.
 *
 * Нужно потому, что у Имобиса и у Fromni каскад свой: две ступени одного
 * провайдера — это один запрос с массивом маршрута, который сам остановится на
 * первой доставленной. Отправлять их по отдельности значило бы платить за обе.
 *
 * ['bot','imobis:vk','imobis:sms','sms+webchat'] →
 *   [{provider:'bot'}, {provider:'imobis', names:['vk','sms']},
 *    {provider:'fromni', names:['sms+webchat']}]
 */
function groupSteps(order) {
  const groups = [];

  for (const step of order) {
    const provider = BOT_STEPS.includes(step) ? 'bot'
      : (step.startsWith('imobis:') ? 'imobis' : 'fromni');
    const name = step.startsWith('imobis:') ? step.slice('imobis:'.length) : step;

    // Ступени ботов не сливаются в одну группу, даже стоя рядом: у Имобиса и
    // Fromni соседние ступени — это один запрос с их собственным каскадом, а
    // Telegram и MAX это два независимых отправления в два разных мессенджера.
    const last = groups[groups.length - 1];
    if (last && last.provider === provider && provider !== 'bot') {
      last.names.push(name);
      last.steps.push(step);
    } else {
      groups.push({ provider, names: [name], steps: [step] });
    }
  }
  return groups;
}

// ── Тихие часы ────────────────────────────────────────────────────────────

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Попадает ли момент в запрещённое время. Интервал почти всегда переходит через
 * полночь (с 21:00 до 09:00), поэтому сравнение двустороннее.
 */
function isQuiet(quiet, date) {
  if (!quiet || !quiet.enabled) return false;

  const now = date.getHours() * 60 + date.getMinutes();
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);

  return from <= to ? (now >= from && now < to) : (now >= from || now < to);
}

/**
 * Ближайший момент, когда писать снова можно.
 */
function nextAllowed(quiet, date) {
  const [h, m] = String(quiet.to || '09:00').split(':').map(Number);

  const at = new Date(date);
  at.setHours(h || 0, m || 0, 0, 0);
  // Если утро сегодняшнего дня уже прошло, ждать до завтрашнего.
  if (at <= date) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * Молчит ли канал в тихие часы. Список каналов в настройке — это имена ступеней
 * каскада; «bot» туда обычно не входит.
 */
function quietFor(quiet, channel) {
  if (!quiet || !quiet.enabled) return false;
  const list = Array.isArray(quiet.channels) ? quiet.channels : [];
  return list.includes(channel);
}

module.exports = {
  CASCADE_KEY, QUIET_KEY, IMOBIS_KEY,
  DEFAULT_CASCADE, DEFAULT_QUIET, DEFAULT_IMOBIS, BOT_STEPS,
  cascade, quietHours, imobis, groupSteps, read, write,
  isQuiet, nextAllowed, quietFor, minutesOf,
  branch, forgetBranch, cascadeFor, quietHoursFor, imobisFor, branchEnabled
};
