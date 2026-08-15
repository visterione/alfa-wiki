#!/usr/bin/env node
'use strict';

/**
 * Production runner for database migrations ver. 6.77-6.80.
 *
 * Run from backend/:
 *   npm run migrate:6.77-6.80:check
 *   npm run migrate:6.77-6.80
 *
 * The runner uses the database settings from backend/.env, serializes deploys
 * with a PostgreSQL advisory lock and verifies every migration after applying
 * it. Each SQL file owns its transaction and is safe to run repeatedly.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const LOCK_ID = 677680;
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const migrations = [
  {
    version: '6.77',
    filename: 'ver. 6.77 task-work-schedules.sql',
    checks: [
      ['users.taskWorkSchedule', `EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'
          AND column_name = 'taskWorkSchedule'
      )`],
      ['task_schedule_changes', `to_regclass('public.task_schedule_changes') IS NOT NULL`],
      ['task_schedule_changes_user_created_idx',
        `to_regclass('public.task_schedule_changes_user_created_idx') IS NOT NULL`],
    ],
  },
  {
    version: '6.78',
    filename: 'ver. 6.78 private-task-teams.sql',
    checks: [
      ['все команды закрыты', `NOT EXISTS (
        SELECT 1 FROM task_teams WHERE access <> 'members' OR "isHidden" IS NOT TRUE
      )`],
      ['access по умолчанию members', `COALESCE((
        SELECT column_default IN ('''members''::character varying', '''members''::varchar')
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'task_teams' AND column_name = 'access'
      ), FALSE)`],
      ['isHidden по умолчанию true', `COALESCE((
        SELECT column_default = 'true'
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'task_teams' AND column_name = 'isHidden'
      ), FALSE)`],
      ['ограничение task_teams_private_access', `EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'task_teams'::regclass AND conname = 'task_teams_private_access'
      )`],
      ['ограничение task_teams_always_hidden', `EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'task_teams'::regclass AND conname = 'task_teams_always_hidden'
      )`],
    ],
  },
  {
    version: '6.79',
    filename: 'ver. 6.79 warehouse-item-rules.sql',
    checks: [
      ['warehouse_item_rules', `to_regclass('public.warehouse_item_rules') IS NOT NULL`],
      ['warehouse_item_rules_pattern_uniq',
        `to_regclass('public.warehouse_item_rules_pattern_uniq') IS NOT NULL`],
      ['ограничения словаря', `(
        SELECT count(*) = 3 FROM pg_constraint
        WHERE conrelid = 'warehouse_item_rules'::regclass
          AND conname IN (
            'warehouse_item_rules_match_chk',
            'warehouse_item_rules_accounting_chk',
            'warehouse_item_rules_pattern_chk'
          )
      )`],
      ['базовые категории склада', `(
        SELECT count(DISTINCT name) = 12 FROM warehouse_categories
        WHERE name = ANY(ARRAY[
          'Медицинское оборудование', 'Медицинский инструмент', 'Оргтехника и ИТ',
          'Мебель', 'Бытовая техника', 'Инженерное оборудование',
          'Хозяйственный инвентарь', 'Расходные материалы',
          'Лекарственные препараты', 'Текстиль и мягкий инвентарь',
          'Хозяйственные материалы', 'Канцелярия'
        ]::text[])
      )`],
    ],
  },
  {
    version: '6.80',
    filename: 'ver. 6.80 warehouse-osv-placements.sql',
    checks: [
      ['warehouse_osv_placements',
        `to_regclass('public.warehouse_osv_placements') IS NOT NULL`],
      ['warehouse_osv_placements_uniq',
        `to_regclass('public.warehouse_osv_placements_uniq') IS NOT NULL`],
      ['warehouse_osv_placements_room_idx',
        `to_regclass('public.warehouse_osv_placements_room_idx') IS NOT NULL`],
      ['ограничение положительного количества', `EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'warehouse_osv_placements'::regclass
          AND conname = 'warehouse_osv_placements_qty_chk'
      )`],
      ['warehouse_assets.osvPlacementId', `EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'warehouse_assets'
          AND column_name = 'osvPlacementId'
      )`],
      ['warehouse_assets_osv_placement_idx',
        `to_regclass('public.warehouse_assets_osv_placement_idx') IS NOT NULL`],
    ],
  },
];

async function assertPrerequisites(connection) {
  const required = [
    'users',
    'task_teams',
    'warehouse_categories',
    'warehouse_rooms',
    'warehouse_storages',
    'warehouse_assets',
  ];
  const result = await connection.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ANY($1::text[])
  `, [required]);
  const existing = new Set(result.rows.map(row => row.tablename));
  const missing = required.filter(table => !existing.has(table));
  if (missing.length) {
    throw new Error(
      `не найдены обязательные таблицы: ${missing.join(', ')}. `
      + 'Сначала примените миграции до 6.76 включительно'
    );
  }
}

async function getState(connection, migration) {
  // Some checks refer to objects created by the migration. Evaluate them only
  // after their main table exists, otherwise PostgreSQL cannot resolve regclass.
  const mainTable = {
    '6.77': 'task_schedule_changes',
    '6.78': 'task_teams',
    '6.79': 'warehouse_item_rules',
    '6.80': 'warehouse_osv_placements',
  }[migration.version];
  const existsResult = await connection.query(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [`public.${mainTable}`]
  );

  if (!existsResult.rows[0].exists && ['6.79', '6.80'].includes(migration.version)) {
    return {
      complete: false,
      checks: migration.checks.map(([label]) => ({ label, ok: false })),
    };
  }

  const select = migration.checks
    .map(([, expression], index) => `(${expression}) AS check_${index}`)
    .join(',\n');
  const result = await connection.query(`SELECT ${select}`);
  const checks = migration.checks.map(([label], index) => ({
    label,
    ok: result.rows[0][`check_${index}`] === true,
  }));
  return { checks, complete: checks.every(check => check.ok) };
}

function printState(migration, state) {
  console.log(`\n   ver. ${migration.version}`);
  for (const check of state.checks) {
    console.log(`   ${check.ok ? '✓' : '✗'} ${check.label}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let lockHeld = false;

  for (const migration of migrations) {
    migration.file = path.join(MIGRATIONS_DIR, migration.filename);
    if (!fs.existsSync(migration.file)) {
      throw new Error(`не найден файл миграции: ${migration.file}`);
    }
  }

  try {
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();
    console.log('\n▶ Миграции ver. 6.77-6.80');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);
    await assertPrerequisites(connection);

    if (checkOnly) {
      let complete = true;
      for (const migration of migrations) {
        const state = await getState(connection, migration);
        printState(migration, state);
        complete = complete && state.complete;
      }
      if (!complete) {
        console.log('\n⚠️  Не все миграции применены\n');
        process.exitCode = 2;
      } else {
        console.log('\n✅ Все миграции применены\n');
      }
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    lockHeld = true;

    for (const migration of migrations) {
      let state = await getState(connection, migration);
      printState(migration, state);
      if (state.complete) {
        console.log('   Уже применена');
        continue;
      }

      console.log(`   Применяю ${migration.filename}...`);
      try {
        await connection.query(fs.readFileSync(migration.file, 'utf8'));
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw new Error(`ver. ${migration.version}: ${error?.original?.message || error.message}`);
      }

      state = await getState(connection, migration);
      if (!state.complete) {
        throw new Error(`ver. ${migration.version}: итоговая проверка схемы не пройдена`);
      }
      console.log(`   ✓ ver. ${migration.version} применена`);
    }

    console.log('\n✅ Миграции 6.77-6.80 успешно применены\n');
  } finally {
    if (connection && lockHeld) {
      await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    }
    if (connection) {
      try {
        await sequelize.connectionManager.releaseConnection(connection);
      } catch (_) {
        // sequelize.close() below still closes the pool if release fails.
      }
    }
    await sequelize.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`\n❌ Миграции не выполнены: ${error.message}\n`);
  process.exitCode = 1;
});
