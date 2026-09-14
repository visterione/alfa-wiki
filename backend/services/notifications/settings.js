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

// Имобис напрямую — настройка филиала, общей на сеть больше нет (ver. 8.25).
// Учётная запись у Имобиса заведена на каждый медцентр, и трафик по ним
// распределён намеренно: SMS всей сети через один лицевой счёт никто не шлёт.
// Значит, API-ключ — имущество филиала, такое же как токен его бота.
//
// Имя отправителя придумать нельзя — оно проходит модерацию у операторов на
// конкретное юрлицо, поэтому берётся из аккаунта (npm run imobis:check) и
// вписывается в карточке филиала. Группа ВК нужна каналу vk: без неё ступень
// собрать не из чего.
//
// Открытым текстом — так же, как токены ботов в messenger_bots с 7.84.
// Шифрование потребовало бы ключа шифрования, а он лёг бы в тот же .env, от
// которого уходим; доступ к таблице равен доступу к серверу, и разделить их
// нам нечем.
const EMPTY_IMOBIS = { token: '', sender: '', vkGroup: null, sandbox: false };

// ── Источник события (ver. 8.25) ──────────────────────────────────────────
//
// Оповещение доходит до нас одним из двух путей, и путь зависит от события:
//
//   poll    — детектор раз в минуту спрашивает getAppointments «что
//             изменилось» и считает событие сравнением со снимком;
//   webhook — МИС зовёт наш адрес сама (настройка «уведомления о событиях» в
//             Renovatio), мы только разбираем присланное.
//
// Забор надёжнее: он не зависит от того, дошёл ли до нас запрос, и переживает
// перезапуск. Но готовность лабораторных исследований забором не берётся
// совсем — getPatientLabResults требует patient_key, который выдаётся только по
// логину пациента. Поэтому у лабораторных событий умолчание другое.
const SOURCES = ['poll', 'webhook'];
const DEFAULT_EVENT_SOURCES = {
  created: 'poll',
  moved: 'poll',
  cancelled: 'poll',
  reminder: 'poll',
  review: 'poll',
  lab_full: 'webhook',
  lab_partial: 'webhook'
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

// ── Филиалы и события (ver. 8.03) ─────────────────────────────────────────
//
// Каскад и тихие часы ищутся по трём уровням, от частного к общему:
//
//   1. событие         — свой каскад у шаблона (просьбу об отзыве не шлём SMS);
//   2. филиал          — свои тихие часы;
//   3. общая настройка — то, что было единственным до 8.03.
//
// Пусто на любом уровне означает «спросить следующий», а не «ничего»: филиал,
// которому нечего переопределять, строки в notif_branch_settings не имеет
// вовсе, и заводить её ради копии общих значений незачем — они разъедутся при
// первой же правке общих.
//
// Счёт у Имобиса в эту лестницу не входит с 8.25: у каждого медцентра своя
// учётная запись, наследовать её не от чего, и «пусто» там означает не «как в
// общих», а «SMS у этого филиала не уйдут».

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

/**
 * Счёт филиала у Имобиса из его строки настроек. Наследовать больше не от чего:
 * общая настройка сети исчезла в 8.25 вместе с наследованием (см. миграцию).
 *
 * Возвращается всегда объект, даже когда филиал не настроен: отправщику нужно
 * отличать «нет токена» от «нет филиала», и пустая строка отвечает на это ровно
 * так же, как отсутствие строки в базе.
 */
function resolveImobis(own) {
  return { ...EMPTY_IMOBIS, ...((own && own.imobis) || {}) };
}

/**
 * Откуда берутся события филиала. Ключ отсутствует — умолчание события.
 *
 * Неизвестное значение отбрасывается молча и осознанно: оно означало бы
 * событие, которое не берётся ни забором, ни вебхуком, то есть тишину без следа
 * в журнале. Лучше лишний разбор, чем молчание.
 */
function resolveEventSources(own) {
  const stored = (own && own.eventSources) || {};

  const out = { ...DEFAULT_EVENT_SOURCES };
  for (const [event, value] of Object.entries(stored)) {
    if (SOURCES.includes(value)) out[event] = value;
  }
  return out;
}

const imobisFor = async (medCenterId) => resolveImobis(await branch(medCenterId));
const eventSourcesFor = async (medCenterId) => resolveEventSources(await branch(medCenterId));

/**
 * Каким путём филиал получает это событие. Событие, о котором мы ничего не
 * знаем, забираем сами: неизвестное имя приходит из шаблона, заведённого
 * руками, и молчать по нему хуже, чем разобрать лишнее.
 */
async function eventSourceFor(medCenterId, event) {
  const sources = await eventSourcesFor(medCenterId);
  return sources[event] || 'poll';
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
  CASCADE_KEY, QUIET_KEY,
  DEFAULT_CASCADE, DEFAULT_QUIET, EMPTY_IMOBIS, BOT_STEPS,
  SOURCES, DEFAULT_EVENT_SOURCES,
  cascade, quietHours, groupSteps, read, write,
  isQuiet, nextAllowed, quietFor, minutesOf,
  branch, forgetBranch, cascadeFor, quietHoursFor, imobisFor, branchEnabled,
  eventSourcesFor, eventSourceFor, resolveImobis, resolveEventSources
};
