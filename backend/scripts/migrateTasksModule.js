#!/usr/bin/env node
'use strict';

/**
 * Runner миграции ver. 6.75 — модуль «Задачи» вместо старого канбана.
 *
 * Запуск из backend/:
 *   npm run migrate:tasks
 *
 * Только проверка, без изменений:
 *   npm run migrate:tasks:check
 *
 * Миграция завершает работу удалением старых таблиц канбана. Если в них
 * неожиданно есть записи, runner остановится. Подтвердить согласованное удаление:
 *   npm run migrate:tasks -- --allow-kanban-data-loss
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = path.join(
  __dirname,
  '..',
  'migrations',
  'ver. 6.75 tasks-module.sql'
);
const MIGRATION_LOCK_ID = 675001;

const REQUIRED_TABLES = [
  'task_projects',
  'task_teams',
  'task_team_members',
  'tasks',
  'task_parts',
  'task_part_deps',
  'task_part_assignees',
  'task_history',
  'task_norm_changes',
];
const LEGACY_TABLES = ['kanban_tasks', 'board_permissions', 'kanban_boards'];
const REQUIRED_COLUMNS = [
  ['users', 'dailyNormHours'],
  ['calendar_events', 'taskPartId'],
  ['calendar_events', 'isFloating'],
  ['calendar_events', 'dayOrder'],
];
const REQUIRED_INDEXES = [
  'task_projects_name_uniq',
  'task_teams_med_center_idx',
  'task_teams_hidden_idx',
  'task_team_members_user_idx',
  'tasks_author_idx',
  'tasks_project_idx',
  'tasks_archived_idx',
  'task_parts_task_idx',
  'task_parts_status_idx',
  'task_parts_due_idx',
  'task_part_assignees_user_idx',
  'task_history_task_idx',
  'task_norm_changes_user_idx',
  'calendar_events_task_part_idx',
  'calendar_events_floating_idx',
];

async function tableSet(connection, tables) {
  const result = await connection.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ANY($1::text[])
  `, [tables]);
  return new Set(result.rows.map(row => row.tablename));
}

async function columnSet(connection) {
  const result = await connection.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
  `, [[...new Set(REQUIRED_COLUMNS.map(([table]) => table))]]);
  return new Set(result.rows.map(row => `${row.table_name}.${row.column_name}`));
}

async function indexSet(connection) {
  const result = await connection.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ANY($1::text[])
  `, [REQUIRED_INDEXES]);
  return new Set(result.rows.map(row => row.indexname));
}

async function getState(connection) {
  const [tables, columns, indexes, legacy, accessResult] = await Promise.all([
    tableSet(connection, REQUIRED_TABLES),
    columnSet(connection),
    indexSet(connection),
    tableSet(connection, LEGACY_TABLES),
    connection.query(`
      SELECT count(*)::int AS count
      FROM users
      WHERE "adminAccess" IS NULL OR NOT ("adminAccess" ? 'tasks')
    `),
  ]);
  const missingTables = REQUIRED_TABLES.filter(table => !tables.has(table));
  const missingColumns = REQUIRED_COLUMNS
    .filter(([table, column]) => !columns.has(`${table}.${column}`));
  const missingIndexes = REQUIRED_INDEXES.filter(index => !indexes.has(index));
  const legacyTables = LEGACY_TABLES.filter(table => legacy.has(table));
  const usersWithoutTasksAccess = accessResult.rows[0].count;

  return {
    missingTables,
    missingColumns,
    missingIndexes,
    legacyTables,
    usersWithoutTasksAccess,
    complete: missingTables.length === 0
      && missingColumns.length === 0
      && missingIndexes.length === 0
      && legacyTables.length === 0
      && usersWithoutTasksAccess === 0,
  };
}

function printState(state) {
  for (const table of REQUIRED_TABLES) {
    console.log(`   ${state.missingTables.includes(table) ? '✗' : '✓'} таблица ${table}`);
  }
  for (const [table, column] of REQUIRED_COLUMNS) {
    const missing = state.missingColumns.some(([t, c]) => t === table && c === column);
    console.log(`   ${missing ? '✗' : '✓'} колонка ${table}."${column}"`);
  }
  if (state.missingIndexes.length) {
    console.log(`   ✗ отсутствуют индексы: ${state.missingIndexes.join(', ')}`);
  } else {
    console.log('   ✓ все индексы модуля');
  }
  console.log(`   ${state.usersWithoutTasksAccess ? '✗' : '✓'} право tasks в users.adminAccess${
    state.usersWithoutTasksAccess ? ` — отсутствует у ${state.usersWithoutTasksAccess}` : ''
  }`);
  for (const table of LEGACY_TABLES) {
    console.log(`   ${state.legacyTables.includes(table) ? '○' : '✓'} старая таблица ${table} ${
      state.legacyTables.includes(table) ? 'ещё существует' : 'удалена'
    }`);
  }
}

async function assertPrerequisites(connection) {
  const existing = await tableSet(connection, ['users', 'calendar_events']);
  const missing = ['users', 'calendar_events'].filter(table => !existing.has(table));
  if (missing.length) {
    throw new Error(`не найдены обязательные таблицы: ${missing.join(', ')}`);
  }
}

async function legacyRows(connection, tables) {
  const counts = [];
  // Имена берутся только из константы выше, пользовательский ввод сюда не попадает.
  for (const table of tables) {
    const result = await connection.query(`SELECT count(*)::int AS count FROM "${table}"`);
    counts.push({ table, count: result.rows[0].count });
  }
  return counts;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const allowKanbanDataLoss = process.argv.includes('--allow-kanban-data-loss');
  let connection;
  let lockHeld = false;

  console.log('\n▶ Миграция ver. 6.75 — модуль «Задачи»\n');
  if (!fs.existsSync(MIGRATION_FILE)) {
    throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);
  }

  try {
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);
    await assertPrerequisites(connection);

    console.log('   Состояние схемы:');
    let state = await getState(connection);
    printState(state);

    if (checkOnly) {
      console.log(state.complete
        ? '\n✅ Миграция 6.75 применена\n'
        : '\n⚠️  Миграция 6.75 не применена или применена частично\n');
      if (!state.complete) process.exitCode = 2;
      return;
    }

    if (state.complete) {
      console.log('\n✅ Уже применена, ничего делать не нужно\n');
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockHeld = true;

    // После ожидания блокировки состояние мог изменить другой процесс.
    state = await getState(connection);
    if (state.complete) {
      console.log('\n✅ Миграцию уже применил другой процесс\n');
      return;
    }

    const counts = await legacyRows(connection, state.legacyTables);
    const populated = counts.filter(item => item.count > 0);
    if (populated.length && !allowKanbanDataLoss) {
      const details = populated.map(item => `${item.table}: ${item.count}`).join(', ');
      throw new Error(
        `в старом канбане найдены данные (${details}). `
        + 'Сначала сделайте выгрузку либо повторите запуск с --allow-kanban-data-loss'
      );
    }
    if (populated.length) {
      console.log(`\n   ⚠ Удаление старых данных подтверждено: ${
        populated.map(item => `${item.table}: ${item.count}`).join(', ')
      }`);
    }

    console.log('\n   Применяю SQL...');
    try {
      await connection.query(fs.readFileSync(MIGRATION_FILE, 'utf8'));
    } catch (error) {
      // SQL сам открывает транзакцию. Если одна из команд упала до COMMIT,
      // соединение нельзя возвращать в пул в состоянии aborted transaction.
      await connection.query('ROLLBACK').catch(() => {});
      throw error;
    }

    const after = await getState(connection);
    console.log('\n   Состояние после:');
    printState(after);
    if (!after.complete) throw new Error('итоговая проверка схемы не пройдена');

    console.log('\n✅ Миграция 6.75 успешно применена\n');
  } finally {
    if (connection && lockHeld) {
      await connection.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    }
    if (connection) await sequelize.connectionManager.releaseConnection(connection);
  }
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
