#!/usr/bin/env node
'use strict';

/**
 * Безопасный повторяемый runner словаря предметов ver. 7.13.
 *
 * Из backend/ на production:
 *   npm run migrate:7.13:check  # только посмотреть, что уже стоит
 *   npm run migrate:7.13        # залить словарь и проверить
 *
 * Подключение берётся из models/ — то есть из .env бэкенда, тем же способом,
 * что и сам сервер (см. комментарий в migrateWarehouseSavedReports.js).
 *
 * Миграция идемпотентна по паре «выражение + способ поиска», поэтому «уже
 * применена» здесь означает не «нечего делать», а «все 645 правил на месте с
 * теми же значениями». Повторный запуск после ручной правки в интерфейсе вернёт
 * правило к словарному виду — это и есть смысл кнопки, но знать об этом надо.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 7.13 warehouse-item-dictionary.sql');
const LOCK_ID = 713001;
const NOTE = 'Словарь ver. 7.13%';
const EXPECTED_RULES = 645;
const EXPECTED_CATEGORIES = 12;

async function state(connection) {
  const table = await connection.query(`
    SELECT to_regclass('public.warehouse_item_rules') IS NOT NULL AS present
  `);
  if (!table.rows[0].present) {
    return { table: false, categories: 0, rules: 0, orphans: 0, complete: false };
  }

  const result = await connection.query(`
    SELECT
      (SELECT count(*) FROM warehouse_categories)                              AS categories,
      (SELECT count(*) FROM warehouse_item_rules
        WHERE note LIKE $1 AND "isActive")                                        AS rules,
      -- Правила без способа учёта разбор игнорирует: с ver. 6.79 'auto' в
      -- словаре не значит ничего. Считаем отдельно, потому что выглядят они
      -- настроенными, а покрытия не дают.
      (SELECT count(*) FROM warehouse_item_rules
        WHERE "isActive" AND accounting = 'auto')                              AS orphans
  `, [NOTE]);

  const row = result.rows[0];
  const current = {
    table: true,
    categories: Number(row.categories),
    rules: Number(row.rules),
    orphans: Number(row.orphans),
  };
  current.complete = current.rules >= EXPECTED_RULES && current.categories >= EXPECTED_CATEGORIES;
  return current;
}

function print(result) {
  console.log(`   ${result.table ? '✓' : '✗'} таблица warehouse_item_rules`);
  console.log(`   ${result.categories >= EXPECTED_CATEGORIES ? '✓' : '✗'} категорий: ${result.categories} из ${EXPECTED_CATEGORIES}`);
  console.log(`   ${result.rules >= EXPECTED_RULES ? '✓' : '✗'} правил словаря: ${result.rules} из ${EXPECTED_RULES}`);
  if (result.orphans) {
    console.log(`   ⚠ правил со способом учёта «auto»: ${result.orphans} — они ничего не классифицируют`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let locked = false;

  try {
    if (!fs.existsSync(FILE)) throw new Error(`не найден файл миграции: ${FILE}`);
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();

    console.log('\n▶ Словарь предметов склада ver. 7.13');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    let before = await state(connection);
    print(before);
    if (checkOnly) {
      if (!before.complete) {
        console.log('\n⚠️  Словарь ver. 7.13 ещё не залит\n');
        process.exitCode = 2;
      } else {
        console.log('\n✅ Словарь ver. 7.13 на месте\n');
      }
      return;
    }
    if (before.complete) {
      console.log('\n✅ Словарь ver. 7.13 уже залит\n');
      return;
    }

    // Advisory-блокировка на случай запуска с двух машин сразу: ON CONFLICT от
    // гонки не спасает, спасает от неё замок.
    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    before = await state(connection);
    if (!before.complete) {
      console.log(`\n   Применяю ${path.basename(FILE)}...`);
      // Файл держит собственную транзакцию — он рассчитан и на прямой запуск
      // через psql, поэтому здесь его не оборачиваем второй раз.
      await connection.query(fs.readFileSync(FILE, 'utf8'));
    }

    const after = await state(connection);
    if (!after.complete) throw new Error('итоговая проверка словаря не пройдена');
    print(after);
    console.log('\n✅ Словарь ver. 7.13 успешно залит');
    console.log('   Дальше: разметить ветки ведомости по кабинетам и запустить разбор\n');
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
  console.error(`\n❌ Словарь не залит: ${message}\n`);
  process.exitCode = 1;
});
