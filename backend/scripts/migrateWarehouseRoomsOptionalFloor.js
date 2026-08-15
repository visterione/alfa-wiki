#!/usr/bin/env node
'use strict';

/**
 * Безопасный повторяемый runner миграции склада ver. 6.81.
 *
 * Из backend/:
 *   npm run migrate:6.81:check  # только проверить состояние
 *   npm run migrate:6.81        # применить и проверить
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.81 warehouse-rooms-optional-floor.sql');
const LOCK_ID = 681001;

async function state(connection) {
  const columnsResult = await connection.query(`
    SELECT column_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'warehouse_rooms'
       AND column_name IN ('medCenterId', 'floorId')
  `);
  const columns = new Map(columnsResult.rows.map(row => [row.column_name, row.is_nullable]));
  const medCenterColumn = columns.get('medCenterId') === 'NO';
  const optionalFloor = columns.get('floorId') === 'YES';

  // До добавления medCenterId запросы к колонке не парсятся, поэтому проверки
  // данных и FK запускаются только когда сама колонка уже существует.
  if (!columns.has('medCenterId')) {
    return {
      medCenterColumn: false,
      optionalFloor,
      medCenterFk: false,
      floorSetNullFk: false,
      medCenterIndex: false,
      dataConsistent: false,
      complete: false,
    };
  }

  const detailsResult = await connection.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'warehouse_rooms'::regclass
           AND c.contype = 'f'
           AND c.confrelid = 'med_centers'::regclass
           AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = 'warehouse_rooms'::regclass AND attname = 'medCenterId')
           ]::smallint[]
      ) AS medcenter_fk,
      EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'warehouse_rooms'::regclass
           AND c.contype = 'f' AND c.confdeltype = 'n'
           AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = 'warehouse_rooms'::regclass AND attname = 'floorId')
           ]::smallint[]
      ) AS floor_set_null_fk,
      to_regclass('public.warehouse_rooms_medcenter_idx') IS NOT NULL AS medcenter_index,
      NOT EXISTS (
        SELECT 1
          FROM warehouse_rooms r
          LEFT JOIN warehouse_floors f ON f.id = r."floorId"
          LEFT JOIN warehouse_buildings b ON b.id = f."buildingId"
         WHERE r."medCenterId" IS NULL
            OR (r."floorId" IS NOT NULL AND r."medCenterId" IS DISTINCT FROM b."medCenterId")
      ) AS data_consistent
  `);
  const row = detailsResult.rows[0];
  const result = {
    medCenterColumn,
    optionalFloor,
    medCenterFk: row.medcenter_fk,
    floorSetNullFk: row.floor_set_null_fk,
    medCenterIndex: row.medcenter_index,
    dataConsistent: row.data_consistent,
  };
  result.complete = Object.values(result).every(Boolean);
  return result;
}

function print(result) {
  console.log(`   ${result.medCenterColumn ? '✓' : '✗'} warehouse_rooms.medCenterId обязателен`);
  console.log(`   ${result.optionalFloor ? '✓' : '✗'} warehouse_rooms.floorId необязателен`);
  console.log(`   ${result.medCenterFk ? '✓' : '✗'} внешний ключ на med_centers`);
  console.log(`   ${result.floorSetNullFk ? '✓' : '✗'} удаление этажа обнуляет floorId`);
  console.log(`   ${result.medCenterIndex ? '✓' : '✗'} индекс медцентра`);
  console.log(`   ${result.dataConsistent ? '✓' : '✗'} существующие кабинеты корректно перенесены`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let locked = false;

  try {
    if (!fs.existsSync(FILE)) throw new Error(`не найден файл миграции: ${FILE}`);
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();

    console.log('\n▶ Миграция склада ver. 6.81');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    const tableResult = await connection.query(
      "SELECT to_regclass('public.warehouse_rooms') IS NOT NULL AS exists"
    );
    if (!tableResult.rows[0].exists) {
      throw new Error('не найдена таблица warehouse_rooms; сначала примените миграцию 6.68');
    }

    let before = await state(connection);
    print(before);
    if (checkOnly) {
      if (!before.complete) {
        console.log('\n⚠️  Миграция 6.81 ещё не применена\n');
        process.exitCode = 2;
      } else {
        console.log('\n✅ Миграция 6.81 применена\n');
      }
      return;
    }
    if (before.complete) {
      console.log('\n✅ Миграция 6.81 уже применена\n');
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    before = await state(connection);
    if (!before.complete) {
      console.log(`\n   Применяю ${path.basename(FILE)}...`);
      try {
        await connection.query(fs.readFileSync(FILE, 'utf8'));
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }

    const after = await state(connection);
    if (!after.complete) throw new Error('итоговая проверка схемы не пройдена');
    console.log('\n✅ Миграция 6.81 успешно применена\n');
  } finally {
    if (connection && locked) {
      await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    }
    if (connection) {
      try {
        await sequelize.connectionManager.releaseConnection(connection);
      } catch (_) {
        // sequelize.close() ниже всё равно закроет пул, если возврат соединения
        // в конкретной версии Sequelize завершился ошибкой.
      }
    }
    await sequelize.close().catch(() => {});
  }
}

main().catch(error => {
  const message = error?.original?.message || error?.parent?.message || error?.message
    || error?.original?.code || error?.name || String(error);
  console.error(`\n❌ Миграция не выполнена: ${message}\n`);
  process.exitCode = 1;
});
