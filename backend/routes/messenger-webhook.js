'use strict';

/**
 * Приёмник входящих от наших ботов (ver. 7.84).
 *
 * Адрес открыт наружу без авторизации — иначе Telegram до него не достучится.
 * Подлинность проверяем секретом, который платформа кладёт в заголовок: он задан
 * при setWebhook и известен только ей и нам.
 *
 * Отвечаем 200 сразу и разбираем обновление уже после ответа. Причина в том, как
 * устроены повторы: платформа считает доставку удавшейся по коду ответа, и если
 * тянуть с ним, пока мы ходим в МИС, она успеет прислать то же обновление ещё
 * раз — человек получит дубль.
 */

const express = require('express');
const { MessengerBot, BotSubscriber } = require('../models');
const { getChannel } = require('../services/messengers');
const dialog = require('../services/messengers/dialog');

const router = express.Router();

// Ботов немного (по два на медцентр), а обновления идут потоком — держим их в
// памяти, чтобы не ходить в базу на каждое сообщение.
const botCache = new Map(); // id -> { bot, at }
const CACHE_TTL = 60000;

async function loadBot(id) {
  const hit = botCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.bot;

  const bot = await MessengerBot.findByPk(id);
  botCache.set(id, { bot, at: Date.now() });
  return bot;
}

function forgetBot(id) {
  botCache.delete(id);
}

/**
 * Отметить подписчика заблокировавшим бота. Дальше каскад увидит признак и
 * сразу уйдёт на SMS, не тратя попытку на закрытый канал.
 */
async function markBlocked(bot, chatId) {
  await BotSubscriber.update(
    { isBlocked: true, blockedAt: new Date() },
    { where: { platform: bot.platform, organization: bot.organization, externalUserId: String(chatId) } }
  );
}

router.post('/:platform/:botId', async (req, res) => {
  const { platform, botId } = req.params;

  let bot;
  try {
    bot = await loadBot(botId);
  } catch (err) {
    console.error('[messenger-webhook] чтение бота:', err.message);
    return res.sendStatus(500);
  }

  if (!bot || !bot.isActive || bot.platform !== platform) return res.sendStatus(404);

  const secret = req.get('X-Telegram-Bot-Api-Secret-Token') || req.get('X-Bot-Secret');
  if (secret !== bot.webhookSecret) {
    console.warn(`[messenger-webhook] неверный секрет для бота ${bot.username || bot.id}`);
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  const body = req.body;
  setImmediate(async () => {
    try {
      const channel = getChannel(platform);
      const update = channel.parseUpdate(body);
      if (!update) return;

      await dialog.handleUpdate(channel, bot, update);
    } catch (err) {
      if (err.name === 'ChannelError' && err.code === 'blocked') {
        const chatId = body.message ? body.message.chat.id : null;
        if (chatId) await markBlocked(bot, chatId).catch(() => {});
        return;
      }
      console.error(`[messenger-webhook] ${platform}/${bot.username || bot.id}:`, err.message);
    }
  });
});

module.exports = router;
module.exports.forgetBot = forgetBot;
