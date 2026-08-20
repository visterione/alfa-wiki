#!/usr/bin/env node
'use strict';

/**
 * Безопасный повторяемый runner миграции рассылок ver. 7.07.
 *
 * Из backend/ на production:
 *   npm run migrate:7.07:check  # только проверить состояние
 *   npm run migrate:7.07        # применить и проверить
 *
 * Подключение берётся из models/ — то есть из .env бэкенда, тем же способом, что
 * и сам сервер. Через psql то же самое требует заполненного DATABASE_URL, а без
 * него psql молча уходит на локальный сокет и роль по имени пользователя ОС.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 7.07 warehouse-mailing.sql');
const LOCK_ID = 707001;

async function state(connection) {
  const tables = await connection.query(`
    SELECT to_regclass('public.warehouse_mail_optouts') IS NOT NULL AS optouts,
           to_regclass('public.warehouse_mail_log')     IS NOT NULL AS log
  `);
  const { optouts, log } = tables.rows[0];
  if (!optouts || !log) {
    return { optouts, log, optoutsKey: false, logIndex: false, complete: false };
  }

  const result = await connection.query(`
    SELECT
      -- Первичный ключ по паре «человек + отчёт»: он и есть защита от второго
      -- отказа по тому же отчёту.
      EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'warehouse_mail_optouts'::regclass AND contype = 'p'
      ) AS optouts_key,
      -- Уникальный ключ прогона: ради него журнал и заведён — он делает
      -- повторную отправку невозможной на уровне базы.
      EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'warehouse_mail_log'
           AND indexname = 'warehouse_mail_log_run'
      ) AS log_index
  `);
  const row = result.rows[0];
  const current = {
    optouts: true,
    log: true,
    optoutsKey: row.optouts_key,
    logIndex: row.log_index,
  };
  current.complete = Object.values(current).every(Boolean);
  return current;
}

function print(result) {
  console.log(`   ${result.optouts ? '✓' : '✗'} таблица warehouse_mail_optouts (отказы от рассылки)`);
  console.log(`   ${result.optoutsKey ? '✓' : '✗'} ключ «человек + отчёт»`);
  console.log(`   ${result.log ? '✓' : '✗'} таблица warehouse_mail_log (журнал отправок)`);
  console.log(`   ${result.logIndex ? '✓' : '✗'} уникальный ключ прогона — защита от повторной отправки`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let locked = false;

  try {
    if (!fs.existsSync(FILE)) throw new Error(`не найден файл миграции: ${FILE}`);
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();

    console.log('\n▶ Миграция рассылок складских отчётов ver. 7.07');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    let before = await state(connection);
    print(before);
    if (checkOnly) {
      if (!before.complete) {
        console.log('\n⚠️  Миграция 7.07 ещё не применена\n');
        process.exitCode = 2;
      } else {
        console.log('\n✅ Миграция 7.07 применена\n');
      }
      return;
    }
    if (before.complete) {
      console.log('\n✅ Миграция 7.07 уже применена\n');
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
    console.log('\n✅ Миграция 7.07 успешно применена');
    console.log('   Дальше: npm run warehouse-mailer -- --dry\n');
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
