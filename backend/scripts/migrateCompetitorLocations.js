#!/usr/bin/env node
'use strict';

/**
 * Миграция адресов точек конкурентов (ver. 6.19) — создаёт competitor_locations.
 *
 * Запуск на сервере:
 *   cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/backend
 *   node scripts/migrateCompetitorLocations.js
 *
 * Требует применённой ver. 6.16. Идемпотентный.
 *
 * Флаги:
 *   --check   только проверить, ничего не менять
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.19 competitor-locations.sql');
sequelize.options.logging = false;

const EXPECTED_INDEXES = ['competitor_locations_parser_uq', 'competitor_locations_source_idx'];

async function tableExists(table) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=:table`,
    { replacements: { table } }
  );
  return rows.length > 0;
}

async function printState(prefix) {
  const has = await tableExists('competitor_locations');
  if (has) {
    const [[{ count }]] = await sequelize.query('SELECT count(*)::int AS count FROM competitor_locations');
    console.log(`   ${prefix} competitor_locations — есть, записей: ${count}`);
  } else {
    console.log('   ✗  competitor_locations — НЕТ');
  }

  const [rows] = await sequelize.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='competitor_locations'`
  );
  const names = rows.map(r => r.indexname);
  const missing = EXPECTED_INDEXES.filter(i => !names.includes(i));
  if (missing.length) console.log(`   ✗  не хватает индексов: ${missing.join(', ')}`);

  return has && missing.length === 0;
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('');
  console.log('▶ Миграция ver. 6.19 — адреса точек конкурентов');
  console.log('');

  if (!fs.existsSync(MIGRATION_FILE)) throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);
  console.log('');

  if (!(await tableExists('competitor_sources'))) {
    throw new Error('сначала нужно применить ver. 6.16: node scripts/migrateCompetitorPrices.js');
  }

  console.log('   Состояние до:');
  const before = await printState('•');
  console.log('');

  if (checkOnly) {
    console.log(before ? '✅ Миграция уже применена' : '⚠️  Миграция не применена — запустите без --check');
    console.log('');
    return;
  }

  if (before) {
    console.log('✅ Уже применена, ничего делать не нужно');
    console.log('');
    return;
  }

  console.log('   Применяю...');
  await sequelize.query(fs.readFileSync(MIGRATION_FILE, 'utf8'));
  console.log('');

  console.log('   Состояние после:');
  if (!(await printState('✓'))) throw new Error('часть объектов не создалась — см. вывод выше');
  console.log('');

  console.log('✅ Готово');
  console.log('');
  console.log('   Адреса приедут при ближайшем заборе цен:');
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
