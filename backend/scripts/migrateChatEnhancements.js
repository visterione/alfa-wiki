#!/usr/bin/env node
'use strict';

/**
 * Миграции чата ver. 6.57–6.59:
 *   6.57 — администраторские метки пользователей (users.chatBadge)
 *   6.58 — адресаты упоминаний (messages.mentions)
 *   6.59 — опросы (тип сообщения poll и messages.poll)
 *
 * Запуск из backend/:
 *   npm run migrate:chat-enhancements
 *
 * Только проверка схемы, без изменений:
 *   npm run migrate:chat-enhancements:check
 *
 * Все SQL-файлы идемпотентны. При частично применённой миграции скрипт можно
 * безопасно запустить повторно.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATIONS = [
  {
    version: '6.57',
    title: 'метки пользователей',
    file: 'ver. 6.57 user-chat-badge.sql',
    transactional: true,
  },
  {
    version: '6.58',
    title: 'упоминания в сообщениях',
    file: 'ver. 6.58 message-mentions.sql',
    transactional: true,
  },
  {
    version: '6.59',
    title: 'опросы в чатах',
    file: 'ver. 6.59 chat-polls.sql',
    // ALTER TYPE ... ADD VALUE нельзя надёжно смешивать с остальными
    // операциями в транзакции на старых версиях PostgreSQL.
    transactional: false,
  },
].map(item => ({
  ...item,
  path: path.join(__dirname, '..', 'migrations', item.file),
}));

async function assertRequiredTables() {
  const [rows] = await sequelize.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('users', 'messages')
  `);
  const found = new Set(rows.map(row => row.tablename));
  const missing = ['users', 'messages'].filter(table => !found.has(table));
  if (missing.length) throw new Error(`не найдены обязательные таблицы: ${missing.join(', ')}`);
}

async function getColumn(tableName, columnName) {
  const [rows] = await sequelize.query(`
    SELECT data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = :tableName
      AND column_name = :columnName
  `, { replacements: { tableName, columnName } });
  return rows[0] || null;
}

async function enumHasPoll() {
  const [[row]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'enum_messages_type'
        AND e.enumlabel = 'poll'
    ) AS present
  `);
  return Boolean(row.present);
}

async function getState() {
  const [chatBadge, mentions, poll, pollEnum] = await Promise.all([
    getColumn('users', 'chatBadge'),
    getColumn('messages', 'mentions'),
    getColumn('messages', 'poll'),
    enumHasPoll(),
  ]);
  return { chatBadge, mentions, poll, pollEnum };
}

function isJsonb(column) {
  return column?.data_type === 'jsonb';
}

function mentionsIsReady(column) {
  return isJsonb(column)
    && column.is_nullable === 'NO'
    && Boolean(column.column_default?.includes('[]'));
}

function stateIsComplete(state) {
  return isJsonb(state.chatBadge)
    && mentionsIsReady(state.mentions)
    && isJsonb(state.poll)
    && state.pollEnum;
}

function printState(state) {
  console.log(`   ${isJsonb(state.chatBadge) ? '✓' : '✗'} users."chatBadge" (JSONB)`);
  console.log(`   ${mentionsIsReady(state.mentions) ? '✓' : '✗'} messages.mentions (JSONB NOT NULL DEFAULT [])`);
  console.log(`   ${state.pollEnum ? '✓' : '✗'} enum_messages_type: poll`);
  console.log(`   ${isJsonb(state.poll) ? '✓' : '✗'} messages.poll (JSONB)`);
}

async function applyMigration(migration) {
  if (!fs.existsSync(migration.path)) {
    throw new Error(`не найден файл миграции: ${migration.path}`);
  }
  const sql = fs.readFileSync(migration.path, 'utf8');
  console.log(`   → ver. ${migration.version}: ${migration.title}`);
  if (migration.transactional) {
    await sequelize.transaction(transaction => sequelize.query(sql, { transaction }));
  } else {
    await sequelize.query(sql);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграции чата ver. 6.57–6.59\n');
  for (const migration of MIGRATIONS) {
    if (!fs.existsSync(migration.path)) throw new Error(`не найден файл миграции: ${migration.path}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);
  await assertRequiredTables();

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(stateIsComplete(before)
      ? '\n✅ Все миграции 6.57–6.59 применены\n'
      : '\n⚠️  Схема обновлена не полностью — запустите npm run migrate:chat-enhancements\n');
    return;
  }

  if (stateIsComplete(before)) {
    console.log('\n✅ Все миграции уже применены, ничего делать не нужно\n');
    return;
  }

  console.log('\n   Применяю SQL:');
  for (const migration of MIGRATIONS) await applyMigration(migration);

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!stateIsComplete(after)) {
    throw new Error('итоговая проверка схемы не пройдена');
  }

  console.log('\n✅ Миграции 6.57–6.59 успешно применены');
  console.log('   Перезапустите backend после выкладки нового кода.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграции не выполнены: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
