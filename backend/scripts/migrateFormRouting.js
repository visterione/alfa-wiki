#!/usr/bin/env node
'use strict';

/**
 * Переезд маршрутизации форм из .env в подписки чатов (ver. 6.15).
 *
 * До: адрес доставки задавался переменными PUBLIC_FORM_<ТИП>_CHAT_ID.
 * После: адрес — это членство бота в чате, строка в form_subscriptions.
 *
 * Что делает:
 *   1. читает переменные окружения и резолвит чат и бота;
 *   2. заводит подписки — по одной на форму;
 *   3. бэкфиллит submission_deliveries по уже принятым заявкам, чтобы крон
 *      повторной доставки не потерял недоставленное и не начал слать дубли.
 *
 * Использование:
 *   node scripts/migrateFormRouting.js              — показать план, ничего не менять
 *   node scripts/migrateFormRouting.js --apply      — выполнить
 *
 * По умолчанию сухой прогон: адреса нужно сверить глазами до записи в боевую базу.
 */

const { sequelize, BotToken, Chat, ChatMember, FormSubscription, Submission, SubmissionDelivery } = require('../models');
const { resolveChat } = require('../services/botMessenger');
const formRegistry = require('../services/public/formRegistry');

const APPLY = process.argv.includes('--apply');

/**
 * Разбирает .env в список намерений: форма → бот + чат.
 * @returns {Promise<Array<{ formType, chat, bot, problem? }>>}
 */
async function readEnvRouting() {
  const plan = [];

  for (const formType of formRegistry.listFormTypes()) {
    const envKey = formType.toUpperCase().replace(/-/g, '_');
    const token  = process.env[`PUBLIC_FORM_${envKey}_BOT_TOKEN`] || process.env.PUBLIC_FORMS_BOT_TOKEN;
    const chatId = process.env[`PUBLIC_FORM_${envKey}_CHAT_ID`];

    if (!token || !chatId) {
      plan.push({ formType, problem: `не заданы PUBLIC_FORM_${envKey}_CHAT_ID / токен бота` });
      continue;
    }

    const bot = await BotToken.findOne({ where: { token } });
    if (!bot) {
      plan.push({ formType, problem: 'бот с таким токеном не найден в bot_tokens' });
      continue;
    }

    const chat = await resolveChat(chatId);
    if (!chat) {
      plan.push({ formType, problem: `чат ${chatId} не найден` });
      continue;
    }

    // Бота уже должно быть в чате — иначе доставка не работала бы и до переезда
    const member = await ChatMember.findOne({ where: { chatId: chat.id, userId: bot.userId } });
    if (!member) {
      plan.push({ formType, chat, bot, problem: 'бот не состоит в этом чате — доставка не работала бы' });
      continue;
    }

    plan.push({ formType, chat, bot });
  }

  return plan;
}

async function main() {
  await sequelize.authenticate();

  const plan = await readEnvRouting();
  const ok = plan.filter(p => !p.problem);

  console.log('');
  console.log(APPLY ? '=== Переезд маршрутизации форм ===' : '=== Сухой прогон (записи не будет) ===');
  console.log('');

  for (const item of plan) {
    const form = formRegistry.getForm(item.formType);
    if (item.problem) {
      console.log(`  ⚠️  ${form.title}`);
      console.log(`      ${item.problem}`);
    } else {
      console.log(`  ${form.title}`);
      console.log(`      → чат «${item.chat.name}»   бот: ${item.bot.name} (@${item.bot.username})`);
    }
    console.log('');
  }

  if (ok.length === 0) {
    console.log('Переносить нечего. Если формы в бою не использовались — так и должно быть.');
    await sequelize.close();
    return;
  }

  // Бот обслуживает те формы, которые на него были настроены в .env
  const formsByBot = new Map();
  ok.forEach(item => {
    const list = formsByBot.get(item.bot.id) || { bot: item.bot, forms: [] };
    list.forms.push(item.formType);
    formsByBot.set(item.bot.id, list);
  });

  console.log('  Ботам будут проставлены обслуживаемые формы:');
  for (const { bot, forms } of formsByBot.values()) {
    console.log(`      ${bot.name}: ${forms.join(', ')}`);
  }
  console.log('');

  // Бэкфилл доставок: у каждой существующей заявки должна появиться строка,
  // иначе крон повторной доставки перестанет её видеть
  const submissions = await Submission.findAll({
    where: { formType: ok.map(p => p.formType) },
    attributes: ['id', 'formType', 'deliveryStatus', 'deliveryAttempts', 'deliveredMsgId', 'deliveredAt']
  });

  console.log(`  Заявок для бэкфилла доставок: ${submissions.length}`);
  console.log('');

  if (!APPLY) {
    console.log('Сверьте чаты выше и запустите с --apply, чтобы записать.');
    await sequelize.close();
    return;
  }

  let subsCreated = 0;
  for (const item of ok) {
    const [, isNew] = await FormSubscription.findOrCreate({
      where:    { botId: item.bot.id, chatId: item.chat.id, formType: item.formType },
      defaults: { createdBy: null }
    });
    if (isNew) subsCreated++;
  }

  for (const { bot, forms } of formsByBot.values()) {
    const merged = [...new Set([...(bot.servesForms || []), ...forms])];
    await bot.update({ servesForms: merged });
  }

  const targetByForm = new Map(ok.map(p => [p.formType, p]));
  let deliveriesCreated = 0;

  for (const submission of submissions) {
    const target = targetByForm.get(submission.formType);
    if (!target) continue;

    const [, isNew] = await SubmissionDelivery.findOrCreate({
      where: { submissionId: submission.id, chatId: target.chat.id },
      defaults: {
        botId:       target.bot.id,
        status:      submission.deliveryStatus,
        attempts:    submission.deliveryAttempts,
        messageId:   submission.deliveredMsgId,
        deliveredAt: submission.deliveredAt
      }
    });
    if (isNew) deliveriesCreated++;
  }

  console.log('✅ Готово');
  console.log(`   Подписок создано:  ${subsCreated}`);
  console.log(`   Доставок записано: ${deliveriesCreated}`);
  console.log('');
  console.log('   Проверьте доставку тестовой заявкой, после чего переменные');
  console.log('   PUBLIC_FORMS_BOT_TOKEN и PUBLIC_FORM_*_CHAT_ID можно удалить из .env.');
  console.log('');

  await sequelize.close();
}

main().catch(async err => {
  console.error('❌ Переезд не выполнен:', err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
