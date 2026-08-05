#!/usr/bin/env node
'use strict';

/**
 * ver. 6.55 — связь пользователя Alfa Wiki с сотрудником МИС.
 *
 * Запуск из backend/:
 *   npm run migrate:user-mis-id
 *
 * Только проверка, без изменений:
 *   npm run migrate:user-mis-id:check
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.55 add-user-mis-id.sql');
const INDEX_NAME = 'users_mis_user_id_unique';
sequelize.options.logging = false;

async function getState() {
  const [[column]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'misUserId'
    ) AS exists
  `);

  const [[index]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'users'
        AND indexname = :indexName
    ) AS exists
  `, { replacements: { indexName: INDEX_NAME } });

  let linkedUsers = null;
  if (column.exists) {
    const [[row]] = await sequelize.query(`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE "misUserId" IS NOT NULL
    `);
    linkedUsers = row.count;
  }

  return {
    columnExists: column.exists,
    indexExists: index.exists,
    linkedUsers,
  };
}

function printState(state) {
  console.log(`   ${state.columnExists ? '✓' : '✗'} users."misUserId"`);
  console.log(`   ${state.indexExists ? '✓' : '✗'} уникальный индекс ${INDEX_NAME}`);
  if (state.linkedUsers !== null) console.log(`   • связанных пользователей: ${state.linkedUsers}`);
}

async function assertRequiredTables() {
  const [rows] = await sequelize.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('users', 'doctor_cards')
  `);
  const found = new Set(rows.map(row => row.tablename));
  const missing = ['users', 'doctor_cards'].filter(table => !found.has(table));
  if (missing.length) throw new Error(`не найдены обязательные таблицы: ${missing.join(', ')}`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 6.55 — ID сотрудника МИС у пользователя\n');
  if (!fs.existsSync(MIGRATION_FILE)) throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);
  await assertRequiredTables();

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(before.columnExists && before.indexExists
      ? '\n✅ Миграция уже применена\n'
      : '\n⚠️  Миграция не применена полностью — запустите команду без :check\n');
    return;
  }

  if (before.columnExists && before.indexExists) {
    console.log('\n✅ Уже применена, ничего делать не нужно\n');
    return;
  }

  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  console.log('\n   Применяю SQL в транзакции...');
  await sequelize.transaction(async transaction => {
    await sequelize.query(sql, { transaction });
  });

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!after.columnExists || !after.indexExists) {
    throw new Error('проверка результата не пройдена: колонка или индекс не созданы');
  }

  const linkedNow = (after.linkedUsers || 0) - (before.linkedUsers || 0);
  console.log(`\n✅ Готово. Автоматически привязано новых пользователей: ${Math.max(0, linkedNow)}\n`);
}

function errorMessage(error) {
  if (error?.message) return error.message;
  if (Array.isArray(error?.errors)) {
    const messages = error.errors.map(item => item?.message).filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  if (error?.original?.message) return error.original.message;
  return error?.name || String(error) || 'неизвестная ошибка';
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${errorMessage(error)}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
