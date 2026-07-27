#!/usr/bin/env node
'use strict';

/**
 * Переезд маршрутизации форм из .env в подписки чатов (ver. 6.15).
 *
 * До: адрес доставки задавался переменными PUBLIC_FORM_<ТИП>_CHAT_ID — чтобы
 * подключить форму, нужно было зайти на сервер, вписать id и перезапустить процесс.
 * После: адрес — это членство бота в чате, строка в form_subscriptions.
 *
 * Запуск на сервере:
 *   cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/backend
 *   node scripts/migrateFormRouting.js            схема + план переноса, данные не трогаются
 *   node scripts/migrateFormRouting.js --apply    выполнить перенос
 *
 * Флаги:
 *   --skip-old-retries   не добивать автоматически старые недоставленные заявки
 *                        (они останутся доступны кнопкой «Переотправить» в админке)
 *
 * Подключение берётся из backend/.env, пароль вводить не нужно.
 *
 * Схема (таблицы и колонки) накатывается всегда: она аддитивная и идемпотентная,
 * без неё нельзя даже посмотреть, что переносить. Данные пишутся только с --apply,
 * потому что адреса чатов нужно сверить глазами до записи в боевую базу.
 */

const fs = require('fs');
const path = require('path');

const {
  sequelize, BotToken, Chat, ChatMember,
  FormSubscription, Submission, SubmissionDelivery
} = require('../models');
const { resolveChat } = require('../services/botMessenger');
const formRegistry = require('../services/public/formRegistry');
const { MAX_DELIVERY_ATTEMPTS } = require('../services/public/submissionService');

// В dev-режиме sequelize сыплет SQL в консоль и забивает вывод скрипта
sequelize.options.logging = false;

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.15 forms-routing-and-integrations.sql');
const APPLY = process.argv.includes('--apply');
const SKIP_OLD_RETRIES = process.argv.includes('--skip-old-retries');

// ── Шаг 1. Схема ──────────────────────────────────────────────────────────

async function applySchema() {
  console.log('1. Схема');

  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  await sequelize.query(sql);

  const [tables] = await sequelize.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ANY(ARRAY['form_subscriptions','submission_deliveries'])
  `);
  const [columns] = await sequelize.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE (table_name = 'bot_tokens' AND column_name = 'servesForms')
       OR (table_name = 'api_clients' AND column_name = 'updatedBy')
  `);

  for (const t of ['form_subscriptions', 'submission_deliveries']) {
    const exists = tables.some(r => r.tablename === t);
    const [[{ count }]] = exists
      ? await sequelize.query(`SELECT count(*)::int AS count FROM ${t}`)
      : [[{ count: 0 }]];
    console.log(`   ${exists ? '✓' : '✗'} таблица ${t}${exists ? ` — записей: ${count}` : ''}`);
  }
  for (const c of ['bot_tokens.servesForms', 'api_clients.updatedBy']) {
    const [table, column] = c.split('.');
    const exists = columns.some(r => r.table_name === table && r.column_name === column);
    console.log(`   ${exists ? '✓' : '✗'} колонка ${c}`);
  }

  console.log('');
}

// ── Шаг 2. План переноса ──────────────────────────────────────────────────

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

    // Бот уже должен состоять в чате — иначе доставка не работала бы и до переезда
    const member = await ChatMember.findOne({ where: { chatId: chat.id, userId: bot.userId } });
    if (!member) {
      plan.push({ formType, chat, bot, problem: 'бот не состоит в этом чате — доставка не работала бы' });
      continue;
    }

    plan.push({ formType, chat, bot });
  }

  return plan;
}

function printPlan(plan) {
  console.log('2. Что будет перенесено');
  console.log('');

  for (const item of plan) {
    const form = formRegistry.getForm(item.formType);
    if (item.problem) {
      console.log(`   ⚠️  ${form.title}`);
      console.log(`       ${item.problem}`);
    } else {
      console.log(`   ${form.title}`);
      console.log(`       → чат «${item.chat.name}»    бот: ${item.bot.name} (@${item.bot.username})`);
    }
    console.log('');
  }
}

// ── Шаг 3. Перенос ────────────────────────────────────────────────────────

async function migrate(ok, skipOldRetries) {
  // Бот обслуживает те формы, которые на него были настроены в .env
  const formsByBot = new Map();
  ok.forEach(item => {
    const entry = formsByBot.get(item.bot.id) || { bot: item.bot, forms: [] };
    entry.forms.push(item.formType);
    formsByBot.set(item.bot.id, entry);
  });

  let subsCreated = 0;
  for (const item of ok) {
    const [, isNew] = await FormSubscription.findOrCreate({
      where:    { botId: item.bot.id, chatId: item.chat.id, formType: item.formType },
      defaults: { createdBy: null }
    });
    if (isNew) subsCreated++;
  }

  for (const { bot, forms } of formsByBot.values()) {
    await bot.update({ servesForms: [...new Set([...(bot.servesForms || []), ...forms])] });
  }

  // Бэкфилл доставок: без строки в submission_deliveries крон повторной доставки
  // перестанет видеть недоставленные заявки
  const submissions = await Submission.findAll({
    where: { formType: ok.map(p => p.formType) },
    attributes: ['id', 'formType', 'deliveryStatus', 'deliveryAttempts', 'deliveredMsgId', 'deliveredAt']
  });

  const targetByForm = new Map(ok.map(p => [p.formType, p]));
  let deliveriesCreated = 0;
  let willRetry = 0;

  for (const submission of submissions) {
    const target = targetByForm.get(submission.formType);
    if (!target) continue;

    const notSent = submission.deliveryStatus !== 'sent';

    // Старые недоставленные заявки крон добьёт сразу после рестарта. Обычно это
    // и нужно, но если они копились месяцами — в чат прилетит пачка. С флагом
    // --skip-old-retries они считаются исчерпавшими попытки: автоматически не
    // уйдут, но останутся в «Интеграции → Заявки» с кнопкой «Переотправить».
    const attempts = (notSent && skipOldRetries)
      ? MAX_DELIVERY_ATTEMPTS
      : submission.deliveryAttempts;

    const [, isNew] = await SubmissionDelivery.findOrCreate({
      where: { submissionId: submission.id, chatId: target.chat.id },
      defaults: {
        botId:       target.bot.id,
        status:      submission.deliveryStatus,
        attempts,
        error:       submission.deliveryError,
        messageId:   submission.deliveredMsgId,
        deliveredAt: submission.deliveredAt
      }
    });
    if (isNew) {
      deliveriesCreated++;
      if (notSent && attempts < MAX_DELIVERY_ATTEMPTS) willRetry++;
    }
  }

  return { subsCreated, deliveriesCreated, willRetry, botsUpdated: formsByBot.size, submissions: submissions.length };
}

// ── Точка входа ───────────────────────────────────────────────────────────

async function main() {
  await sequelize.authenticate();

  console.log('');
  console.log('=== ver. 6.15 — маршрутизация форм через подписки чатов ===');
  console.log('');

  await applySchema();

  const plan = await readEnvRouting();
  printPlan(plan);

  const ok = plan.filter(p => !p.problem);

  if (ok.length === 0) {
    console.log('   Переносить нечего: в .env нет настроенных форм.');
    console.log('   Если формы в бою не использовались — так и должно быть.');
    console.log('   Дальше: Админка → Боты (отметить формы) и добавить бота в нужный чат.');
    console.log('');
    await sequelize.close();
    return;
  }

  if (!APPLY) {
    console.log('3. Записи не было — это предварительный просмотр');
    console.log('');
    console.log('   Сверьте названия чатов выше. Если верно, запустите:');
    console.log('   node scripts/migrateFormRouting.js --apply');
    console.log('');
    await sequelize.close();
    return;
  }

  console.log('3. Перенос');
  const result = await migrate(ok, SKIP_OLD_RETRIES);

  console.log(`   Подписок создано:    ${result.subsCreated}`);
  console.log(`   Ботам проставлено:   ${result.botsUpdated}`);
  console.log(`   Заявок просмотрено:  ${result.submissions}`);
  console.log(`   Доставок записано:   ${result.deliveriesCreated}`);
  console.log('');

  if (result.willRetry > 0) {
    console.log(`   ⚠️  Недоставленных заявок: ${result.willRetry}`);
    console.log('       После рестарта крон попробует их дослать — они появятся в чате.');
    console.log('       Если этого не нужно, откатите и перезапустите с флагом:');
    console.log('       DELETE FROM form_subscriptions;  DELETE FROM submission_deliveries;');
    console.log('       node scripts/migrateFormRouting.js --apply --skip-old-retries');
    console.log('');
  }

  console.log('✅ Готово');
  console.log('');
  console.log('   Дальше:');
  console.log('   1. pm2 restart alfa-wiki');
  console.log('   2. отправить тестовую заявку и проверить, что легла в тот же чат');
  console.log('      (Админка → Интеграции → Заявки)');
  console.log('   3. отдельным заходом убрать из .env переменные');
  console.log('      PUBLIC_FORMS_BOT_TOKEN и PUBLIC_FORM_*_CHAT_ID');
  console.log('');
  console.log('   Откат: DELETE FROM form_subscriptions; — вернётся работа через .env');
  console.log('');

  await sequelize.close();
}

main().catch(async err => {
  console.error('');
  console.error('❌ Не выполнено:', err.message);
  console.error('');
  await sequelize.close().catch(() => {});
  process.exit(1);
});
