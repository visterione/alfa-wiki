#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.58 — пригласительные ссылки в групповые чаты.
 *
 * Добавляет chats."inviteToken", "inviteEnabled", "inviteCreatedBy",
 * "inviteCreatedAt" и частичный уникальный индекс по токену. Данные не трогает:
 * до этой версии ссылок не было, а новый столбец приёма приезжает выключенным
 * (DEFAULT FALSE) — так и задумано, см. services/chatInvites.js.
 *
 * Запуск из backend/:
 *   npm run migrate:chat-invites
 *
 * Только проверка, без изменений:
 *   npm run migrate:chat-invites:check
 *
 * SQL идемпотентен, повторный запуск безопасен.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.58 chat-invite-links.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

async function getColumn(tableName, columnName) {
  const [rows] = await sequelize.query(`
    SELECT data_type, column_default
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
  const [token, enabled, createdBy, createdAt, index] = await Promise.all([
    getColumn('chats', 'inviteToken'),
    getColumn('chats', 'inviteEnabled'),
    getColumn('chats', 'inviteCreatedBy'),
    getColumn('chats', 'inviteCreatedAt'),
    indexExists('chats_invite_token_idx'),
  ]);
  return { token, enabled, createdBy, createdAt, index };
}

function stateIsComplete(state) {
  return state.token?.data_type === 'character varying'
    && state.enabled?.data_type === 'boolean'
    && state.createdBy?.data_type === 'uuid'
    && state.createdAt?.data_type === 'timestamp with time zone'
    && state.index;
}

function printState(state) {
  console.log(`   ${state.token ? '✓' : '✗'} chats."inviteToken"`);
  console.log(`   ${state.enabled ? '✓' : '✗'} chats."inviteEnabled"`);
  console.log(`   ${state.createdBy ? '✓' : '✗'} chats."inviteCreatedBy"`);
  console.log(`   ${state.createdAt ? '✓' : '✗'} chats."inviteCreatedAt"`);
  console.log(`   ${state.index ? '✓' : '✗'} индекс chats_invite_token_idx`);
}

/**
 * Сколько групп уже раздают ссылки. Ради этой строки и стоит запускать
 * :check после выкладки: «включено у 0 из N» — ожидаемое состояние сразу
 * после миграции, и увидеть его лучше глазами, чем предполагать.
 */
async function countInvites() {
  const [[row]] = await sequelize.query(`
    SELECT
      COUNT(*) FILTER (WHERE type = 'group')                          AS groups,
      COUNT(*) FILTER (WHERE type = 'group' AND "inviteEnabled")      AS enabled
    FROM chats
  `);
  return { groups: Number(row.groups), enabled: Number(row.enabled) };
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.58 — пригласительные ссылки в чаты\n');
  if (!fs.existsSync(MIGRATION_PATH)) throw new Error(`не найден файл миграции: ${MIGRATION_PATH}`);

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    if (stateIsComplete(before)) {
      const stats = await countInvites();
      console.log(`\n   Групп: ${stats.groups}, ссылка включена у ${stats.enabled}`);
      console.log('\n✅ Миграция 7.58 применена\n');
    } else {
      console.log('\n⚠️  Схема не готова — запустите npm run migrate:chat-invites\n');
    }
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

  const stats = await countInvites();
  console.log(`\n   Групп: ${stats.groups}, ссылка включена у ${stats.enabled} (ожидаемо 0 — приём включают вручную)`);

  console.log('\n✅ Миграция 7.58 успешно применена');
  console.log('   Перезапустите backend после выкладки нового кода.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
