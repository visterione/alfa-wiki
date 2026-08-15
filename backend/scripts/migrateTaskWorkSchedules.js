#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');
sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.77 task-work-schedules.sql');
const LOCK_ID = 677001;

async function state(connection) {
  const result = await connection.query(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='taskWorkSchedule') AS column_exists,
      to_regclass('public.task_schedule_changes') IS NOT NULL AS table_exists,
      to_regclass('public.task_schedule_changes_user_created_idx') IS NOT NULL AS index_exists
  `);
  const row = result.rows[0];
  return { column: row.column_exists, table: row.table_exists, index: row.index_exists,
    complete: row.column_exists && row.table_exists && row.index_exists };
}

function print(value) {
  console.log(`   ${value.column ? '✓' : '✗'} users.taskWorkSchedule`);
  console.log(`   ${value.table ? '✓' : '✗'} таблица истории расписаний`);
  console.log(`   ${value.index ? '✓' : '✗'} индекс истории`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let locked = false;
  try {
    if (!fs.existsSync(FILE)) throw new Error(`не найден файл миграции: ${FILE}`);
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();
    let before = await state(connection);
    print(before);
    if (checkOnly) { if (!before.complete) process.exitCode = 2; return; }
    if (before.complete) return;
    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    before = await state(connection);
    if (!before.complete) {
      try { await connection.query(fs.readFileSync(FILE, 'utf8')); }
      catch (error) { await connection.query('ROLLBACK').catch(() => {}); throw error; }
    }
    const after = await state(connection);
    if (!after.complete) throw new Error('итоговая проверка схемы не пройдена');
    console.log('\n✅ Миграция 6.77 применена');
  } finally {
    if (connection && locked) await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    if (connection) await sequelize.connectionManager.releaseConnection(connection);
  }
}

main().then(() => sequelize.close()).catch(async error => {
  console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}`);
  await sequelize.close().catch(() => {});
  process.exitCode = 1;
});
