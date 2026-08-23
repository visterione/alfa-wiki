#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.29 — удаление сообщений «у себя».
 *
 * Создаёт таблицу message_deletions. Ничего не переносит: старые заглушки
 * «Сообщение удалено» остаются в переписке как есть — они уже отправлены и
 * прочитаны, а стирать их задним числом значит менять историю у всех сразу.
 * Новых заглушек код больше не создаёт.
 *
 * Запуск из backend/:
 *   npm run migrate:message-deletions
 *
 * Только проверка, без изменений:
 *   npm run migrate:message-deletions:check
 *
 * SQL идемпотентен, повторный запуск безопасен.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.29 message-deletions.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

async function tableExists(tableName) {
  const [[row]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = :tableName
    ) AS present
  `, { replacements: { tableName } });
  return Boolean(row.present);
}

async function indexExists(indexName) {
  const [[row]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = :indexName
    ) AS present
  `, { replacements: { indexName } });
  return Boolean(row.present);
}

async function countLegacyStubs() {
  const [[row]] = await sequelize.query(`
    SELECT count(*)::int AS n
    FROM messages
    WHERE type = 'system' AND content = 'Сообщение удалено'
  `);
  return Number(row.n);
}

async function getState() {
  const table = await tableExists('message_deletions');
  const [userIndex, stubs] = await Promise.all([
    table ? indexExists('message_deletions_user_idx') : Promise.resolve(false),
    countLegacyStubs(),
  ]);
  return { table, userIndex, stubs };
}

function stateIsComplete(state) {
  return state.table && state.userIndex;
}

function printState(state) {
  console.log(`   ${state.table ? '✓' : '✗'} таблица message_deletions`);
  console.log(`   ${state.userIndex ? '✓' : '✗'} индекс message_deletions_user_idx`);
  console.log(`   · старых заглушек «Сообщение удалено» в переписке: ${state.stubs} (не трогаем)`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.29 — удаление «у себя» и «у всех»\n');
  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`не найден файл миграции: ${MIGRATION_PATH}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(stateIsComplete(before)
      ? '\n✅ Миграция 7.29 применена\n'
      : '\n⚠️  Схема не готова — запустите npm run migrate:message-deletions\n');
    return;
  }

  if (stateIsComplete(before)) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
    return;
  }

  console.log('\n   Применяю SQL:');
  console.log(`   → ${MIGRATION_FILE}`);
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  await sequelize.transaction(transaction => sequelize.query(sql, { transaction }));

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!stateIsComplete(after)) {
    throw new Error('итоговая проверка схемы не пройдена');
  }

  console.log('\n✅ Миграция 7.29 успешно применена');
  console.log('   Перезапустите backend после выкладки нового кода.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
