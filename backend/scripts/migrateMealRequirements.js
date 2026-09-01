#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.67 — порционные требования на питание больных.
 *
 * Заводит две таблицы: meal_requirement_days (день отделения целиком: строки
 * палат, снимок последней отправки в буфет, подпись медсестры) и
 * meal_requirement_patients (словарь ФИО для подсказок при вводе).
 *
 * Запуск из backend/:
 *   npm run migrate:7.67
 *
 * Только проверка, без изменений:
 *   npm run migrate:7.67:check
 *
 * Повторный запуск безопасен: в файле только CREATE TABLE/INDEX IF NOT EXISTS,
 * уже заполненные дни он не трогает.
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

const MIGRATION_FILE = 'ver. 7.67 meal-requirements.sql';
const migrationPath = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

async function getState() {
  const [[tables]] = await sequelize.query(`
    SELECT to_regclass('public.meal_requirement_days')     IS NOT NULL AS days,
           to_regclass('public.meal_requirement_patients') IS NOT NULL AS patients
  `);

  const state = { days: !!tables.days, patients: !!tables.patients, total: 0, sent: 0, names: 0 };
  if (!state.days) return state;

  const [[counts]] = await sequelize.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "sentVersion" > 0)::int AS sent
      FROM meal_requirement_days
  `);
  state.total = Number(counts.total);
  state.sent = Number(counts.sent);

  if (state.patients) {
    const [[names]] = await sequelize.query('SELECT count(*)::int AS total FROM meal_requirement_patients');
    state.names = Number(names.total);
  }

  return state;
}

function printState(state) {
  console.log(`   ${state.days ? '✓' : '✗'} таблица meal_requirement_days: ${state.days ? 'есть' : 'нет'}`);
  console.log(`   ${state.patients ? '✓' : '✗'} таблица meal_requirement_patients: ${state.patients ? 'есть' : 'нет'}`);
  if (state.days) {
    console.log(`       дней заполнено: ${state.total} (отправлено в буфет: ${state.sent})`);
    console.log(`       ФИО в словаре подсказок: ${state.names}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.67 — порционные требования на питание больных\n');
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`не найден файл миграции: ${migrationPath}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  const applied = before.days && before.patients;

  if (checkOnly) {
    console.log(applied
      ? '\n✅ Миграция 7.67 применена\n'
      : '\n⚠️  Таблиц нет — запустите npm run migrate:7.67\n');
    return;
  }

  if (applied) {
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
  if (!after.days || !after.patients) {
    throw new Error('итоговая проверка не пройдена: таблицы не появились');
  }

  console.log('\n✅ Миграция 7.67 успешно применена');
  console.log('   Дальше: вики-страница с содержимым backend/bot/meal-requirement.html,');
  console.log('   затем в блоке «Доставка в буфет» на этой странице выберите бота и групповой чат буфета.');
  console.log('   Пока бот с чатом не выбраны, таблица заполняется и печатается, но отправить её нельзя.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
