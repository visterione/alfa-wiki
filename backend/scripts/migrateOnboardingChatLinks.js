#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.64 — рабочие чаты филиала в онбординге врача.
 *
 * Заводит таблицу onb_chat_links: ссылки на групповые чаты, которые уходят
 * врачу приветственным письмом, когда закрыт последний шаг чек-листа. До сих
 * пор их кидали руками, и врач раз за разом оказывался не в том чате.
 *
 * Запуск из backend/:
 *   npm run migrate:7.64
 *
 * Только проверка, без изменений:
 *   npm run migrate:7.64:check
 *
 * Схему меняет один CREATE TABLE IF NOT EXISTS, так что повторный запуск
 * безопасен: уже заведённые чаты он не тронет.
 *
 * Отдельный скрипт, а не «выполните psql -f», по той же причине, что и у
 * остальных миграций проекта: он подключается теми же параметрами, что и сам
 * сервер, и печатает состояние до и после. Накатывать боевую базу вслепую,
 * подставляя строку подключения руками, — верный способ применить миграцию не
 * туда.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.64 onboarding-chat-links.sql';
const migrationPath = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

async function getState() {
  const [[table]] = await sequelize.query(`
    SELECT to_regclass('public.onb_chat_links') IS NOT NULL AS exists
  `);

  if (!table.exists) return { exists: false, total: 0, active: 0, branches: 0 };

  const [[counts]] = await sequelize.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "isActive")::int AS active,
           count(DISTINCT "medCenterId")::int AS branches
      FROM onb_chat_links
  `);

  return {
    exists: true,
    total: Number(counts.total),
    active: Number(counts.active),
    branches: Number(counts.branches)
  };
}

function printState(state) {
  console.log(`   ${state.exists ? '✓' : '✗'} таблица onb_chat_links: ${state.exists ? 'есть' : 'нет'}`);
  if (state.exists) {
    console.log(`       чатов настроено: ${state.total} (уходит врачу: ${state.active})`);
    console.log(`       филиалов со своими чатами: ${state.branches}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.64 — рабочие чаты филиала (онбординг врача)\n');
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`не найден файл миграции: ${migrationPath}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(before.exists
      ? '\n✅ Миграция 7.64 применена\n'
      : '\n⚠️  Таблицы нет — запустите npm run migrate:7.64\n');
    return;
  }

  if (before.exists) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
    return;
  }

  console.log(`\n   Применяю SQL: ${MIGRATION_FILE}`);
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(fs.readFileSync(migrationPath, 'utf8'), { transaction });
  });

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!after.exists) {
    throw new Error('итоговая проверка не пройдена: таблица не появилась');
  }

  console.log('\n✅ Миграция 7.64 успешно применена');
  console.log('   Дальше: «Онбординг → Рабочие чаты», выберите филиал и добавьте ссылки-приглашения.');
  console.log('   Пока список пуст, письмо врачу уходит как раньше — без блока с чатами.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
