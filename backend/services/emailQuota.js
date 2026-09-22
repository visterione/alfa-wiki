'use strict';

/**
 * Суточный предел почтовых рассылок и план отправки (ver. 8.57).
 *
 * ── Зачем предел ─────────────────────────────────────────────────────────────
 *
 * Объём рассылок растёт, ящиков становится больше, и главный риск здесь не
 * технический, а репутационный: почтовые службы смотрят не на письмо, а на
 * поведение отправителя. Десять тысяч писем, ушедших с одного домена за час, —
 * это ровно та картина, по которой Gmail и Mail.ru принимают решение о домене
 * целиком, а не об одном письме. Дальше в спам падает всё, включая записи на
 * приём и восстановление пароля, и разбирать это приходится неделями.
 *
 * Поэтому рассылка, которая не помещается в сутки, не отменяется и не режется —
 * она РАСТЯГИВАЕТСЯ по дням. Человек видит план заранее и решает, устраивает ли
 * он его.
 *
 * ── Откуда взялась тысяча ────────────────────────────────────────────────────
 *
 * Жёсткого «правильного» числа не существует, есть пределы служб и практика
 * прогрева:
 *
 *   • Google Workspace: 2000 внешних получателей в сутки на ящик, через relay —
 *     больше, но с теми же оговорками про репутацию.
 *   • Яндекс 360: 500 писем в сутки на ящик у обычных тарифов.
 *   • Домен, с которого раньше почти не слали, прогревают постепенно: первые
 *     дни сотни, дальше удвоение раз в несколько дней. Выйти сразу на тысячи с
 *     холодного домена — самый надёжный способ попасть в спам-лист.
 *
 * Тысяча в сутки — это середина: заметно ниже предела любой из служб, но не
 * настолько мало, чтобы рассылка на пять тысяч растянулась на месяц. Значение
 * настраиваемое: когда ящиков станет больше, его поднимут, не трогая код.
 *
 * ── Чего здесь намеренно нет ─────────────────────────────────────────────────
 *
 * Счёта по ящикам. Сейчас рассылки уходят с одного ящика (SMTP_*_BROADCAST), и
 * предел общий. Раскладывать письма по нескольким ящикам — отдельная работа со
 * своим выбором отправителя и своими DKIM-подписями; заводить под неё структуру
 * данных заранее, не зная, как её будут настраивать, значит угадывать.
 */

const { Setting, sequelize } = require('../models');

const SETTING_KEY = 'email_daily_limit';
const DEFAULT_PER_DAY = 1000;

// Все даты плана считаются по Москве: в этом же поясе стоит «Отложить до» в
// окне составления, и разъехаться им нельзя — иначе человек назначает рассылку
// на понедельник, а в плане она оказывается в воскресенье.
const TZ = 'Europe/Moscow';

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Дата по Москве в виде YYYY-MM-DD. */
const dayKey = (date) => dayKeyFormatter.format(date);

/** Следующий день. Считаем по ключу, а не прибавлением суток к метке времени:
 *  перевода часов в России нет, но сутки всё равно надёжнее наращивать датой. */
function nextDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Суточный предел. 0 — ограничения нет. */
async function getLimit() {
  const row = await Setting.findByPk(SETTING_KEY);
  const value = row?.value;
  const perDay = Number(value?.perDay);
  if (!Number.isFinite(perDay) || perDay < 0) return DEFAULT_PER_DAY;
  return Math.floor(perDay);
}

async function setLimit(perDay) {
  const value = { perDay: Math.max(0, Math.floor(Number(perDay) || 0)) };
  await Setting.upsert({
    key: SETTING_KEY,
    value,
    description: 'Сколько писем рассылки уходит за сутки. 0 — без ограничения',
  });
  return value.perDay;
}

/**
 * Сколько писем уже занято по дням, начиная с указанной даты.
 *
 * Занятыми считаются и уже отправленные, и ещё только запланированные: план на
 * послезавтра — это обещание, и планировать поверх него нельзя.
 *
 * Отменённые и полностью провалившиеся рассылки место не занимают: в первом
 * случае писем не было, во втором они не ушли, и держать за ними сутки квоты
 * значит наказывать за чужой сбой.
 */
async function usageByDay(fromKey) {
  const rows = await sequelize.query(
    `SELECT to_char(effective AT TIME ZONE :tz, 'YYYY-MM-DD') AS day,
            SUM(CASE WHEN jsonb_typeof(recipients) = 'array'
                     THEN jsonb_array_length(recipients) ELSE 0 END)::int AS total
       FROM (
         SELECT COALESCE("scheduledAt", "sentAt", "createdAt") AS effective,
                "recipients", "status"
           FROM email_logs
       ) t
      WHERE status NOT IN ('canceled', 'failed')
        AND effective >= (:from)::timestamptz
      GROUP BY 1`,
    {
      type: sequelize.QueryTypes.SELECT,
      replacements: { tz: TZ, from: `${fromKey} 00:00:00 +03:00` },
    },
  );
  return Object.fromEntries(rows.map(r => [r.day, Number(r.total) || 0]));
}

/**
 * Раскладка писем по дням — чистый расчёт, без базы.
 *
 * Вынесен отдельно ровно ради проверяемости: здесь вся логика, из-за которой
 * рассылка может уехать не туда (день, уже занятый другой рассылкой,
 * переполненный предел, граница месяца), и щупать её через базу неудобно.
 *
 * @param {number} count   сколько писем надо отправить
 * @param {string} first   день начала, YYYY-MM-DD по Москве
 * @param {number} perDay  суточный предел; 0 — предела нет
 * @param {object} usage   { 'YYYY-MM-DD': сколько писем уже занято }
 */
function buildPlan(count, first, perDay, usage = {}) {
  if (!perDay || count <= 0) {
    return { plan: [{ date: first, count: Math.max(0, count), used: usage[first] || 0, limit: perDay }], overflow: 0 };
  }

  const plan = [];
  let rest = count;
  let day = first;

  // Предохранитель от бесконечного цикла: год — заведомо больше любого
  // осмысленного плана, и если мы в него упёрлись, дальше считать бессмысленно.
  for (let guard = 0; guard < 366 && rest > 0; guard += 1) {
    const used = usage[day] || 0;
    const free = Math.max(0, perDay - used);
    if (free > 0) {
      const take = Math.min(free, rest);
      plan.push({ date: day, count: take, used, limit: perDay });
      rest -= take;
    }
    if (rest > 0) day = nextDay(day);
  }

  // Не влезло даже за год — значит предел стоит абсурдно низким. Отдаём то, что
  // посчиталось, и отдельно говорим, сколько писем осталось без дня: молча
  // потерять их нельзя.
  return {
    plan: plan.length ? plan : [{ date: first, count: 0, used: usage[first] || 0, limit: perDay }],
    overflow: rest,
  };
}

/**
 * План отправки: по скольку писем и в какие дни уйдёт рассылка.
 *
 * Возвращает всегда хотя бы одну строку — иначе интерфейсу нечего показать, а
 * «рассылка без плана» выглядит как сбой.
 *
 * @param {number} count   сколько писем надо отправить
 * @param {Date}   startAt когда рассылка начинается
 */
async function planFor(count, startAt = new Date()) {
  const perDay = await getLimit();
  const first = dayKey(startAt);

  if (!perDay || count <= 0) return { perDay, ...buildPlan(count, first, perDay) };

  return { perDay, ...buildPlan(count, first, perDay, await usageByDay(first)) };
}

/**
 * Загруженность ближайших дней — для таблицы «план рассылки» в интерфейсе.
 */
async function calendar(days = 14, from = new Date()) {
  const perDay = await getLimit();
  const first = dayKey(from);
  const usage = await usageByDay(first);
  const out = [];
  let day = first;
  for (let i = 0; i < days; i += 1) {
    const used = usage[day] || 0;
    out.push({ date: day, used, limit: perDay, free: perDay ? Math.max(0, perDay - used) : null });
    day = nextDay(day);
  }
  return { perDay, days: out };
}

/**
 * Момент отправки порции: та же дата, что в плане, и то же время суток, что у
 * первой порции. Рассылка, начатая в 10 утра, продолжается в 10 утра — в этом
 * и состоит «расписать по дням», которое видит человек.
 */
function portionTime(dateKey, startAt) {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Время берём из момента начала по Москве, а не из UTC: иначе рассылка,
  // назначенная на 09:00 МСК, во второй день уедет на 06:00.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(startAt);
  const hh = parts.find(p => p.type === 'hour').value;
  const mm = parts.find(p => p.type === 'minute').value;
  return new Date(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${hh}:${mm}:00+03:00`);
}

module.exports = {
  SETTING_KEY,
  DEFAULT_PER_DAY,
  getLimit,
  setLimit,
  usageByDay,
  buildPlan,
  planFor,
  calendar,
  portionTime,
  dayKey,
  nextDay,
};
