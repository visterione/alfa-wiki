#!/usr/bin/env node
'use strict';

/**
 * Миграции ver. 6.67–6.68:
 *   6.67 — единый справочник медцентров и юрлиц;
 *   6.68 — складской учёт.
 *
 * Запуск из backend/:
 *   npm run migrate:6.67-6.68
 *
 * Только проверка, без изменений:
 *   npm run migrate:6.67-6.68:check
 *
 * SQL-файлы сами управляют транзакциями и являются идемпотентными. Скрипт
 * получает advisory lock, чтобы два администратора не запустили их одновременно.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_LOCK_ID = 667668;
const MIGRATIONS = [
  {
    version: '6.67',
    title: 'справочник медцентров и юрлиц',
    file: 'ver. 6.67 med-centers-registry.sql',
    requiredTables: ['organizations'],
    requiredColumns: [
      ['med_centers', 'code'],
      ['med_centers', 'organizationId'],
      ['med_centers', 'misClinicIds'],
      ['med_centers', 'isActive'],
    ],
  },
  {
    version: '6.68',
    title: 'складской учёт',
    file: 'ver. 6.68 warehouse.sql',
    requiredTables: [
      'warehouse_specialties',
      'warehouse_buildings',
      'warehouse_assets',
      'warehouse_stock',
      'warehouse_movements',
      'warehouse_inventory_sessions',
      'warehouse_rfq',
      'warehouse_outbox',
    ],
    requiredColumns: [],
  },
].map(migration => ({
  ...migration,
  path: path.join(__dirname, '..', 'migrations', migration.file),
}));

async function assertBaseSchema() {
  const [rows] = await sequelize.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('users', 'roles', 'med_centers')
  `);
  const found = new Set(rows.map(row => row.tablename));
  const missing = ['users', 'roles', 'med_centers'].filter(table => !found.has(table));
  if (missing.length) throw new Error(`не найдены обязательные таблицы: ${missing.join(', ')}`);
}

async function getState(migration) {
  const tableNames = [...new Set([
    ...migration.requiredTables,
    ...migration.requiredColumns.map(([table]) => table),
  ])];

  const [tableRows] = await sequelize.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN (:tableNames)
  `, { replacements: { tableNames } });

  let columnRows = [];
  if (migration.requiredColumns.length) {
    [columnRows] = await sequelize.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ${migration.requiredColumns.map((_, index) => `(:t${index}, :c${index})`).join(', ')}
        )
    `, {
      replacements: migration.requiredColumns.reduce((values, [table, column], index) => {
        values[`t${index}`] = table;
        values[`c${index}`] = column;
        return values;
      }, {}),
    });
  }

  return {
    tables: new Set(tableRows.map(row => row.tablename)),
    columns: new Set(columnRows.map(row => `${row.table_name}.${row.column_name}`)),
  };
}

function stateIsComplete(migration, state) {
  return migration.requiredTables.every(table => state.tables.has(table))
    && migration.requiredColumns.every(([table, column]) => state.columns.has(`${table}.${column}`));
}

function printState(migration, state) {
  const ready = stateIsComplete(migration, state);
  console.log(`   ${ready ? '✓' : '○'} ver. ${migration.version}: ${ready ? 'применена' : 'не применена полностью'}`);
}

async function readStates() {
  const states = new Map();
  for (const migration of MIGRATIONS) states.set(migration.version, await getState(migration));
  return states;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let lockHeld = false;

  console.log('\n▶ Миграции ver. 6.67–6.68\n');
  for (const migration of MIGRATIONS) {
    if (!fs.existsSync(migration.path)) throw new Error(`не найден файл: ${migration.path}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}:${sequelize.config.port}`);
  await assertBaseSchema();

  let states = await readStates();
  console.log('\n   Состояние:');
  for (const migration of MIGRATIONS) printState(migration, states.get(migration.version));

  if (checkOnly) {
    if (MIGRATIONS.some(migration => !stateIsComplete(migration, states.get(migration.version)))) {
      console.log('\n⚠️  Есть неприменённые миграции. Запустите npm run migrate:6.67-6.68\n');
      process.exitCode = 2;
    } else {
      console.log('\n✅ Обе миграции применены\n');
    }
    return;
  }

  connection = await sequelize.connectionManager.getConnection();
  try {
    await connection.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockHeld = true;

    // Повторная проверка после lock: другой процесс мог завершить миграцию,
    // пока этот запуск ожидал соединение.
    states = await readStates();
    for (const migration of MIGRATIONS) {
      if (stateIsComplete(migration, states.get(migration.version))) {
        console.log(`\n   ✓ ver. ${migration.version} уже применена, пропускаю`);
        continue;
      }

      console.log(`\n   → Применяю ver. ${migration.version}: ${migration.title}`);
      await connection.query(fs.readFileSync(migration.path, 'utf8'));

      const after = await getState(migration);
      if (!stateIsComplete(migration, after)) {
        throw new Error(`итоговая проверка ver. ${migration.version} не пройдена`);
      }
      console.log(`   ✓ ver. ${migration.version} готова`);
    }

    console.log('\n✅ Миграции 6.67 и 6.68 успешно применены');
    console.log('   Перезапустите backend. Демо-сид склада автоматически не запускается.\n');
  } finally {
    if (connection && lockHeld) {
      await connection.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    }
    if (connection) await sequelize.connectionManager.releaseConnection(connection).catch(() => {});
  }
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграции не выполнены: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
