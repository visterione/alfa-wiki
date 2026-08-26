#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.48 — этаж принадлежит медцентру напрямую.
 *
 * Добавляет warehouse_floors."medCenterId", заполняет его из корпуса, снимает с
 * buildingId обязательность и переносит название корпуса в пустое название
 * этажа там, где корпусов у медцентра больше одного. Зачем это и что здесь
 * сознательно НЕ делается — в самом файле миграции.
 *
 * Порядок важен: колонка нужна ДО перезапуска бэкенда. Модель этажа уже знает
 * про medCenterId, и первый же запрос дерева локаций на старой схеме упадёт с
 * «column medCenterId does not exist» — то есть встанет весь склад.
 *
 * Запуск из backend/:
 *   npm run migrate:7.48
 *
 * Только проверка, без изменений:
 *   npm run migrate:7.48:check
 *
 * Повторный запуск безопасен: колонка добавляется с IF NOT EXISTS, а оба UPDATE
 * трогают только незаполненное. Название этажа, поправленное руками после
 * миграции, второй запуск не перепишет — он смотрит только на пустые.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.48 warehouse-floors-without-buildings.sql';
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
 * pending — этажи, у которых медцентр ещё не проставлен. duplicates — сколько
 * пар «медцентр + номер этажа» встречается больше одного раза: это и есть та
 * ручная работа, которую миграция намеренно не делает за владельца данных.
 */
async function getState() {
  const column = await columnExists('warehouse_floors', 'medCenterId');
  if (!column) return { column, floors: null, pending: null, duplicates: null };

  const [[row]] = await sequelize.query(`
    SELECT count(*)::int AS floors,
           count(*) FILTER (WHERE "medCenterId" IS NULL)::int AS pending
      FROM warehouse_floors
  `);
  const [dups] = await sequelize.query(`
    SELECT mc.name AS "medCenter", f.number, count(*)::int AS floors
      FROM warehouse_floors f
      JOIN med_centers mc ON mc.id = f."medCenterId"
     GROUP BY mc.name, f.number
    HAVING count(*) > 1
     ORDER BY mc.name, f.number
  `);

  return {
    column,
    floors: Number(row.floors),
    pending: Number(row.pending),
    duplicates: dups,
  };
}

function report(state, prefix) {
  console.log(`${prefix}:`);
  console.log(`  колонка medCenterId: ${state.column ? 'есть' : 'НЕТ'}`);
  if (state.floors !== null) {
    console.log(`  этажей: ${state.floors}, без медцентра: ${state.pending}`);
  }
  if (state.duplicates?.length) {
    console.log('  одинаковые номера этажей в одном медцентре (объединять вручную):');
    for (const d of state.duplicates) {
      console.log(`    ${d.medCenter}: ${d.number} этаж — ${d.floors} шт.`);
    }
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  const before = await getState();
  report(before, checkOnly ? 'Состояние' : 'До миграции');

  if (checkOnly) {
    const done = before.column && before.pending === 0;
    console.log(done ? '\nМиграция не нужна.' : '\nМиграцию нужно применить: npm run migrate:7.48');
    await sequelize.close();
    process.exit(done ? 0 : 1);
  }

  if (before.column && before.pending === 0) {
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

  if (after.pending > 0) {
    console.error(`\nУ ${after.pending} этажей не проставился медцентр — вероятно, `
      + 'их корпус удалён из базы. Проставьте вручную.');
    await sequelize.close();
    process.exit(1);
  }

  if (after.duplicates?.length) {
    console.log('\nЭтажи с одинаковыми номерами оставлены как есть — это ожидаемо.');
    console.log('Перенесите кабинеты на нужный этаж в разделе «Кабинеты» и удалите пустой.');
  }

  console.log('\nГотово. Перезапустите бэкенд: pm2 restart alfa-wiki');
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('Миграция не прошла:', err.message);
  await sequelize.close();
  process.exit(1);
});
