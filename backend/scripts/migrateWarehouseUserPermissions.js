#!/usr/bin/env node
'use strict';

/**
 * Безопасный повторяемый runner миграции складских прав ver. 7.03.
 *
 * Из backend/ на production:
 *   npm run migrate:7.03:check  # только проверить состояние
 *   npm run migrate:7.03        # применить и проверить
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 7.03 warehouse-user-permissions.sql');
const LOCK_ID = 703001;

async function state(connection) {
  const tableResult = await connection.query(
    "SELECT to_regclass('public.warehouse_user_permissions') IS NOT NULL AS exists"
  );
  if (!tableResult.rows[0].exists) {
    return { table: false, columns: false, primaryKey: false, userConstraint: false, complete: false };
  }

  const result = await connection.query(`
    SELECT
      (
        SELECT COUNT(*) = 6
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'warehouse_user_permissions'
           AND (
             (column_name = 'id' AND data_type = 'uuid' AND is_nullable = 'NO')
             OR (column_name = 'userId' AND data_type = 'uuid' AND is_nullable = 'NO')
             OR (column_name = 'perms' AND data_type = 'jsonb' AND is_nullable = 'NO')
             OR (column_name = 'medCenterIds' AND data_type = 'jsonb' AND is_nullable = 'NO')
             OR (column_name IN ('createdAt', 'updatedAt')
                 AND data_type = 'timestamp with time zone' AND is_nullable = 'NO')
           )
      ) AS columns_ok,
      EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'warehouse_user_permissions'::regclass
           AND contype = 'p'
      ) AS primary_key,
      EXISTS (
        SELECT 1
          FROM pg_constraint c
         WHERE c.conrelid = 'warehouse_user_permissions'::regclass
           AND c.contype = 'f'
           AND c.confrelid = 'users'::regclass
           AND c.confdeltype = 'c'
           AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = 'warehouse_user_permissions'::regclass AND attname = 'userId')
           ]::smallint[]
      ) AND EXISTS (
        SELECT 1
          FROM pg_constraint c
         WHERE c.conrelid = 'warehouse_user_permissions'::regclass
           AND c.contype = 'u'
           AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = 'warehouse_user_permissions'::regclass AND attname = 'userId')
           ]::smallint[]
      ) AS user_constraint
  `);
  const row = result.rows[0];
  const current = {
    table: true,
    columns: row.columns_ok,
    primaryKey: row.primary_key,
    userConstraint: row.user_constraint,
  };
  current.complete = Object.values(current).every(Boolean);
  return current;
}

function print(result) {
  console.log(`   ${result.table ? '✓' : '✗'} таблица warehouse_user_permissions`);
  console.log(`   ${result.columns ? '✓' : '✗'} поля прав и области видимости`);
  console.log(`   ${result.primaryKey ? '✓' : '✗'} первичный ключ`);
  console.log(`   ${result.userConstraint ? '✓' : '✗'} один набор прав на пользователя с удалением каскадом`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let locked = false;

  try {
    if (!fs.existsSync(FILE)) throw new Error(`не найден файл миграции: ${FILE}`);
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();

    console.log('\n▶ Миграция складских прав ver. 7.03');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    let before = await state(connection);
    print(before);
    if (checkOnly) {
      if (!before.complete) {
        console.log('\n⚠️  Миграция 7.03 ещё не применена\n');
        process.exitCode = 2;
      } else {
        console.log('\n✅ Миграция 7.03 применена\n');
      }
      return;
    }
    if (before.complete) {
      console.log('\n✅ Миграция 7.03 уже применена\n');
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    before = await state(connection);
    if (!before.complete) {
      console.log(`\n   Применяю ${path.basename(FILE)}...`);
      await connection.query('BEGIN');
      try {
        await connection.query(fs.readFileSync(FILE, 'utf8'));
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }

    const after = await state(connection);
    if (!after.complete) throw new Error('итоговая проверка схемы не пройдена');
    console.log('\n✅ Миграция 7.03 успешно применена\n');
  } finally {
    if (connection && locked) {
      await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    }
    if (connection) {
      try { await sequelize.connectionManager.releaseConnection(connection); } catch (_) {}
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
