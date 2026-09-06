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
const DEFAULT_CASCADE = ['bot', 'notify+vk', 'sms+webchat'];

// Имобис напрямую. Имя отправителя придумать нельзя — оно проходит модерацию у
// операторов, поэтому берётся из аккаунта (npm run imobis:check) и вписывается
// сюда. Группа ВК нужна каналу vk: без неё ступень собрать не из чего.
const DEFAULT_IMOBIS = {
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
    const provider = step === 'bot' ? 'bot' : (step.startsWith('imobis:') ? 'imobis' : 'fromni');
    const name = step.startsWith('imobis:') ? step.slice('imobis:'.length) : step;

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
  DEFAULT_CASCADE, DEFAULT_QUIET, DEFAULT_IMOBIS,
  cascade, quietHours, imobis, groupSteps, read, write,
  isQuiet, nextAllowed, quietFor, minutesOf
};
