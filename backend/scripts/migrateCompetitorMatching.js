#!/usr/bin/env node
'use strict';

/**
 * Миграция сопоставления услуг конкурентов (ver. 6.17).
 *
 * Создаёт competitor_service_matches, добавляет competitor_sources."competitorLabel",
 * competitor_services."nameNormalized" с триграммным индексом и
 * price_comparison_items."priceSources".
 *
 * Запуск на сервере:
 *   cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/backend
 *   node scripts/migrateCompetitorMatching.js
 *
 * Требует применённой ver. 6.16 (зеркало прайсов) — скрипт это проверяет.
 * Идемпотентный: повторный запуск ничего не ломает.
 *
 * Флаги:
 *   --check   только проверить, ничего не менять
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.17 competitor-matching.sql');

sequelize.options.logging = false;

const EXPECTED_INDEXES = [
  'competitor_matches_pair_uq',
  'competitor_services_name_trgm'
];

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = :table AND column_name = :column`,
    { replacements: { table, column } }
  );
  return rows.length > 0;
}

async function tableExists(table) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = :table`,
    { replacements: { table } }
  );
  return rows.length > 0;
}

async function indexExists(name) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = :name`,
    { replacements: { name } }
  );
  return rows.length > 0;
}

async function printState(prefix) {
  const checks = [
    ['таблица competitor_service_matches',            await tableExists('competitor_service_matches')],
    ['competitor_sources."competitorLabel"',          await columnExists('competitor_sources', 'competitorLabel')],
    ['competitor_services."nameNormalized"',          await columnExists('competitor_services', 'nameNormalized')],
    ['price_comparison_items."priceSources"',         await columnExists('price_comparison_items', 'priceSources')],
  ];

  for (const [label, ok] of checks) {
    console.log(ok ? `   ${prefix} ${label} — есть` : `   ✗  ${label} — НЕТ`);
  }

  const missingIndexes = [];
  for (const name of EXPECTED_INDEXES) {
    if (!(await indexExists(name))) missingIndexes.push(name);
  }
  if (missingIndexes.length) console.log(`   ✗  не хватает индексов: ${missingIndexes.join(', ')}`);

  return { ok: checks.every(([, ok]) => ok) && missingIndexes.length === 0 };
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('');
  console.log('▶ Миграция ver. 6.17 — сопоставление услуг конкурентов');
  console.log('');

  if (!fs.existsSync(MIGRATION_FILE)) {
    throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);
  }

  await sequelize.authenticate();
  const { database, host } = sequelize.config;
  console.log(`   База: ${database} на ${host}`);
  console.log('');

  // Без зеркала прайсов сопоставлять нечего — говорим об этом прямо,
  // а не падаем на отсутствующей таблице в середине SQL
  if (!(await tableExists('competitor_services'))) {
    throw new Error('сначала нужно применить ver. 6.16: node scripts/migrateCompetitorPrices.js');
  }

  console.log('   Состояние до:');
  const before = await printState('•');
  console.log('');

  if (checkOnly) {
    console.log(before.ok ? '✅ Миграция уже применена' : '⚠️  Миграция не применена — запустите без --check');
    console.log('');
    return;
  }

  if (before.ok) {
    console.log('✅ Уже применена, ничего делать не нужно');
    console.log('');
    return;
  }

  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  console.log('   Применяю...');
  await sequelize.query(sql);
  console.log('');

  console.log('   Состояние после:');
  const after = await printState('✓');
  console.log('');

  if (!after.ok) throw new Error('после применения часть объектов отсутствует — проверьте вывод выше');

  const [[{ count }]] = await sequelize.query(
    'SELECT count(*)::int AS count FROM competitor_services WHERE "nameNormalized" IS NOT NULL'
  );
  console.log(`✅ Готово. Названий подготовлено к поиску: ${count}`);
  console.log('');
  console.log('   Дальше: в разделе «Парсер цен» проставить каждому источнику,');
  console.log('   как он называется в сравнениях, и запустить подбор соответствий.');
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
