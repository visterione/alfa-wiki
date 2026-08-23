#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.27 — закрытый доступ к вложениям чатов.
 *
 * Создаёт реестр chat_files («файл → чат») и заполняет его по уже отправленным
 * сообщениям. Без этого реестра раздача файлов не сможет ответить, кому файл
 * показывать, и все исторические вложения станут недоступны — поэтому скрипт
 * отдельно сверяет, что после заполнения в реестре есть строка на каждое
 * вложение из messages.
 *
 * Запуск из backend/:
 *   npm run migrate:chat-files
 *
 * Только проверка, без изменений:
 *   npm run migrate:chat-files:check
 *
 * SQL идемпотентен, повторный запуск безопасен.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.27 chat-file-access.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

async function tableExists(tableName) {
  const [[row]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = :tableName
    ) AS present
  `, { replacements: { tableName } });
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

// Сколько вложений лежит в сообщениях и сколько из них уже описано в реестре.
// Считаем по паре «имя файла + чат»: одно и то же имя живёт в нескольких чатах,
// если сообщение пересылали.
async function countAttachments() {
  const [[row]] = await sequelize.query(`
    WITH attached AS (
      SELECT DISTINCT
        regexp_replace(COALESCE(a->>'path', a->>'url'), '^.*/', '') AS filename,
        m."chatId" AS chat_id
      FROM messages m
      CROSS JOIN LATERAL jsonb_array_elements(m.attachments) AS a
      WHERE jsonb_typeof(m.attachments) = 'array'
        AND COALESCE(a->>'path', a->>'url', '') <> ''
    )
    SELECT
      (SELECT count(*) FROM attached)::int AS total,
      (SELECT count(*) FROM attached at
        WHERE NOT EXISTS (
          SELECT 1 FROM chat_files cf
          WHERE cf.filename = at.filename AND cf."chatId" = at.chat_id
        ))::int AS missing
  `);
  return { total: Number(row.total), missing: Number(row.missing) };
}

async function getState() {
  const table = await tableExists('chat_files');
  if (!table) {
    return { table, uniqueIndex: false, filenameIndex: false, attachments: null };
  }
  const [uniqueIndex, filenameIndex, attachments] = await Promise.all([
    indexExists('chat_files_filename_chat_uniq'),
    indexExists('chat_files_filename_idx'),
    countAttachments(),
  ]);
  return { table, uniqueIndex, filenameIndex, attachments };
}

function stateIsComplete(state) {
  return state.table
    && state.uniqueIndex
    && state.filenameIndex
    && state.attachments
    && state.attachments.missing === 0;
}

function printState(state) {
  console.log(`   ${state.table ? '✓' : '✗'} таблица chat_files`);
  console.log(`   ${state.uniqueIndex ? '✓' : '✗'} индекс chat_files_filename_chat_uniq`);
  console.log(`   ${state.filenameIndex ? '✓' : '✗'} индекс chat_files_filename_idx`);
  if (state.attachments) {
    const { total, missing } = state.attachments;
    console.log(`   ${missing === 0 ? '✓' : '✗'} вложений в сообщениях: ${total}, не попало в реестр: ${missing}`);
  } else {
    console.log('   – вложения не сверялись: таблицы ещё нет');
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.27 — доступ к вложениям чатов\n');
  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`не найден файл миграции: ${MIGRATION_PATH}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(stateIsComplete(before)
      ? '\n✅ Миграция 7.27 применена\n'
      : '\n⚠️  Схема не готова — запустите npm run migrate:chat-files\n');
    return;
  }

  if (stateIsComplete(before)) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
    return;
  }

  console.log('\n   Применяю SQL:');
  console.log(`   → ${MIGRATION_FILE}`);
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  await sequelize.transaction(transaction => sequelize.query(sql, { transaction }));

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!stateIsComplete(after)) {
    throw new Error('итоговая проверка не пройдена: часть вложений осталась вне реестра');
  }

  console.log('\n✅ Миграция 7.27 успешно применена');
  console.log('   Перезапустите backend после выкладки нового кода.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
