'use strict';

/**
 * Счета Имобиса: расходы, подсказка суммы, выписка (ver. 9.33).
 *
 * Режим ручной — так решил заказчик. Сначала обсуждали автоматические счета по
 * понедельникам, но сумму пополнения человек всё равно хочет видеть и решать
 * сам: в неделю с большой рассылкой расход не похож на средний, и знает об этом
 * он, а не формула. Поэтому сервер считает и подсказывает, а выписывает только
 * то, что вписали руками. Вся тяжесть, которую сняли, — обход шести кабинетов.
 *
 * ПОДСКАЗКА СУММЫ. Счёт выписывают в понедельник, бухгалтерия оплачивает его в
 * среднем через 3–4 дня. Значит, деньги этого счёта должны дотянуть не до его
 * оплаты, а до оплаты СЛЕДУЮЩЕГО: неделя цикла плюс четыре дня задержки, то есть
 * 11 дней от понедельника. Считать только 4 дня — первое, что приходит в голову,
 * и через неделю это оставляет счёт пустым ровно на те дни, пока бухгалтерия
 * платит новый. Сверху 20% на непредвиденное — просьба заказчика: кончившиеся
 * деньги означают вставшие SMS. Из нужного вычитаются остаток и неоплаченные
 * счета этой недели — они уже в пути.
 *
 * Горизонт считается от сегодняшнего дня, а не всегда 11: счёт, выписанный в
 * четверг, должен дотянуть до оплаты понедельничного, и 11 дней от четверга
 * переплатили бы три.
 */

const { Op } = require('sequelize');
const {
  sequelize, MedCenter, NotifBranchSettings, ImobisSpendDay, ImobisInvoice, Setting
} = require('../models');
const cabinet = require('./imobisCabinet');
const imobis = require('./messengers/imobis');
const mailCrypto = require('./mail/crypto');

const PAY_LAG_DAYS = 4;      // от выписки до оплаты бухгалтерией, с запасом
const RESERVE = 0.2;         // на непредвиденное
const ROUND_TO = 1000;       // счёт на 18 000, а не на 17 342,18
const AVG_WINDOW = 28;       // четыре полные недели: будни и выходные поровну
const RESYNC_DAYS = 3;       // последние дни отчёта у Имобиса ещё дописываются
const KEEP_DAYS = 120;       // графику нужен месяц-два, больше не храним
const MIN_AMOUNT = 100;
const MAX_AMOUNT = 1000000;

const SYNC_KEY = 'imobis_billing_sync';

// ── Даты по Москве ────────────────────────────────────────────────────────
//
// Сутки отчёта Имобиса — московские, и неделя у бухгалтерии тоже. Сервер при
// этом может жить в UTC, поэтому «сегодня» никогда не берётся из new Date().

const mskDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 — воскресенье
const weekStart = (day) => addDays(day, -((weekday(day) + 6) % 7));
const daysToNextMonday = (day) => ((8 - weekday(day)) % 7) || 7;
const prevMonthStart = (day) => {
  const [y, m] = day.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
};
const mskMidnight = (day) => new Date(`${day}T00:00:00+03:00`);

/**
 * Сколько выписать. Чистая функция — ради тестов и чтобы формула жила в одном
 * месте: интерфейс показывает её итог, а не повторяет её.
 */
function recommend({ balance, avgDaily, unpaid = 0, today }) {
  if (avgDaily == null || balance == null) return null;
  const horizon = daysToNextMonday(today) + PAY_LAG_DAYS;
  const need = avgDaily * horizon * (1 + RESERVE);
  const amount = Math.max(0, Math.ceil((need - balance - unpaid) / ROUND_TO) * ROUND_TO);
  return { amount, horizon, need: Math.round(need) };
}

// ── Учётные записи ────────────────────────────────────────────────────────

/**
 * Пароль кабинета шифруется ключом почтового модуля (MAIL_SECRET_KEY). Токен
 * API рядом лежит открытым текстом намеренно (см. settings.js), но пароль —
 * другое: он открывает кабинет целиком, с реквизитами плательщика и
 * пользователями, и часто совпадает с тем, что человек держит в голове. Довод
 * «шифрование потребует нового ключа в .env» к нему уже не относится: ключ
 * завёлся вместе с почтой в 8.58.
 */
function encryptCabinetPassword(plain) {
  return mailCrypto.encryptPassword(plain);
}

function cabinetPassword(cabinetConfig) {
  if (!cabinetConfig || !cabinetConfig.passwordEnc) return null;
  return mailCrypto.decryptPassword(cabinetConfig);
}

/** Филиалы, у которых есть хоть что-то от Имобиса: токен или вход в кабинет. */
async function accounts() {
  const medCenters = await MedCenter.findAll({
    attributes: ['id', 'name', 'color'],
    where: { servesPatients: true },
    order: [['name', 'ASC']]
  });
  const rows = await NotifBranchSettings.findAll({ attributes: ['medCenterId', 'imobis'] });
  const byId = new Map(rows.map(r => [r.medCenterId, r.imobis || {}]));

  return medCenters
    .map(mc => {
      const own = byId.get(mc.id) || {};
      const cab = own.cabinet || {};
      return {
        medCenterId: mc.id,
        name: mc.name,
        color: mc.color || null,
        token: own.token || '',
        sandbox: !!own.sandbox,
        login: cab.login || '',
        cabinet: cab
      };
    })
    .filter(a => a.token || a.login);
}

// ── Состояние фоновых работ ──────────────────────────────────────────────
//
// Процесс один (pm2 fork), поэтому «что сейчас идёт» держим в памяти. Итог
// последней синхронизации пишется в settings: после перезапуска вкладка должна
// показывать, когда расходы обновлялись и что не получилось.

const running = { sync: false, invoices: false };
const jobs = new Map(); // medCenterId → { state, error, number }

async function readSyncLog() {
  const row = await Setting.findByPk(SYNC_KEY);
  return (row && row.value) || {};
}

async function writeSyncLog(patch) {
  const current = await readSyncLog();
  await Setting.upsert({
    key: SYNC_KEY,
    value: { ...current, ...patch },
    description: 'Итог последнего обхода кабинетов Имобиса по филиалам (ver. 9.33)'
  });
}

// ── Синхронизация расходов и статусов ─────────────────────────────────────

async function syncAccount(account, today) {
  const password = cabinetPassword(account.cabinet);
  const session = await cabinet.open(account.login, password);
  const yesterday = addDays(today, -1);

  // Первый обход забирает с начала прошлого месяца — заказчику этого хватает,
  // чтобы видеть расход сразу, а не копить его неделями. Дальше — последние дни
  // заново: отчёт у Имобиса дописывается по мере прихода статусов доставки.
  const last = await ImobisSpendDay.max('day', { where: { medCenterId: account.medCenterId } });
  const from = last ? addDays(String(last).slice(0, 10), -RESYNC_DAYS) : prevMonthStart(today);

  if (from <= yesterday) {
    const days = await session.spendReport(from, yesterday);
    const rows = [];
    for (let d = from; d <= yesterday; d = addDays(d, 1)) {
      const v = days[d];
      // Нулевой день тоже строка: «расхода не было» и «не забирали» на графике
      // и в среднем — разные вещи.
      rows.push({
        medCenterId: account.medCenterId,
        day: d,
        cost: v ? v.cost : 0,
        messages: v ? v.messages : 0,
        byOperator: v ? v.operators : null
      });
    }
    await sequelize.transaction(async (transaction) => {
      await ImobisSpendDay.destroy({
        where: { medCenterId: account.medCenterId, day: { [Op.between]: [from, yesterday] } },
        transaction
      });
      await ImobisSpendDay.bulkCreate(rows, { transaction });
    });
  }

  // Статус оплаты счетов этой недели — из списка платежей кабинета. Отметку
  // «оплачен» руками не ведём: бухгалтерия о ней не знает, а кабинет знает.
  const invoices = await ImobisInvoice.findAll({
    attributes: ['id', 'number', 'paid', 'statusText'],
    where: { medCenterId: account.medCenterId, createdAt: { [Op.gte]: mskMidnight(weekStart(today)) } }
  });
  if (invoices.length) {
    const list = await session.payments(addDays(weekStart(today), -1), today);
    const byNumber = new Map(list.map(p => [p.number, p]));
    for (const inv of invoices) {
      const p = byNumber.get(inv.number);
      if (p && (p.paid !== inv.paid || p.status !== inv.statusText)) {
        await inv.update({ paid: p.paid, statusText: p.status || null });
      }
    }
  }
}

/**
 * Обойти все кабинеты: расходы, статусы счетов, уборка. Ошибка одного аккаунта
 * не останавливает остальные — пароль, сменённый в одном медцентре, не повод
 * оставить без графика все шесть.
 */
async function syncAll() {
  if (running.sync) return { started: false };
  running.sync = true;
  const today = mskDay();
  const log = {};
  try {
    await cleanup(today);
    for (const account of await accounts()) {
      if (!account.login || !account.cabinet.passwordEnc) continue;
      try {
        await syncAccount(account, today);
        log[account.medCenterId] = { at: new Date().toISOString(), ok: true };
      } catch (err) {
        console.error(`[imobisBilling] ${account.name}:`, err.message);
        log[account.medCenterId] = { at: new Date().toISOString(), ok: false, error: err.message };
      }
    }
    await writeSyncLog(log);
    return { started: true, log };
  } finally {
    running.sync = false;
  }
}

/** Счета прошлых недель и расходы старше KEEP_DAYS. */
async function cleanup(today = mskDay()) {
  await ImobisInvoice.destroy({ where: { createdAt: { [Op.lt]: mskMidnight(weekStart(today)) } } });
  await ImobisSpendDay.destroy({ where: { day: { [Op.lt]: addDays(today, -KEEP_DAYS) } } });
}

// ── Выписка счетов ────────────────────────────────────────────────────────

function validateItems(items, known) {
  const clean = [];
  for (const item of Array.isArray(items) ? items : []) {
    const amount = Math.round(Number(item && item.amount));
    if (!item || !known.has(item.medCenterId)) continue;
    if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      throw new Error(`Сумма счёта должна быть от ${MIN_AMOUNT} до ${MAX_AMOUNT.toLocaleString('ru-RU')} ₽`);
    }
    clean.push({ medCenterId: item.medCenterId, amount });
  }
  return clean;
}

/**
 * Запускает выписку и сразу возвращается: шесть кабинетов по очереди — это
 * полминуты, и держать на них HTTP-запрос значит упереться в таймаут nginx.
 * Ход работы вкладка видит в overview().
 */
async function startInvoices(items, userId) {
  if (running.invoices) throw Object.assign(new Error('Счета уже выписываются'), { status: 409 });

  const all = await accounts();
  const byId = new Map(all.map(a => [a.medCenterId, a]));
  const clean = validateItems(items, new Set(all.filter(a => a.login && a.cabinet.passwordEnc).map(a => a.medCenterId)));
  if (!clean.length) throw Object.assign(new Error('Не вписано ни одной суммы'), { status: 400 });

  running.invoices = true;
  // Итоги прошлого запуска стираем: «ошибка» под карточкой, которую в этот раз
  // не выписывали, читалась бы как свежая.
  jobs.clear();
  for (const item of clean) jobs.set(item.medCenterId, { state: 'queued' });

  (async () => {
    try {
      for (const item of clean) {
        const account = byId.get(item.medCenterId);
        jobs.set(item.medCenterId, { state: 'running' });
        try {
          const session = await cabinet.open(account.login, cabinetPassword(account.cabinet));
          const made = await session.createInvoice(item.amount);
          await ImobisInvoice.create({
            medCenterId: item.medCenterId,
            number: made.number,
            amount: item.amount,
            payer: made.payer,
            pdf: made.pdf,
            createdBy: userId || null
          });
          jobs.set(item.medCenterId, { state: 'done', number: made.number });
        } catch (err) {
          console.error(`[imobisBilling] счёт ${account.name}:`, err.message);
          jobs.set(item.medCenterId, { state: 'error', error: err.message });
        }
      }
    } finally {
      running.invoices = false;
    }
  })();

  return { queued: clean.length };
}

// ── Сводка для вкладки ────────────────────────────────────────────────────

async function overview() {
  const today = mskDay();
  await cleanup(today);

  const all = await accounts();
  const from = prevMonthStart(today);
  const yesterday = addDays(today, -1);
  const windowFrom = addDays(yesterday, -(AVG_WINDOW - 1));

  const [spend, invoices, syncLog] = await Promise.all([
    ImobisSpendDay.findAll({
      attributes: ['medCenterId', 'day', 'cost', 'messages'],
      where: { day: { [Op.gte]: from } },
      order: [['day', 'ASC']],
      raw: true
    }),
    ImobisInvoice.findAll({
      attributes: { exclude: ['pdf'] },
      order: [['createdAt', 'DESC']],
      raw: true
    }),
    readSyncLog()
  ]);

  // Остаток — у API, по токену; кабинет за ним не нужен. Спрашиваем все шесть
  // разом: вкладку открывают ради этой цифры.
  const balances = await Promise.all(all.map(async (a) => {
    if (!a.token) return { error: 'не задан токен API' };
    try {
      return { value: imobis.balanceValue(await imobis.balance(null, a.sandbox, a.token)) };
    } catch (err) {
      return { error: err.message };
    }
  }));

  const branches = all.map((a, i) => {
    const days = spend.filter(s => s.medCenterId === a.medCenterId);
    const window = days.filter(s => s.day >= windowFrom && s.day <= yesterday);
    const avgDaily = window.length
      ? Math.round(window.reduce((sum, s) => sum + Number(s.cost), 0) / window.length * 100) / 100
      : null;
    const own = invoices.filter(inv => inv.medCenterId === a.medCenterId);
    const unpaid = own.filter(inv => !inv.paid).reduce((sum, inv) => sum + Number(inv.amount), 0);
    const balance = balances[i].value ?? null;

    return {
      medCenterId: a.medCenterId,
      name: a.name,
      color: a.color,
      login: a.login,
      cabinetReady: !!(a.login && a.cabinet.passwordEnc),
      balance,
      balanceError: balances[i].error || null,
      avgDaily,
      avgDays: window.length,
      daysLeft: balance != null && avgDaily ? Math.floor(balance / avgDaily * 10) / 10 : null,
      unpaid,
      recommendation: recommend({ balance, avgDaily, unpaid, today }),
      days: days.map(s => ({ day: s.day, cost: Number(s.cost), messages: s.messages })),
      invoices: own.map(inv => ({
        id: inv.id,
        number: inv.number,
        amount: Number(inv.amount),
        payer: inv.payer,
        paid: inv.paid,
        statusText: inv.statusText,
        createdAt: inv.createdAt
      })),
      job: jobs.get(a.medCenterId) || null,
      sync: syncLog[a.medCenterId] || null
    };
  });

  return {
    today,
    weekStart: weekStart(today),
    from,
    rules: { payLagDays: PAY_LAG_DAYS, reserve: RESERVE, roundTo: ROUND_TO, avgWindow: AVG_WINDOW },
    running: { ...running },
    branches
  };
}

async function invoicePdf(id) {
  return ImobisInvoice.findByPk(id, { attributes: ['id', 'number', 'pdf'] });
}

module.exports = {
  overview,
  syncAll,
  startInvoices,
  invoicePdf,
  encryptCabinetPassword,
  isSyncRunning: () => running.sync,
  // для тестов
  recommend,
  weekStart,
  daysToNextMonday,
  prevMonthStart,
  addDays,
  mskDay
};
