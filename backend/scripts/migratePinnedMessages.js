#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.33 — закреплённые сообщения.
 *
 * Добавляет messages."pinnedAt" и messages."pinnedBy" и частичный индекс под
 * выборку закреплённых. Данные не трогает: до этой версии закреплений не было.
 *
 * Запуск из backend/:
 *   npm run migrate:pinned-messages
 *
 * Только проверка, без изменений:
 *   npm run migrate:pinned-messages:check
 *
 * SQL идемпотентен, повторный запуск безопасен.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.33 pinned-messages.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

async function getColumn(tableName, columnName) {
  const [rows] = await sequelize.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = :tableName AND column_name = :columnName
  `, { replacements: { tableName, columnName } });
  return rows[0] || null;
}

async function indexExists(indexName) {
  const [[row]] = await sequelize.query(
    "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = :indexName) AS present",
    { replacements: { indexName } }
  );
  return Boolean(row.present);
}

async function getState() {
  const [pinnedAt, pinnedBy, index] = await Promise.all([
    getColumn('messages', 'pinnedAt'),
    getColumn('messages', 'pinnedBy'),
    indexExists('messages_pinned_idx'),
  ]);
  return { pinnedAt, pinnedBy, index };
}

function stateIsComplete(state) {
  return state.pinnedAt?.data_type === 'timestamp with time zone'
    && state.pinnedBy?.data_type === 'uuid'
    && state.index;
}

function printState(state) {
  console.log(`   ${state.pinnedAt ? '✓' : '✗'} messages."pinnedAt"`);
  console.log(`   ${state.pinnedBy ? '✓' : '✗'} messages."pinnedBy"`);
  console.log(`   ${state.index ? '✓' : '✗'} индекс messages_pinned_idx`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.33 — закреплённые сообщения\n');
  if (!fs.existsSync(MIGRATION_PATH)) throw new Error(`не найден файл миграции: ${MIGRATION_PATH}`);

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(stateIsComplete(before)
      ? '\n✅ Миграция 7.33 применена\n'
      : '\n⚠️  Схема не готова — запустите npm run migrate:pinned-messages\n');
    return;
  }

  if (stateIsComplete(before)) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
    return;
  }

  console.log('\n   Применяю SQL:');
  console.log(`   → ${MIGRATION_FILE}`);
  await sequelize.transaction(transaction =>
    sequelize.query(fs.readFileSync(MIGRATION_PATH, 'utf8'), { transaction }));

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!stateIsComplete(after)) throw new Error('итоговая проверка схемы не пройдена');

  console.log('\n✅ Миграция 7.33 успешно применена');
  console.log('   Перезапустите backend после выкладки нового кода.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
