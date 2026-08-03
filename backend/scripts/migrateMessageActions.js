#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 6.51 — кнопки действий в сообщениях бота (messages.actions).
 *
 * Запуск:
 *   cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/backend
 *   node scripts/migrateMessageActions.js
 *
 * Подключение берётся из backend/.env, отдельно вводить пароль не нужно.
 * Скрипт идемпотентный: повторный запуск ничего не ломает и не трогает данные.
 *
 * Флаги:
 *   --check   только проверить, применена ли миграция, ничего не менять
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.51 message-actions.sql');

// В dev-режиме sequelize сыплет SQL в консоль и забивает вывод скрипта
sequelize.options.logging = false;

/**
 * Описание колонки messages.actions, если она уже есть.
 * @returns {Promise<{ data_type: string, is_nullable: string, column_default: string }|null>}
 */
async function actionsColumn() {
  const [rows] = await sequelize.query(`
    SELECT data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'actions'
  `);
  return rows[0] || null;
}

async function printState(prefix) {
  const column = await actionsColumn();

  if (!column) {
    console.log('   ✗  messages.actions — НЕТ');
    return false;
  }

  // Сколько сообщений уже с кнопками — по этому числу видно, что миграция
  // не просто прошла, а фича работает
  const [[{ count }]] = await sequelize.query(
    "SELECT count(*)::int AS count FROM messages WHERE jsonb_array_length(actions) > 0"
  );
  console.log(`   ${prefix} messages.actions — есть (${column.data_type}, по умолчанию ${column.column_default})`);
  console.log(`   ${prefix} сообщений с кнопками: ${count}`);
  return true;
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('');
  console.log('▶ Миграция ver. 6.51 — кнопки действий в сообщениях бота');
  console.log('');

  if (!fs.existsSync(MIGRATION_FILE)) {
    throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);
  }

  await sequelize.authenticate();
  const { database, host } = sequelize.config;
  console.log(`   База: ${database} на ${host}`);
  console.log('');

  console.log('   Состояние до:');
  const before = await printState('•');
  console.log('');

  if (checkOnly) {
    console.log(before
      ? '✅ Миграция уже применена'
      : '⚠️  Миграция не применена — запустите без --check');
    console.log('');
    return;
  }

  if (before) {
    console.log('✅ Уже применена, ничего делать не нужно');
    console.log('');
    return;
  }

  // Выполняем ровно тот же SQL, что лежит в migrations/ — единый источник схемы.
  // Команда с IF NOT EXISTS, поэтому повторный запуск безопасен
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  console.log('   Применяю...');
  await sequelize.query(sql);
  console.log('');

  console.log('   Состояние после:');
  const after = await printState('✓');
  console.log('');

  if (!after) {
    throw new Error('колонка не появилась — проверьте вывод выше');
  }

  console.log('✅ Готово');
  console.log('');
  console.log('   Дальше: перезапустить бэкенд (pm2 restart alfa-wiki) и выложить');
  console.log('   страницу реестра справок:');
  console.log('   node scripts/publish-bot-page.js certificate-registry.html reestr-spravok');
  console.log('');
  console.log('   Кнопки появятся только на новых заявках — у доставленных раньше');
  console.log('   список действий пустой.');
  console.log('');
}

main()
  .then(() => sequelize.close())
  .catch(async err => {
    console.error('');
    console.error('❌ Миграция не выполнена:', err.message);
    console.error('');
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
