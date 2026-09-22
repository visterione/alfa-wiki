'use strict';

/**
 * Подключения к IMAP (ver. 8.58).
 *
 * Здесь решается главное ограничение модуля. Почта сети живёт на reg.ru, и на
 * стороне хостинга есть потолок одновременных процессов на аккаунт — в их базе
 * знаний названы 36 для виртуального хостинга. Ящиков у нас около сотни, и если
 * каждому дать постоянное соединение, мы выберем лимит целиком и сломаем почту
 * не только себе, но и всем, кто ещё работает через Roundcube.
 *
 * Поэтому соединений всегда мало, они общие на все ящики и берутся по очереди.
 * Точную цифру потолка нам никто не называл, поэтому она не зашита: пул
 * начинает с двух соединений и поднимается до MAIL_MAX_CONNECTIONS только пока
 * всё идёт гладко, а на первом же отказе сервера опускается и какое-то время не
 * растёт. Нащупывать лимит снизу безопасно — мы упираемся в него одним лишним
 * соединением, а не восемью сразу.
 *
 * Возможности сервера снимаются при каждом подключении, а не настраиваются
 * руками: хостер может включить или выключить QRESYNC когда угодно, и
 * синхронизатор обязан заметить это сам.
 */

const { ImapFlow } = require('imapflow');
const { decryptPassword } = require('./crypto');
const { createPool, isCapacityRefusal } = require('./pool');

const HARD_MAX = Math.max(1, parseInt(process.env.MAIL_MAX_CONNECTIONS || '4', 10));

// Ограничитель один на процесс: слоты общие для всех ящиков, иначе сотня
// ящиков со своим лимитом «по два» дала бы двести соединений.
const pool = createPool({ hardMax: HARD_MAX, start: Math.min(2, HARD_MAX) });

/**
 * Что сервер умеет. Имена расширений приводим к понятным флагам, чтобы
 * синхронизатор не разбирался со строками CAPABILITY у себя.
 */
function describeCapabilities(client) {
  const has = (name) => client.capabilities.has(name.toUpperCase());
  return {
    condstore: has('CONDSTORE'),
    qresync: has('QRESYNC'),
    idle: has('IDLE'),
    move: has('MOVE'),
    uidplus: has('UIDPLUS'),
    specialUse: has('SPECIAL-USE'),
    compress: has('COMPRESS=DEFLATE'),
    quota: has('QUOTA'),
    sort: has('SORT'),
    // Полный список пригодится, когда что-нибудь пойдёт не так и придётся
    // объяснять, почему у одного ящика синхронизация дешёвая, а у другого нет.
    raw: [...client.capabilities.keys()].sort(),
    seenAt: new Date().toISOString(),
  };
}

function buildClient(account, password) {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure !== false,
    auth: { user: account.login || account.email, pass: password },
    // Свой лог библиотеки шумит на каждую команду; нам нужны только события
    // уровня модуля, их пишет синхронизатор.
    logger: false,
    // Сервер reg.ru закрывает простаивающие сессии сам; не ждём его молча.
    socketTimeout: 120_000,
    greetingTimeout: 30_000,
    connectionTimeout: 30_000,
    // Сжатие потока экономит заметную долю трафика на первичной заливке —
    // письма это в основном текст. Включаем, если сервер умеет.
    emitLogs: false,
  });
}

/**
 * Одна операция с ящиком: занять слот, подключиться, сделать дело, отключиться.
 * Соединения намеренно не переиспользуются между задачами — висящая сессия
 * занимает процесс на хостинге всё время своей жизни, а нам важнее отдать его
 * следующему ящику, чем сэкономить рукопожатие.
 */
async function withConnection(account, fn) {
  const password = decryptPassword(account);

  await pool.acquire();
  let client = null;
  try {
    client = buildClient(account, password);
    await client.connect();
    if (pool.noteSuccess()) console.log(`📬 Почта: потолок соединений поднят до ${pool.stats().ceiling}`);

    const capabilities = describeCapabilities(client);
    return await fn(client, capabilities);
  } catch (err) {
    if (isCapacityRefusal(err)) {
      const lowered = pool.noteRefusal(err.message || String(err));
      console.warn(
        `📬 Почта: сервер отказал в соединении (${err.message || err.code}). ` +
        (lowered ? `Потолок снижен до ${pool.stats().ceiling}.` : 'Потолок уже минимальный.')
      );
    }
    throw err;
  } finally {
    if (client) {
      // logout() может сам упасть на уже порванном соединении — тогда рвём
      // грубо. Не отпустить слот здесь значило бы застопорить весь модуль.
      try {
        await client.logout();
      } catch (e) {
        try { client.close(); } catch (e2) { /* соединения уже нет */ }
      }
    }
    pool.release();
  }
}

/**
 * Проверка ящика при заведении: пускает ли сервер и что он умеет. Возвращает
 * то, что показывается администратору в форме.
 */
async function testAccount(account) {
  const startedAt = Date.now();
  return withConnection(account, async (client, capabilities) => {
    const list = await client.list();
    return {
      ok: true,
      ms: Date.now() - startedAt,
      capabilities,
      folders: list
        .filter((f) => !f.flags.has('\\Noselect'))
        .map((f) => ({ path: f.path, name: f.name, specialUse: f.specialUse || null })),
    };
  });
}

module.exports = { withConnection, testAccount, describeCapabilities, poolStats: pool.stats, isCapacityRefusal };
