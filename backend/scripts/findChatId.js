#!/usr/bin/env node
'use strict';

/**
 * Показывает групповые чаты с их ID — для настройки доставки заявок публичного API.
 *
 * Запуск:
 *   node scripts/findChatId.js              все групповые чаты
 *   node scripts/findChatId.js заявки       только чаты, в названии которых есть «заявки»
 *
 * Для каждого чата печатает UUID (его и нужно вписать в .env), целочисленный ID
 * и список ботов-участников — чтобы сразу видеть, добавлен бот в чат или нет.
 */

const { Op } = require('sequelize');
const { sequelize, Chat, ChatMember, User, BotToken } = require('../models');
const botWebhookService = require('../services/botWebhookService');

sequelize.options.logging = false;

async function main() {
  const filter = process.argv.slice(2).join(' ').trim();

  await sequelize.authenticate();

  const chats = await Chat.findAll({
    where: {
      type: 'group',
      ...(filter ? { name: { [Op.iLike]: `%${filter}%` } } : {})
    },
    order: [['createdAt', 'DESC']],
    limit: 30
  });

  if (chats.length === 0) {
    console.log('');
    console.log(filter
      ? `Групповых чатов с «${filter}» в названии не найдено.`
      : 'Групповых чатов нет.');
    console.log('');
    return;
  }

  console.log('');
  console.log(`Найдено групповых чатов: ${chats.length}`);
  console.log('');

  for (const chat of chats) {
    const members = await ChatMember.findAll({
      where: { chatId: chat.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'isBot'] }]
    });

    const bots    = members.filter(m => m.user?.isBot);
    const humans  = members.length - bots.length;
    const intId   = await botWebhookService.getChatIntId(chat.id, chat.type);

    console.log(`  ${chat.name}`);
    console.log(`     UUID:      ${chat.id}`);
    console.log(`     chat_id:   ${intId}`);
    console.log(`     участники: ${humans} чел.${bots.length ? `, боты: ${bots.map(b => '@' + b.user.username).join(', ')}` : ', ботов нет'}`);
    console.log('');
  }

  // Подсказка: какие боты вообще есть, если ни в одном чате их не оказалось
  const allBots = await BotToken.findAll({ where: { isActive: true }, attributes: ['name', 'username'] });
  if (allBots.length) {
    console.log(`  Боты в системе: ${allBots.map(b => `${b.name} (@${b.username})`).join(', ')}`);
    console.log('  Бот добавляется в группу так же, как сотрудник: в чате →');
    console.log('  «Добавить участника» → раздел «Боты» внизу списка.');
    console.log('');
  }
}

main()
  .then(() => sequelize.close())
  .catch(async err => {
    console.error('❌', err.message);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
