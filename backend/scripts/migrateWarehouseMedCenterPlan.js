#!/usr/bin/env node
'use strict';

/** Безопасный повторяемый runner миграции склада ver. 6.82. */
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;
const FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.82 warehouse-medcenter-plan.sql');
const LOCK_ID = 682001;

async function state(connection) {
  const result = await connection.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'med_centers'
         AND column_name = 'warehousePlan' AND is_nullable = 'NO'
         AND data_type = 'jsonb'
    ) AS complete
  `);
  return result.rows[0].complete;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let locked = false;
  try {
    if (!fs.existsSync(FILE)) throw new Error(`не найден файл миграции: ${FILE}`);
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();
    console.log('\n▶ Миграция склада ver. 6.82');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    let complete = await state(connection);
    console.log(`   ${complete ? '✓' : '✗'} общая схема медцентра`);
    if (checkOnly) {
      if (!complete) process.exitCode = 2;
      return;
    }
    if (complete) {
      console.log('\n✅ Миграция 6.82 уже применена\n');
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    complete = await state(connection);
    if (!complete) await connection.query(fs.readFileSync(FILE, 'utf8'));
    if (!(await state(connection))) throw new Error('итоговая проверка схемы не пройдена');
    console.log('\n✅ Миграция 6.82 успешно применена\n');
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
