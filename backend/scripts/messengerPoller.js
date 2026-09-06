'use strict';

/**
 * Самостоятельный забор входящих от ботов (ver. 7.84).
 *
 * Второй способ доставки, наравне с вебхуком. Понадобился он не от хорошей
 * жизни: 06.09.2026 проверено, что с боевого сервера api.telegram.org отвечает
 * за 0.26 с, а вот обратно — обновления от подсетей Telegram до нас не доходят.
 * Открывать нечего: ufw выключен, снаружи адрес отвечает и с ноутбука, и с
 * самого сервера, режет выше по маршруту. Поэтому ходим за обновлениями сами —
 * тем каналом, который работает.
 *
 * Это не опрос по таймеру: запрос висит открытым до тридцати секунд и
 * возвращается сразу, как появилось сообщение. Задержка получается почти как у
 * вебхука, а запросов — пара в минуту на бота.
 *
 * Отдельным процессом, а не внутри портала, намеренно: висящее соединение и
 * разбор чужих сообщений не должны иметь возможности уронить вики. Ту же цену
 * мы однажды уже заплатили на синхронизации цен партнёров.
 *
 * Запуск:
 *   node scripts/messengerPoller.js          все боты в режиме polling
 *   pm2 start ecosystem.config.js --only alfa-wiki-poller
 */

require('dotenv').config();

const { sequelize, MessengerBot } = require('../models');
const { getChannel } = require('../services/messengers');
const dialog = require('../services/messengers/dialog');

const LONG_POLL_SEC = 30;
const RELOAD_BOTS_MS = 60000;   // как часто перечитываем список ботов из базы
const ERROR_BACKOFF_MS = 5000;

let stopping = false;
const running = new Map(); // botId -> Promise

/**
 * Один бот — один бесконечный цикл. Курсор храним в базе: после перезапуска
 * забор продолжится с того же места, а разобранное не придёт повторно.
 */
async function pollBot(botId) {
  while (!stopping) {
    let bot;
    try {
      bot = await MessengerBot.findByPk(botId);
    } catch (err) {
      console.error(`[poller] чтение бота ${botId}:`, err.message);
      await pause(ERROR_BACKOFF_MS);
      continue;
    }

    if (!bot || !bot.isActive || bot.deliveryMode !== 'polling') {
      console.log(`[poller] бот ${botId} больше не в режиме забора — цикл остановлен`);
      running.delete(botId);
      return;
    }

    const channel = getChannel(bot.platform);

    try {
      const offset = Number(bot.lastUpdateId) > 0 ? Number(bot.lastUpdateId) + 1 : undefined;
      const updates = await channel.getUpdates(bot.token, offset, LONG_POLL_SEC);

      if (!updates.length) continue;

      for (const raw of updates) {
        try {
          const update = channel.parseUpdate(raw);
          if (update) await dialog.handleUpdate(channel, bot, update);
        } catch (err) {
          // Одно кривое сообщение не должно останавливать разбор остальных и уж
          // тем более — весь цикл: иначе бот замолчит для всех.
          console.error(`[poller] обновление ${raw.update_id}:`, err.message);
        }
        // Курсор двигаем после каждого обновления, а не пачкой. Если процесс
        // упадёт посередине, повторно придёт только необработанный хвост.
        await bot.update({ lastUpdateId: raw.update_id });
      }
    } catch (err) {
      // ChannelError('network') на долгом ожидании — обычное дело: соединение
      // могло закрыться по таймауту. Пауза и заново.
      const quiet = err.name === 'ChannelError' && err.code === 'network';
      if (!quiet) console.error(`[poller] @${bot.username}:`, err.message);
      await pause(err.retryAfter ? err.retryAfter * 1000 : ERROR_BACKOFF_MS);
    }
  }
}

function pause(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Подхватывает ботов, у которых включён режим забора, и поднимает на каждого
 * свой цикл. Список перечитывается — добавленный бот заводится сам, без
 * перезапуска процесса.
 */
async function syncBots() {
  const bots = await MessengerBot.findAll({ where: { isActive: true, deliveryMode: 'polling' } });

  for (const bot of bots) {
    if (running.has(bot.id)) continue;
    console.log(`[poller] беру обновления для @${bot.username} (${bot.platform}/${bot.organization})`);
    running.set(bot.id, pollBot(bot.id).catch(err => {
      console.error(`[poller] цикл @${bot.username} завершился:`, err.message);
      running.delete(bot.id);
    }));
  }

  if (!bots.length && !running.size) {
    console.log('[poller] ботов в режиме забора нет — жду');
  }
}

async function main() {
  console.log('[poller] запуск');

  await syncBots();
  const timer = setInterval(() => syncBots().catch(err => console.error('[poller] обновление списка:', err.message)), RELOAD_BOTS_MS);

  const shutdown = async (signal) => {
    console.log(`[poller] ${signal} — останавливаюсь`);
    stopping = true;
    clearInterval(timer);
    // Даём висящим запросам закрыться, но не ждём вечно: pm2 всё равно убьёт.
    await Promise.race([Promise.all(running.values()), pause(5000)]);
    await sequelize.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('[poller] не поднялся:', err.message);
  process.exit(1);
});
