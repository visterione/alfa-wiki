#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');
sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.78 private-task-teams.sql');
const LOCK_ID = 678001;

async function state(connection) {
  const result = await connection.query(`
    SELECT
      COUNT(*) FILTER (WHERE access <> 'members' OR "isHidden" IS NOT TRUE)::int AS open_teams,
      (SELECT column_default = '''members''::character varying' FROM information_schema.columns
        WHERE table_name='task_teams' AND column_name='access') AS access_default,
      (SELECT column_default = 'true' FROM information_schema.columns
        WHERE table_name='task_teams' AND column_name='isHidden') AS hidden_default,
      (SELECT COUNT(*) = 2 FROM pg_constraint
        WHERE conrelid = 'task_teams'::regclass
          AND conname IN ('task_teams_private_access', 'task_teams_always_hidden')) AS constraints_exist
    FROM task_teams
  `);
  const row = result.rows[0];
  return { openTeams: row.open_teams, defaults: !!row.access_default && !!row.hidden_default,
    constraints: !!row.constraints_exist,
    complete: row.open_teams === 0 && !!row.access_default && !!row.hidden_default && !!row.constraints_exist };
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
    console.log(`   ${before.openTeams === 0 ? '✓' : '✗'} закрытые команды`);
    console.log(`   ${before.defaults ? '✓' : '✗'} закрытые значения по умолчанию`);
    console.log(`   ${before.constraints ? '✓' : '✗'} ограничения публичного доступа`);
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
    console.log('\n✅ Миграция 6.78 применена');
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
