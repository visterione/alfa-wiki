#!/usr/bin/env node
'use strict';

/**
 * Миграция карточки клиники-конкурента (ver. 6.18) — название и логотип
 * в competitor_sources.
 *
 * Запуск на сервере:
 *   cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/backend
 *   node scripts/migrateCompetitorBranding.js
 *
 * Требует применённой ver. 6.16. Идемпотентный.
 *
 * Флаги:
 *   --check   только проверить, ничего не менять
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.18 competitor-branding.sql');
sequelize.options.logging = false;

const COLUMNS = ['displayName', 'logoUrl', 'logoData', 'logoContentType'];

async function existing() {
  const [rows] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'competitor_sources'`
  );
  return rows.map(r => r.column_name);
}

async function printState(prefix) {
  const have = await existing();
  for (const column of COLUMNS) {
    console.log(have.includes(column) ? `   ${prefix} "${column}" — есть` : `   ✗  "${column}" — НЕТ`);
  }
  return COLUMNS.every(c => have.includes(c));
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('');
  console.log('▶ Миграция ver. 6.18 — название и логотип клиники-конкурента');
  console.log('');

  if (!fs.existsSync(MIGRATION_FILE)) throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);
  console.log('');

  const [tables] = await sequelize.query(
    `SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='competitor_sources'`
  );
  if (!tables.length) {
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
  if (!(await printState('✓'))) throw new Error('часть колонок не создалась — см. вывод выше');
  console.log('');

  console.log('✅ Готово');
  console.log('');
  console.log('   Названия и логотипы приедут при ближайшем заборе цен:');
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
