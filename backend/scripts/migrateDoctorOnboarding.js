#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.30 — онбординг врача.
 *
 * Создаёт семь таблиц модуля, последовательность номеров заявок и добавляет
 * всем пользователям флаг adminAccess.onboarding = false.
 *
 * Отдельно сверяет две вещи, без которых модуль внешне поднимется, а работать
 * будет неправильно:
 *
 *   • частичный уникальный индекс по e-mail — на нём держится правило «одна
 *     активная заявка на адрес». Публичная ссылка одна на всех, и две
 *     одновременные отправки формы обязаны разойтись на уровне базы, а не в
 *     приложении;
 *   • последовательность onb_application_number_seq — из неё берётся номер
 *     заявки. Без неё вставка упадёт на NOT NULL, и человек с улицы получит
 *     500 вместо анкеты.
 *
 * Запуск из backend/:
 *   npm run migrate:7.30
 *
 * Только проверка, без изменений:
 *   npm run migrate:7.30:check
 *
 * SQL идемпотентен, повторный запуск безопасен.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.30 doctor-onboarding.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

const TABLES = [
  'onb_applications',
  'onb_assignments',
  'onb_tasks',
  'onb_service_choices',
  'onb_files',
  'onb_events',
  'onb_email_codes',
];

const INDEXES = [
  'onb_applications_active_email_uniq',
  'onb_tasks_app_step_uniq',
  'onb_service_choices_app_service_uniq',
  'onb_files_filename_idx',
];

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

async function sequenceExists(sequenceName) {
  const [[row]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = :sequenceName
    ) AS present
  `, { replacements: { sequenceName } });
  return Boolean(row.present);
}

/** Сколько пользователей ещё без флага доступа к разделу. */
async function countUsersWithoutFlag() {
  const [[row]] = await sequelize.query(`
    SELECT count(*)::int AS missing
    FROM users
    WHERE "adminAccess" IS NULL OR NOT ("adminAccess" ? 'onboarding')
  `);
  return Number(row.missing);
}

async function getState() {
  const tables = {};
  for (const table of TABLES) tables[table] = await tableExists(table);

  const indexes = {};
  for (const index of INDEXES) indexes[index] = await indexExists(index);

  const sequence = await sequenceExists('onb_application_number_seq');
  // Флаг считаем только когда таблицы уже есть: до миграции этот вопрос
  // бессмысленный, а лишний запрос по users на большой базе не бесплатный.
  const usersMissingFlag = tables.onb_applications ? await countUsersWithoutFlag() : null;

  return { tables, indexes, sequence, usersMissingFlag };
}

function stateIsComplete(state) {
  return TABLES.every(t => state.tables[t])
    && INDEXES.every(i => state.indexes[i])
    && state.sequence
    && state.usersMissingFlag === 0;
}

function printState(state) {
  const present = TABLES.filter(t => state.tables[t]).length;
  console.log(`   ${present === TABLES.length ? '✓' : '✗'} таблицы модуля: ${present} из ${TABLES.length}`);
  for (const table of TABLES) {
    if (!state.tables[table]) console.log(`       ✗ нет ${table}`);
  }

  console.log(`   ${state.sequence ? '✓' : '✗'} последовательность onb_application_number_seq (номера заявок)`);

  for (const index of INDEXES) {
    console.log(`   ${state.indexes[index] ? '✓' : '✗'} индекс ${index}`);
  }

  if (state.usersMissingFlag === null) {
    console.log('   – флаг adminAccess.onboarding не сверялся: таблиц модуля ещё нет');
  } else {
    console.log(`   ${state.usersMissingFlag === 0 ? '✓' : '✗'} флаг adminAccess.onboarding: без него пользователей — ${state.usersMissingFlag}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.30 — онбординг врача\n');
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
      ? '\n✅ Миграция 7.30 применена\n'
      : '\n⚠️  Схема не готова — запустите npm run migrate:7.30\n');
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
    throw new Error('итоговая проверка не пройдена: схема модуля собрана не полностью');
  }

  console.log('\n✅ Миграция 7.30 успешно применена');
  console.log('   Дальше:');
  console.log('   1) задайте PUBLIC_BASE_URL в .env — из него строятся ссылки в письмах врачу;');
  console.log('   2) перезапустите backend после выкладки нового кода;');
  console.log('   3) выдайте доступ к разделу и расставьте исполнителей шагов в «Настройках».\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
