#!/usr/bin/env node
'use strict';

/**
 * Локальный production-runner миграций ver. 6.67–6.70.
 *
 * PostgreSQL вызывается через системного пользователя postgres и Unix-сокет.
 * Поэтому runner не зависит от DB_PASSWORD/DB_HOST и подходит для запуска по SSH:
 *
 *   npm run migrate:6.67-6.68:check
 *   npm run migrate:6.67-6.68
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = process.env.DB_NAME || 'alfa_wiki';
const migrations = [
  path.join(__dirname, '..', 'migrations', 'ver. 6.67 med-centers-registry.sql'),
  path.join(__dirname, '..', 'migrations', 'ver. 6.68 warehouse.sql'),
  path.join(__dirname, '..', 'migrations', 'ver. 6.69 warehouse-floor-outline.sql'),
  path.join(__dirname, '..', 'migrations', 'ver. 6.70 warehouse-operations.sql'),
];

function runPsql(args) {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', database, ...args],
    { stdio: 'inherit' }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql завершился с кодом ${result.status}`);
}

function check() {
  console.log(`\n▶ Проверка миграций 6.67–6.70 в базе ${database}\n`);
  runPsql(['-c', `
    SELECT
      to_regclass('public.organizations') IS NOT NULL AS "6.67 organizations",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'med_centers'
          AND column_name = 'misClinicIds'
      ) AS "6.67 med_centers",
      to_regclass('public.warehouse_assets') IS NOT NULL AS "6.68 assets",
      to_regclass('public.warehouse_outbox') IS NOT NULL AS "6.68 outbox",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'warehouse_floors' AND column_name = 'outline'
      ) AS "6.69 floor outline",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'warehouse_inventory_sessions'
          AND column_name = 'differencesPostedAt'
      ) AS "6.70 inventory differences";
  `]);
}

function main() {
  for (const file of migrations) {
    if (!fs.existsSync(file)) throw new Error(`не найден SQL-файл: ${file}`);
  }

  if (process.argv.includes('--check')) {
    check();
    return;
  }

  console.log(`\n▶ Миграции ver. 6.67–6.70, база ${database}\n`);
  for (const file of migrations) {
    console.log(`\n→ ${path.basename(file)}`);
    runPsql(['-f', file]);
  }

  console.log('\n✅ Миграции 6.67–6.70 успешно применены\n');
  check();
}

try {
  main();
} catch (error) {
  console.error(`\n❌ Миграции не выполнены: ${error.message}\n`);
  process.exitCode = 1;
}
