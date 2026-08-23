#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.30 — счётчик непрочитанных и индекс под пагинацию.
 *
 *   1. chat_members."unreadCount" + заполнение по текущему состоянию;
 *   2. индекс messages (chatId, createdAt DESC, id DESC) под курсор из пары.
 *
 * Индекс строится CONCURRENTLY и потому вне транзакции: на боевой таблице
 * сообщений обычный CREATE INDEX заблокировал бы запись во все чаты сразу.
 * Это может занять минуты — так и должно быть, чат при этом работает.
 *
 * Запуск из backend/:
 *   npm run migrate:unread-counters
 *
 * Только проверка, без изменений:
 *   npm run migrate:unread-counters:check
 *
 * Оба SQL идемпотентны, повторный запуск безопасен.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATIONS = [
  { title: 'счётчик непрочитанных', file: 'ver. 7.30 unread-counters.sql', transactional: true },
  { title: 'индекс под пагинацию истории', file: 'ver. 7.30 messages-keyset-index.sql', transactional: false },
].map(item => ({ ...item, path: path.join(__dirname, '..', 'migrations', item.file) }));

async function getColumn(tableName, columnName) {
  const [rows] = await sequelize.query(`
    SELECT data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = :tableName AND column_name = :columnName
  `, { replacements: { tableName, columnName } });
  return rows[0] || null;
}

async function indexIsValid(indexName) {
  // Прерванный CONCURRENTLY оставляет индекс существующим, но нерабочим —
  // pg_index.indisvalid единственный способ отличить такой от настоящего
  const [[row]] = await sequelize.query(`
    SELECT COALESCE(bool_or(i.indisvalid), false) AS valid
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = :indexName
  `, { replacements: { indexName } });
  return Boolean(row.valid);
}

// Сколько членств разошлось с честным пересчётом. Ноль — счётчики верны.
async function countDrift() {
  const [[row]] = await sequelize.query(`
    SELECT count(*)::int AS n
    FROM chat_members cm
    WHERE cm."unreadCount" IS DISTINCT FROM (
      SELECT count(m.id)::int
      FROM messages m
      WHERE m."chatId" = cm."chatId"
        AND m."createdAt" > COALESCE(cm."lastReadAt", '-infinity'::timestamptz)
        AND m."senderId" <> cm."userId"
    )
  `);
  return Number(row.n);
}

async function getState() {
  const column = await getColumn('chat_members', 'unreadCount');
  const [index, drift] = await Promise.all([
    indexIsValid('messages_chat_created_id_idx'),
    column ? countDrift() : Promise.resolve(null),
  ]);
  return { column, index, drift };
}

function columnIsReady(column) {
  return column?.data_type === 'integer' && column.is_nullable === 'NO';
}

function stateIsComplete(state) {
  return columnIsReady(state.column) && state.index && state.drift === 0;
}

function printState(state) {
  console.log(`   ${columnIsReady(state.column) ? '✓' : '✗'} chat_members."unreadCount" (INTEGER NOT NULL)`);
  console.log(`   ${state.index ? '✓' : '✗'} индекс messages_chat_created_id_idx`);
  if (state.drift === null) {
    console.log('   – расхождение счётчиков не считали: колонки ещё нет');
  } else {
    console.log(`   ${state.drift === 0 ? '✓' : '✗'} членств с неверным счётчиком: ${state.drift}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.30 — счётчик непрочитанных\n');
  for (const migration of MIGRATIONS) {
    if (!fs.existsSync(migration.path)) throw new Error(`не найден файл миграции: ${migration.path}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(stateIsComplete(before)
      ? '\n✅ Миграция 7.30 применена\n'
      : '\n⚠️  Схема не готова — запустите npm run migrate:unread-counters\n');
    return;
  }

  if (stateIsComplete(before)) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
    return;
  }

  console.log('\n   Применяю SQL:');
  for (const migration of MIGRATIONS) {
    console.log(`   → ${migration.title}${migration.transactional ? '' : ' (без транзакции, может занять минуты)'}`);
    const sql = fs.readFileSync(migration.path, 'utf8');
    if (migration.transactional) {
      await sequelize.transaction(transaction => sequelize.query(sql, { transaction }));
    } else {
      await sequelize.query(sql);
    }
  }

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!stateIsComplete(after)) {
    throw new Error('итоговая проверка схемы не пройдена');
  }

  console.log('\n✅ Миграция 7.30 успешно применена');
  console.log('   Перезапустите backend после выкладки нового кода.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
