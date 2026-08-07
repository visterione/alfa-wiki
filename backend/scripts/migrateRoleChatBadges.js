#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 6.64 — метка сотрудника переезжает с пользователей на роли.
 *
 * Добавляет roles."chatBadgeIcon"/"chatBadgeLabel"/"badgePriority",
 * med_centers.color/"sortOrder", users."chatBadgeOverride", переносит текущие
 * индивидуальные метки в override и пересчитывает users."chatBadge".
 *
 * Запуск из backend/:
 *   npm run migrate:role-badges
 *
 * Только проверка схемы, без изменений:
 *   npm run migrate:role-badges:check
 *
 * Пересчёт меток безопасно повторять — он идемпотентен, как и сам SQL.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION = {
  version: '6.64',
  title: 'метки ролей и цвета клиник',
  path: path.join(__dirname, '..', 'migrations', 'ver. 6.64 role-chat-badges.sql'),
};

const REQUIRED_COLUMNS = [
  ['roles', 'chatBadgeIcon'],
  ['roles', 'chatBadgeLabel'],
  ['roles', 'badgePriority'],
  ['med_centers', 'color'],
  ['med_centers', 'sortOrder'],
  ['users', 'chatBadgeOverride'],
];

async function assertRequiredTables() {
  const tables = ['users', 'roles', 'med_centers', 'user_roles', 'user_med_centers'];
  const [rows] = await sequelize.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN (:tables)
  `, { replacements: { tables } });
  const found = new Set(rows.map(row => row.tablename));
  const missing = tables.filter(table => !found.has(table));
  if (missing.length) throw new Error(`не найдены обязательные таблицы: ${missing.join(', ')}`);
}

async function getState() {
  const [rows] = await sequelize.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (${REQUIRED_COLUMNS.map((_, i) => `(:t${i}, :c${i})`).join(', ')})
  `, {
    replacements: REQUIRED_COLUMNS.reduce((acc, [table, column], i) => {
      acc[`t${i}`] = table;
      acc[`c${i}`] = column;
      return acc;
    }, {}),
  });
  return new Set(rows.map(row => `${row.table_name}.${row.column_name}`));
}

const stateIsComplete = (state) =>
  REQUIRED_COLUMNS.every(([table, column]) => state.has(`${table}.${column}`));

function printState(state) {
  for (const [table, column] of REQUIRED_COLUMNS) {
    console.log(`   ${state.has(`${table}.${column}`) ? '✓' : '✗'} ${table}."${column}"`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log(`\n▶ Миграция ver. ${MIGRATION.version} — ${MIGRATION.title}\n`);
  if (!fs.existsSync(MIGRATION.path)) throw new Error(`не найден файл миграции: ${MIGRATION.path}`);

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);
  await assertRequiredTables();

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(stateIsComplete(before)
      ? `\n✅ Миграция ${MIGRATION.version} применена\n`
      : `\n⚠️  Схема обновлена не полностью — запустите npm run migrate:role-badges\n`);
    return;
  }

  if (!stateIsComplete(before)) {
    console.log('\n   Применяю SQL:');
    const sql = fs.readFileSync(MIGRATION.path, 'utf8');
    await sequelize.transaction(transaction => sequelize.query(sql, { transaction }));

    console.log('\n   Состояние после:');
    const after = await getState();
    printState(after);
    if (!stateIsComplete(after)) throw new Error('итоговая проверка схемы не пройдена');
  } else {
    console.log('\n   Схема уже обновлена — только пересчитываю метки.');
  }

  // Сервис требуется после ALTER TABLE: до него модель ссылается на колонки,
  // которых ещё нет в базе.
  const { recomputeAll } = require('../services/userChatBadge');
  const { total, changed } = await recomputeAll();
  console.log(`\n   Метки пересчитаны: обновлено ${changed} из ${total} пользователей.`);

  console.log(`\n✅ Миграция ${MIGRATION.version} успешно применена`);
  console.log('   Иконки назначаются ролям в «Роли и права», цвета — клиникам там же.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
