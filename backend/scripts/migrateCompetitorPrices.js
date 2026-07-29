#!/usr/bin/env node
'use strict';

/**
 * Миграция зеркала прайсов конкурентов (ver. 6.16) — создаёт competitor_sources,
 * competitor_services, competitor_prices.
 *
 * Запуск на сервере:
 *   cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/backend
 *   node scripts/migrateCompetitorPrices.js
 *
 * Подключение берётся из backend/.env, отдельно вводить пароль не нужно.
 * Скрипт идемпотентный: повторный запуск ничего не ломает и не трогает данные.
 *
 * Флаги:
 *   --check   только проверить, что уже создано, ничего не менять
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.16 competitor-prices.sql');

// В dev-режиме sequelize сыплет SQL в консоль и забивает вывод скрипта
sequelize.options.logging = false;

const EXPECTED_TABLES = ['competitor_sources', 'competitor_services', 'competitor_prices'];
const EXPECTED_INDEXES = [
  'competitor_sources_parser_uq',
  'competitor_services_parser_uq',
  'competitor_services_codes_gin',
  'competitor_prices_filial_uq',
  'competitor_prices_nofilial_uq'
];

const TABLE_LIST = `ARRAY['competitor_sources','competitor_services','competitor_prices']`;

/** @returns {Promise<string[]>} Имена существующих таблиц из списка ожидаемых */
async function existingTables() {
  const [rows] = await sequelize.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ANY(${TABLE_LIST})
  `);
  return rows.map(r => r.tablename);
}

/** @returns {Promise<string[]>} Имена существующих индексов из списка ожидаемых */
async function existingIndexes() {
  const [rows] = await sequelize.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ANY(${TABLE_LIST})
  `);
  return rows.map(r => r.indexname);
}

async function printState(prefix) {
  const tables = await existingTables();
  const indexes = await existingIndexes();

  for (const table of EXPECTED_TABLES) {
    if (tables.includes(table)) {
      const [[{ count }]] = await sequelize.query(`SELECT count(*)::int AS count FROM ${table}`);
      console.log(`   ${prefix} ${table} — есть, записей: ${count}`);
    } else {
      console.log(`   ✗  ${table} — НЕТ`);
    }
  }

  const missingIndexes = EXPECTED_INDEXES.filter(i => !indexes.includes(i));
  if (missingIndexes.length) {
    console.log(`   ✗  не хватает индексов: ${missingIndexes.join(', ')}`);
  }

  return {
    tablesOk:  EXPECTED_TABLES.every(t => tables.includes(t)),
    indexesOk: missingIndexes.length === 0
  };
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('');
  console.log('▶ Миграция ver. 6.16 — зеркало прайсов конкурентов');
  console.log('');

  if (!fs.existsSync(MIGRATION_FILE)) {
    throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);
  }

  await sequelize.authenticate();
  const { database, host } = sequelize.config;
  console.log(`   База: ${database} на ${host}`);
  console.log('');

  console.log('   Состояние до:');
  const before = await printState('•');
  console.log('');

  if (checkOnly) {
    console.log(before.tablesOk && before.indexesOk
      ? '✅ Миграция уже применена'
      : '⚠️  Миграция не применена (или применена частично) — запустите без --check');
    console.log('');
    return;
  }

  if (before.tablesOk && before.indexesOk) {
    console.log('✅ Уже применена, ничего делать не нужно');
    console.log('');
    return;
  }

  // Выполняем ровно тот же SQL, что лежит в migrations/ — единый источник схемы.
  // Все команды в нём с IF NOT EXISTS, поэтому частично применённая миграция дойдёт до конца.
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  console.log('   Применяю...');
  await sequelize.query(sql);
  console.log('');

  console.log('   Состояние после:');
  const after = await printState('✓');
  console.log('');

  if (!after.tablesOk || !after.indexesOk) {
    throw new Error('после применения часть объектов отсутствует — проверьте вывод выше');
  }

  console.log('✅ Готово');
  console.log('');
  console.log('   Дальше: прописать в .env PARSER_BASE_URL и PARSER_API_TOKEN,');
  console.log('   затем pm2 restart alfa-wiki и первый забор данных:');
  console.log('   node scripts/syncCompetitorPrices.js');
  console.log('');
}

main()
  .then(() => sequelize.close())
  .catch(async err => {
    console.error('');
    console.error('❌ Миграция не выполнена:', err.message);
    console.error('');
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
