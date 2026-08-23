#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.31 — триграммные индексы под поиск по переписке.
 *
 * Ничего не переписывает в данных: добавляет расширение pg_trgm и два GIN-
 * индекса, которые планировщик подхватывает сам для ILIKE '%…%'. Сами запросы
 * поиска остались прежними.
 *
 * Индексы строятся CONCURRENTLY и потому вне транзакции. На боевой таблице
 * сообщений это занимает минуты — чат при этом работает.
 *
 * Запуск из backend/:
 *   npm run migrate:message-search
 *
 * Только проверка, без изменений:
 *   npm run migrate:message-search:check
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.31 message-search-trgm.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);
const INDEXES = ['messages_content_trgm_idx', 'messages_attachments_trgm_idx'];

// CREATE INDEX CONCURRENTLY нельзя выполнять в транзакции, а драйвер
// оборачивает в неё любой запрос из нескольких команд сразу. Поэтому файл
// разбирается на отдельные команды и каждая уходит своей.
function splitStatements(sql) {
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

async function extensionInstalled(name) {
  const [[row]] = await sequelize.query(
    'SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = :name) AS present',
    { replacements: { name } }
  );
  return Boolean(row.present);
}

async function indexIsValid(indexName) {
  // Прерванный CONCURRENTLY оставляет индекс существующим, но нерабочим
  const [[row]] = await sequelize.query(`
    SELECT COALESCE(bool_or(i.indisvalid), false) AS valid
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = :indexName
  `, { replacements: { indexName } });
  return Boolean(row.valid);
}

async function getState() {
  const [trgm, ...indexes] = await Promise.all([
    extensionInstalled('pg_trgm'),
    ...INDEXES.map(indexIsValid),
  ]);
  return { trgm, indexes: Object.fromEntries(INDEXES.map((name, i) => [name, indexes[i]])) };
}

function stateIsComplete(state) {
  return state.trgm && INDEXES.every(name => state.indexes[name]);
}

function printState(state) {
  console.log(`   ${state.trgm ? '✓' : '✗'} расширение pg_trgm`);
  for (const name of INDEXES) {
    console.log(`   ${state.indexes[name] ? '✓' : '✗'} индекс ${name}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.31 — поиск по переписке\n');
  if (!fs.existsSync(MIGRATION_PATH)) throw new Error(`не найден файл миграции: ${MIGRATION_PATH}`);

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(stateIsComplete(before)
      ? '\n✅ Миграция 7.31 применена\n'
      : '\n⚠️  Индексы не готовы — запустите npm run migrate:message-search\n');
    return;
  }

  if (stateIsComplete(before)) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
    return;
  }

  console.log('\n   Применяю SQL (без транзакции, может занять минуты):');
  console.log(`   → ${MIGRATION_FILE}`);
  for (const statement of splitStatements(fs.readFileSync(MIGRATION_PATH, 'utf8'))) {
    console.log(`     · ${statement.split('\n')[0].slice(0, 70)}…`);
    await sequelize.query(statement);
  }

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!stateIsComplete(after)) throw new Error('итоговая проверка не пройдена');

  console.log('\n✅ Миграция 7.31 успешно применена');
  console.log('   Перезапуск backend не требуется: запросы поиска не менялись.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
