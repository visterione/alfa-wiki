#!/usr/bin/env node
'use strict';

/**
 * Контролируемый runner для новых безопасных миграций.
 *
 *   node scripts/migrateSafeDatabase.js --check  # только состояние
 *   node scripts/migrateSafeDatabase.js          # применить pending
 *
 * Старые разрозненные миграции намеренно не помечаются применёнными задним
 * числом. Реестр становится источником истины для миграций из MANIFEST ниже.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const MANIFEST = [
  'ver. 6.52 create-service-consumables.sql',
  'ver. 6.53 safe-hot-path-indexes.sql',
  'ver. 6.54 referral-bonuses-doctor-clinic-index.sql',
];

// Сессионная advisory lock не даёт двум деплоям применять миграции параллельно.
const MIGRATION_LOCK_ID = 610053;

function migrationInfo(filename) {
  const fullPath = path.join(__dirname, '..', 'migrations', filename);
  const sql = fs.readFileSync(fullPath, 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  return { filename, sql, checksum };
}

async function ledgerExists(connection) {
  const result = await connection.query(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists"
  );
  return result.rows[0].exists;
}

async function readApplied(connection) {
  if (!(await ledgerExists(connection))) return new Map();
  const result = await connection.query(
    'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY applied_at, name'
  );
  return new Map(result.rows.map(row => [row.name, row]));
}

function migrationState(migrations, applied) {
  return migrations.map(migration => {
    const row = applied.get(migration.filename);
    if (!row) return { ...migration, status: 'pending' };
    if (row.checksum !== migration.checksum) return { ...migration, status: 'checksum-mismatch' };
    return { ...migration, status: 'applied', appliedAt: row.applied_at };
  });
}

function printState(state) {
  for (const migration of state) {
    const marker = migration.status === 'applied' ? '✓' : migration.status === 'pending' ? '○' : '!';
    const suffix = migration.appliedAt ? ` (${new Date(migration.appliedAt).toISOString()})` : '';
    console.log(`   ${marker} ${migration.filename}: ${migration.status}${suffix}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const migrations = MANIFEST.map(migrationInfo);
  let connection;
  let lockHeld = false;

  sequelize.options.logging = false;

  try {
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();

    let applied = await readApplied(connection);
    let state = migrationState(migrations, applied);

    console.log('\n▶ Безопасные миграции БД\n');
    printState(state);

    const mismatch = state.find(migration => migration.status === 'checksum-mismatch');
    if (mismatch) {
      throw new Error(`изменён уже применённый файл миграции: ${mismatch.filename}`);
    }

    if (checkOnly) {
      if (state.some(migration => migration.status === 'pending')) process.exitCode = 2;
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockHeld = true;

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        checksum   CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Перечитываем реестр после получения lock: другой процесс мог успеть
    // завершить миграцию, пока этот runner ожидал.
    applied = await readApplied(connection);
    state = migrationState(migrations, applied);

    for (const migration of state) {
      if (migration.status === 'applied') continue;
      if (migration.status === 'checksum-mismatch') {
        throw new Error(`изменён уже применённый файл миграции: ${migration.filename}`);
      }

      console.log(`\n   Применяю ${migration.filename}...`);
      await connection.query(migration.sql);
      await connection.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
        [migration.filename, migration.checksum]
      );
      console.log('   Готово');
    }

    console.log('\n✅ Все безопасные миграции применены\n');
  } finally {
    if (connection && lockHeld) {
      await connection.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    }
    if (connection) {
      try {
        await sequelize.connectionManager.releaseConnection(connection);
      } catch (_) {
        // Соединение всё равно будет закрыто sequelize.close() ниже.
      }
    }
    await sequelize.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`\n❌ Миграция не выполнена: ${error.message}\n`);
  process.exitCode = 1;
});
