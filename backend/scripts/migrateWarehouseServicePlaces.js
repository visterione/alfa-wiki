#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.47 — склады медцентров.
 *
 * Добавляет warehouse_rooms."isService" и "serviceKind" и заводит каждому
 * действующему медцентру «Склад» и «Ремонт» с местом хранения внутри. Зачем они
 * нужны и почему это кабинет, а не отдельная сущность, — в
 * services/warehouse/servicePlaces.js и в самом файле миграции.
 *
 * Порядок важен: колонки нужны ДО перезапуска бэкенда. Модель кабинета уже знает
 * про isService, и первый же запрос дерева локаций на старой схеме упадёт с
 * «column isService does not exist» — то есть встанет весь склад, а не только
 * новая часть.
 *
 * Запуск из backend/:
 *   npm run migrate:7.47
 *
 * Только проверка, без изменений:
 *   npm run migrate:7.47:check
 *
 * Повторный запуск безопасен: SQL идемпотентен (ADD COLUMN IF NOT EXISTS), а
 * склады заводятся через ensureServicePlace — он находит уже существующий и
 * ничего не создаёт второй раз. Переименованный руками склад тоже остаётся как
 * есть: ищется он по виду, а не по названию.
 */

const fs = require('fs');
const path = require('path');
const { sequelize, MedCenter } = require('../models');
const { SERVICE_KINDS, ensureServicePlace } = require('../services/warehouse/servicePlaces');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.47 warehouse-service-places.sql';
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
 * missing — сколько пар «медцентр × вид склада» ещё не заведено. Именно по этому
 * числу видно, осталась ли работа: медцентр могли добавить после миграции, и
 * тогда повторный запуск нужен снова.
 */
async function getState() {
  const column = await columnExists('warehouse_rooms', 'isService');
  const kinds = Object.keys(SERVICE_KINDS);

  const medCenters = await MedCenter.findAll({
    where: { isActive: true, isVirtual: false },
    attributes: ['id', 'name', 'displayName'],
    order: [['sortOrder', 'ASC'], ['name', 'ASC']],
  });

  if (!column) {
    return { column, medCenters, places: null, missing: medCenters.length * kinds.length };
  }

  const [rows] = await sequelize.query(`
    SELECT "medCenterId", "serviceKind"
      FROM warehouse_rooms
     WHERE "isService" = TRUE AND "isActive" = TRUE AND "serviceKind" IS NOT NULL
  `);
  const have = new Set(rows.map(r => `${r.medCenterId}:${r.serviceKind}`));

  let missing = 0;
  for (const mc of medCenters) {
    for (const kind of kinds) if (!have.has(`${mc.id}:${kind}`)) missing += 1;
  }
  return { column, medCenters, places: rows.length, missing };
}

function report(state, prefix) {
  const kinds = Object.keys(SERVICE_KINDS);
  console.log(`${prefix}:`);
  console.log(`  колонки isService/serviceKind: ${state.column ? 'есть' : 'НЕТ'}`);
  console.log(`  медцентров: ${state.medCenters.length}, видов складов: ${kinds.length}`);
  if (state.places !== null) console.log(`  складов заведено: ${state.places}`);
  console.log(`  не хватает складов: ${state.missing}`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  const before = await getState();
  report(before, checkOnly ? 'Состояние' : 'До миграции');

  if (checkOnly) {
    const done = before.column && before.missing === 0;
    console.log(done ? '\nМиграция не нужна.' : '\nМиграцию нужно применить: npm run migrate:7.47');
    await sequelize.close();
    process.exit(done ? 0 : 1);
  }

  if (before.column && before.missing === 0) {
    console.log('\nВсё на месте, менять нечего.');
    await sequelize.close();
    return;
  }

  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

  // Одной транзакцией: колонки и склады — это одно изменение, и медцентр с
  // «Складом», но без «Ремонта» после сбоя на середине никому не нужен.
  await sequelize.transaction(async (t) => {
    await sequelize.query(sql, { transaction: t });

    for (const mc of before.medCenters) {
      for (const kind of Object.keys(SERVICE_KINDS)) {
        const room = await ensureServicePlace(mc.id, kind, { transaction: t });
        if (room) {
          console.log(`  ${mc.displayName || mc.name}: ${SERVICE_KINDS[kind].name} — ${room.id}`);
        }
      }
    }
  });

  const after = await getState();
  report(after, '\nПосле миграции');

  if (after.missing > 0) {
    console.error('\nЧасть складов не завелась — смотрите вывод выше.');
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
