#!/usr/bin/env node
'use strict';

/**
 * Безопасный повторяемый runner миграции сохранённых отчётов ver. 7.11.
 *
 * Из backend/ на production:
 *   npm run migrate:7.11:check  # только проверить состояние
 *   npm run migrate:7.11        # применить и проверить
 *
 * Подключение берётся из models/ — то есть из .env бэкенда, тем же способом, что
 * и сам сервер. Через psql то же самое требует заполненного DATABASE_URL, а без
 * него psql молча уходит на локальный сокет и роль по имени пользователя ОС.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 7.11 warehouse-saved-reports.sql');
const LOCK_ID = 711001;

async function state(connection) {
  const table = await connection.query(`
    SELECT to_regclass('public.warehouse_saved_reports') IS NOT NULL AS present
  `);
  if (!table.rows[0].present) return { table: false, index: false, complete: false };

  const result = await connection.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'warehouse_saved_reports'
         AND indexname = 'warehouse_saved_reports_recent'
    ) AS idx
  `);
  const current = { table: true, index: result.rows[0].idx };
  current.complete = current.table && current.index;
  return current;
}

function print(result) {
  console.log(`   ${result.table ? '✓' : '✗'} таблица warehouse_saved_reports (снимки отчётов)`);
  console.log(`   ${result.index ? '✓' : '✗'} индекс «вид отчёта + свежесть» — по нему открывается список`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let locked = false;

  try {
    if (!fs.existsSync(FILE)) throw new Error(`не найден файл миграции: ${FILE}`);
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();

    console.log('\n▶ Миграция сохранённых складских отчётов ver. 7.11');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    let before = await state(connection);
    print(before);
    if (checkOnly) {
      if (!before.complete) {
        console.log('\n⚠️  Миграция 7.11 ещё не применена\n');
        process.exitCode = 2;
      } else {
        console.log('\n✅ Миграция 7.11 применена\n');
      }
      return;
    }
    if (before.complete) {
      console.log('\n✅ Миграция 7.11 уже применена\n');
      return;
    }

    // Advisory-блокировка на случай, если раннер запустят с двух машин сразу:
    // CREATE TABLE IF NOT EXISTS от гонки не спасает, спасает от неё замок.
    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    before = await state(connection);
    if (!before.complete) {
      console.log(`\n   Применяю ${path.basename(FILE)}...`);
      await connection.query('BEGIN');
      try {
        await connection.query(fs.readFileSync(FILE, 'utf8'));
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }

    const after = await state(connection);
    if (!after.complete) throw new Error('итоговая проверка схемы не пройдена');
    print(after);
    console.log('\n✅ Миграция 7.11 успешно применена\n');
  } finally {
    if (connection && locked) {
      await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    }
    if (connection) {
      try { await sequelize.connectionManager.releaseConnection(connection); } catch (_) {}
    }
    await sequelize.close().catch(() => {});
  }
}

main().catch(error => {
  const message = error?.original?.message || error?.parent?.message || error?.message
    || error?.original?.code || error?.name || String(error);
  console.error(`\n❌ Миграция не выполнена: ${message}\n`);
  process.exitCode = 1;
});
