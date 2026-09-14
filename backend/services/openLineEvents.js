'use strict';

/**
 * Сигналы открытой линии операторам (ver. 8.27).
 *
 * До этого модуль жил одним опросом: список обращений перечитывался раз в пять
 * секунд, а в свёрнутой вкладке не перечитывался вовсе (ver. 8.10, сделано
 * ради нагрузки). Из этого выходило неприятное: оператор, у которого портал
 * лежит в соседней вкладке — а он там лежит всю смену, — узнавал о новом
 * обращении только вернувшись к нему сам. Сигнал решает ровно это; опрос
 * остаётся, но редкий и как подстраховка.
 *
 * ── Почему через Postgres, а не просто io.emit ────────────────────────────
 *
 * Входящее от пациента появляется не в портале, а в отдельном процессе забора
 * обновлений (scripts/messengerPoller.js): висящее соединение с Telegram и
 * разбор чужих сообщений намеренно вынесены из веб-процесса. Сокета у него нет
 * и быть не должно. Redis-адаптер Socket.IO для этого не годится: он
 * необязателен (SOCKET_IO_REDIS_URL может быть не задан, и на бою не задан), а
 * сигнал работать обязан.
 *
 * Поэтому мост — NOTIFY/LISTEN в той же базе, куда оба процесса и так ходят.
 * Новой зависимости не появляется, настраивать нечего.
 *
 * Веб-процесс при этом шлёт себе напрямую, минуя базу: у него io под рукой, и
 * гонять собственное нажатие «взять обращение» через Postgres было бы лишним
 * кругом и лишней точкой отказа.
 */

const { Client } = require('pg');
const { OmniLineOperator, sequelize } = require('../models');

// Имя канала NOTIFY. Одно на модуль: разбирать события по каналам смысла нет,
// их два, и оба уходят одному и тому же слушателю.
const CHANNEL = 'openline';

// Через сколько пробуем переподключить слушателя. База может уйти на
// перезапуск, и без повтора портал молча останется без сигналов до следующего
// перезапуска самого портала.
const RECONNECT_MS = 5000;

let listenClient = null;
let reconnectTimer = null;

/**
 * Кому это событие интересно: все, кто сейчас на смене на линии обращения, плюс
 * исполнитель.
 *
 * Исполнитель добавляется отдельно не для порядка: смену он мог уже закончить —
 * тогда обращение вернулось в очередь, но чат у него на экране ещё открыт, и
 * увидеть, что оно ушло, он должен.
 *
 * @param {Object} conversation  обращение (нужны lineId и assigneeUserId)
 * @param {string[]} [also]  кого добавить сверх состава смены (например того,
 *   у кого чат только что забрали передачей)
 */
async function recipients(conversation, also = []) {
  const rows = await OmniLineOperator.findAll({
    where: { lineId: conversation.lineId, onShift: true },
    attributes: ['userId']
  });

  const ids = new Set(rows.map(r => r.userId));
  if (conversation.assigneeUserId) ids.add(conversation.assigneeUserId);
  also.filter(Boolean).forEach(id => ids.add(id));
  return [...ids];
}

/**
 * Разослать сигнал. Никогда не бросает: сигнал — это удобство поверх опроса, и
 * уронить из-за него приём сообщения от пациента было бы обменом дурным.
 *
 * @param {Object|null} io  сокет-сервер, если мы в веб-процессе
 */
async function publish(io, userIds, event, payload) {
  if (!userIds.length) return;

  try {
    if (io) {
      userIds.forEach(userId => io.to(`user:${userId}`).emit(event, payload));
      return;
    }
    await sequelize.query('SELECT pg_notify($1, $2)', {
      bind: [CHANNEL, JSON.stringify({ userIds, event, payload })]
    });
  } catch (err) {
    console.error('[open-line] сигнал не ушёл:', err.message);
  }
}

/**
 * Слушать сигналы от процесса забора обновлений и раздавать их по сокетам.
 * Вызывается один раз при старте портала.
 */
function listen(io) {
  if (listenClient) return;

  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  listenClient = client;

  const retry = () => {
    if (listenClient !== client) return;   // уже переподключились
    listenClient = null;
    try { client.end(); } catch (_) { /* соединение и так мертво */ }
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => { reconnectTimer = null; listen(io); }, RECONNECT_MS);
    }
  };

  client.on('error', (err) => {
    console.error('[open-line] слушатель сигналов отвалился:', err.message);
    retry();
  });
  client.on('end', retry);

  client.on('notification', (msg) => {
    try {
      const { userIds, event, payload } = JSON.parse(msg.payload);
      (userIds || []).forEach(userId => io.to(`user:${userId}`).emit(event, payload));
    } catch (err) {
      console.error('[open-line] негодный сигнал:', err.message);
    }
  });

  client.connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    .then(() => console.log('✅ Открытая линия: сигналы от ботов подключены'))
    .catch((err) => {
      console.error('[open-line] не удалось подключить слушателя:', err.message);
      retry();
    });
}

async function stopListening() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const client = listenClient;
  listenClient = null;
  if (client) {
    try { await client.end(); } catch (_) { /* закрываем на выходе, жаловаться некому */ }
  }
}

module.exports = { CHANNEL, recipients, publish, listen, stopListening };
