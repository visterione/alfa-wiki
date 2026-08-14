#!/usr/bin/env node
'use strict';

/** Безопасный повторяемый runner для ссылок-приглашений в команды задач. */
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.76 task-team-invites.sql');
const LOCK_ID = 676001;

async function state(connection) {
  const result = await connection.query(`
    SELECT
      to_regclass('public.task_team_invites') IS NOT NULL AS table_exists,
      to_regclass('public.task_team_invites_team_idx') IS NOT NULL AS team_index_exists,
      to_regclass('public.task_team_invites_expires_idx') IS NOT NULL AS expires_index_exists
  `);
  const row = result.rows[0];
  return {
    table: row.table_exists,
    teamIndex: row.team_index_exists,
    expiresIndex: row.expires_index_exists,
    complete: row.table_exists && row.team_index_exists && row.expires_index_exists,
  };
}

function print(result) {
  console.log(`   ${result.table ? '✓' : '✗'} таблица task_team_invites`);
  console.log(`   ${result.teamIndex ? '✓' : '✗'} индекс команды`);
  console.log(`   ${result.expiresIndex ? '✓' : '✗'} индекс срока действия`);
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

    if (checkOnly) {
      if (!before.complete) process.exitCode = 2;
      return;
    }
    if (before.complete) return;

    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    before = await state(connection);
    if (!before.complete) {
      try {
        await connection.query(fs.readFileSync(FILE, 'utf8'));
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }

    const after = await state(connection);
    if (!after.complete) throw new Error('итоговая проверка схемы не пройдена');
    console.log('\n✅ Миграция 6.76 применена');
  } finally {
    if (connection && locked) {
      await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    }
    if (connection) await sequelize.connectionManager.releaseConnection(connection);
  }
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
