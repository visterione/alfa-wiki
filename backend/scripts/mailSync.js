#!/usr/bin/env node
'use strict';

/**
 * Рабочий процесс почты (ver. 8.58).
 *
 * Отдельным процессом, а не внутри портала, и это не вкусовщина. Соединения с
 * чужим сервером висят открытыми, разбор писем из архива десятилетней давности
 * упирается в кривые кодировки и обрезанные вложения, а первичная заливка
 * работает сутками. Ни одно из этих занятий не должно иметь возможности уронить
 * вики — и наоборот, перезапуск вики не должен ронять заливку на середине.
 *
 * Порядок работы в цикле такой: сначала по всем ящикам проходим за конвертами —
 * это быстро и даёт людям свежий список писем. Остаток времени до следующего
 * круга тратим на тела, забирая их по кругу у всех ящиков, где они ещё не
 * скачаны. Так ящик с пятью тысячами писем не задерживает остальные: он просто
 * получает свою долю в каждом круге.
 *
 * Запуск из каталога backend:
 *
 *   npm run mail:sync                     цикл (так и держать на бою)
 *   npm run mail:sync -- --once           один проход и выход
 *   npm run mail:sync -- --account info@alfa.ru
 *   npm run mail:sync -- --bodies         только докачка тел
 *
 * Интервал круга — MAIL_SYNC_INTERVAL в секундах, по умолчанию 180.
 */

require('dotenv').config();

const { sequelize, MailAccount } = require('../models');
const { syncAccount, fetchBodies } = require('../services/mail/sync');
const { drainFlagOps, cleanupFlagOps } = require('../services/mail/flags');
const { assertKeyUsable } = require('../services/mail/crypto');
const { poolStats } = require('../services/mail/imap');

sequelize.options.logging = false;

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const INTERVAL_MS = Math.max(30, parseInt(process.env.MAIL_SYNC_INTERVAL || '180', 10)) * 1000;
// Сколько писем забирать телами за один заход к ящику. Полсотни — чтобы круг по
// ящикам оставался живым: при большей порции один ящик занимает соединение
// слишком надолго.
const BODY_BATCH = Math.max(1, parseInt(process.env.MAIL_BODY_BATCH || '50', 10));

let stopping = false;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Старый PDF-парсер, который нужен для поиска внутри документов, иногда
// выпускает поздний rejected Promise на повреждённых шрифтах/flate-потоках.
// Его основной Promise уже перехватывается extractText(), но этот хвост живёт
// отдельно от него. В Node 18 такой отказ без обработчика завершает процесс
// синхронизации целиком. Для воркера это недопустимо: одно битое вложение не
// должно останавливать остальные ящики и следующий круг.
process.on('unhandledRejection', (reason) => {
  const message = reason?.message || String(reason || 'неизвестная ошибка');
  log(`вложение пропущено из-за ошибки фонового разбора: ${message}`);
});

async function activeAccounts() {
  const only = flagValue('account');
  const where = { isActive: true };
  if (only && only !== true) {
    const key = String(only);
    if (/^[0-9a-f-]{36}$/i.test(key)) where.id = key;
    else where.email = key.toLowerCase();
  }
  return MailAccount.findAll({ where, order: [['sortOrder', 'ASC'], ['email', 'ASC']], attributes: ['id', 'email'] });
}

/** Проход за конвертами по всем ящикам. Ошибка одного не останавливает круг. */
async function envelopePass(accounts) {
  for (const account of accounts) {
    if (stopping) return;
    try {
      const result = await syncAccount(account.id);
      if (result.skipped) continue;
      if (result.fetched) {
        log(`${account.email}: +${result.fetched} писем, состояние «${result.state}», без тела ${result.pendingBodies}`);
      }
    } catch (err) {
      // Один недоступный ящик — обычное дело: сменили пароль, хостинг отказал
      // в соединении. Остальные девяносто девять должны продолжать работать.
      log(`${account.email}: не синхронизировался — ${err.message}`);
    }
  }
}

/**
 * Докачка тел по кругу, пока не истекло время до следующего прохода. Круг, а
 * не «добить один ящик до конца», — иначе свежие письма в остальных ящиках
 * остались бы без тела на всё время заливки архива.
 */
async function bodyPass(accounts, deadline) {
  let working = accounts.map((a) => ({ id: a.id, email: a.email }));

  while (working.length && Date.now() < deadline && !stopping) {
    const next = [];
    for (const account of working) {
      if (stopping || Date.now() >= deadline) break;
      try {
        const { done, left } = await fetchBodies(account.id, BODY_BATCH);
        if (done) log(`${account.email}: тела +${done}, осталось ${left}`);
        // Ящик выбывает из круга, когда качать больше нечего.
        if (done > 0 && left > 0) next.push(account);
      } catch (err) {
        log(`${account.email}: тела не качаются — ${err.message}`);
      }
    }
    working = next;
  }
}

async function cycle() {
  const accounts = await activeAccounts();
  if (!accounts.length) {
    log('Активных ящиков нет. Завести: npm run mail:account -- --add …');
    return;
  }

  const deadline = Date.now() + INTERVAL_MS;

  // Сначала отдаём серверу свои отметки, и только потом забираем его состояние.
  // Наоборот нельзя: синхронизация вернула бы прежний флаг и отменила действие
  // человека у него на глазах — он нажал «прочитано», а письмо через минуту
  // снова непрочитано.
  try {
    const { pushed } = await drainFlagOps();
    if (pushed) log(`отметок доставлено на сервер: ${pushed}`);
  } catch (err) {
    log(`очередь отметок не разгреблась — ${err.message}`);
  }

  if (!args.includes('--bodies')) await envelopePass(accounts);
  if (!args.includes('--envelopes')) await bodyPass(accounts, deadline);

  // Выполненные операции старше недели очереди не нужны.
  await cleanupFlagOps().catch(() => {});

  const pool = poolStats();
  if (pool.lastRefusal) {
    log(`Соединений: потолок ${pool.ceiling} из ${pool.hardMax}. Последний отказ сервера: ${pool.lastRefusal}`);
  }

  return deadline;
}

async function main() {
  // Ключ проверяем до первого подключения: обнаружить его нехватку посреди
  // рабочего дня на живом ящике — худший момент из возможных.
  assertKeyUsable();

  if (args.includes('--once') || flagValue('account')) {
    await cycle();
    return;
  }

  log(`Почта: цикл запущен, круг каждые ${INTERVAL_MS / 1000} с, порция тел ${BODY_BATCH}`);

  while (!stopping) {
    const deadline = await cycle();
    const wait = Math.max(1000, (deadline || Date.now()) - Date.now());
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log('Останавливаюсь: доделываю текущее письмо и выхожу');
  });
}

main()
  .then(async () => {
    await sequelize.close();
    log('Почта: процесс завершён');
  })
  .catch(async (err) => {
    console.error(`Почта: процесс упал — ${err.message}`);
    console.error(err.stack);
    await sequelize.close();
    process.exit(1);
  });
