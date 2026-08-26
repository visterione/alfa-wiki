#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.50 — сторнирующий документ.
 *
 * Добавляет warehouse_documents."reversalOfId" и уникальный индекс по нему:
 * дважды один документ не отменяется. Зачем это нужно и что именно отменяется —
 * в services/warehouse/reversal.js и в самом файле миграции.
 *
 * Порядок важен: колонка нужна ДО перезапуска бэкенда. Модель документа уже
 * знает про reversalOfId, и первый же запрос списка операций на старой схеме
 * упадёт с «column reversalOfId does not exist».
 *
 * Запуск из backend/:
 *   npm run migrate:7.50
 *
 * Только проверка, без изменений:
 *   npm run migrate:7.50:check
 *
 * Повторный запуск безопасен: и колонка, и индекс создаются с IF NOT EXISTS.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.50 warehouse-document-reversal.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

async function columnExists(tableName, columnName) {
  const [[row]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = :tableName
         AND column_name = :columnName
    ) AS present
  `, { replacements: { tableName, columnName } });
  return Boolean(row.present);
}

async function indexExists(indexName) {
  const [[row]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = :indexName
    ) AS present
  `, { replacements: { indexName } });
  return Boolean(row.present);
}

async function getState() {
  const column = await columnExists('warehouse_documents', 'reversalOfId');
  const index = await indexExists('warehouse_documents_reversal_uniq');
  if (!column) return { column, index, documents: null, reversals: null };

  const [[row]] = await sequelize.query(`
    SELECT count(*)::int AS documents,
           count(*) FILTER (WHERE "reversalOfId" IS NOT NULL)::int AS reversals
      FROM warehouse_documents
  `);
  return { column, index, documents: Number(row.documents), reversals: Number(row.reversals) };
}

function report(state, prefix) {
  console.log(`${prefix}:`);
  console.log(`  колонка reversalOfId: ${state.column ? 'есть' : 'НЕТ'}`);
  console.log(`  индекс «одно сторно на документ»: ${state.index ? 'есть' : 'НЕТ'}`);
  if (state.documents !== null) {
    console.log(`  документов: ${state.documents}, из них сторно: ${state.reversals}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  const before = await getState();
  report(before, checkOnly ? 'Состояние' : 'До миграции');

  const done = state => state.column && state.index;

  if (checkOnly) {
    console.log(done(before) ? '\nМиграция не нужна.' : '\nМиграцию нужно применить: npm run migrate:7.50');
    await sequelize.close();
    process.exit(done(before) ? 0 : 1);
  }

  if (done(before)) {
    console.log('\nВсё на месте, менять нечего.');
    await sequelize.close();
    return;
  }

  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  await sequelize.transaction(async (t) => {
    await sequelize.query(sql, { transaction: t });
  });

  const after = await getState();
  report(after, '\nПосле миграции');

  if (!done(after)) {
    console.error('\nЧто-то не создалось — смотрите вывод выше.');
    await sequelize.close();
    process.exit(1);
  }

  console.log('\nГотово. Перезапустите бэкенд: pm2 restart alfa-wiki');
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('Миграция не прошла:', err.message);
  await sequelize.close();
  process.exit(1);
});
