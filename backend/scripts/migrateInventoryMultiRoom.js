#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.36 — опись по нескольким кабинетам.
 *
 * Добавляет warehouse_inventory_sessions."roomIds" и переносит туда кабинет уже
 * заведённых описей: код спрашивает «какие кабинеты накрыты» одним способом
 * (services/warehouse/inventory.js), и разбирать два поля по признаку scope он не
 * должен. Сам roomId остаётся — им подписывают опись в журнале и в ИНВ-1.
 *
 * Порядок важен: колонка нужна ДО перезапуска бэкенда. Модель описи уже знает про
 * roomIds, и первый же запрос заморозки кабинетов на старой схеме упадёт с
 * «column roomIds does not exist» — то есть встанут все операции склада, а не
 * только инвентаризация.
 *
 * Запуск из backend/:
 *   npm run migrate:inventory-rooms
 *
 * Только проверка, без изменений:
 *   npm run migrate:inventory-rooms:check
 *
 * SQL идемпотентен (ADD COLUMN IF NOT EXISTS плюс UPDATE только по пустым
 * спискам), повторный запуск безопасен.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.36 inventory-multi-room.sql';
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

/**
 * Состояние схемы и данных.
 *
 * pending — описи по кабинету, у которых список ещё пуст: именно их дописывает
 * UPDATE, и именно по их числу видно, осталась ли работа. Считается только при
 * наличии колонки: до неё вопрос не имеет смысла.
 */
async function getState() {
  const column = await columnExists('warehouse_inventory_sessions', 'roomIds');
  if (!column) return { column, sessions: null, pending: null, multi: null };

  const [[row]] = await sequelize.query(`
    SELECT count(*)::int AS sessions,
           count(*) FILTER (
             WHERE "roomId" IS NOT NULL AND "roomIds" = '[]'::jsonb
           )::int AS pending,
           count(*) FILTER (
             WHERE jsonb_array_length("roomIds") > 1
           )::int AS multi
      FROM warehouse_inventory_sessions
  `);
  return {
    column,
    sessions: Number(row.sessions),
    pending: Number(row.pending),
    multi: Number(row.multi),
  };
}

function stateIsComplete(state) {
  return state.column && state.pending === 0;
}

function printState(state) {
  console.log(`   ${state.column ? '✓' : '✗'} колонка warehouse_inventory_sessions."roomIds"`);
  if (!state.column) return;
  console.log(`   · описей всего: ${state.sessions}`);
  console.log(`   ${state.pending === 0 ? '✓' : '✗'} описей по кабинету с пустым списком: ${state.pending}`);
  console.log(`   · описей по нескольким кабинетам: ${state.multi}`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.36 — опись по нескольким кабинетам\n');
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
      ? '\n✅ Миграция 7.36 применена\n'
      : '\n⚠️  Схема не готова — запустите npm run migrate:inventory-rooms\n');
    return;
  }

  if (stateIsComplete(before)) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
    return;
  }

  console.log('\n   Применяю SQL:');
  console.log(`   → ${MIGRATION_FILE}`);
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  // Одной транзакцией: колонка и перенос кабинетов должны появиться вместе,
  // иначе на полпути остаются описи с колонкой, но без списка — а код уже читает
  // список как единственный источник области.
  await sequelize.transaction(transaction => sequelize.query(sql, { transaction }));

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (!stateIsComplete(after)) {
    throw new Error('итоговая проверка схемы не пройдена');
  }

  console.log('\n✅ Миграция 7.36 успешно применена');
  console.log('   Теперь перезапустите backend — с ним поднимутся опись по');
  console.log('   нескольким кабинетам и отмена описи.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
