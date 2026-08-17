#!/usr/bin/env node
'use strict';

/**
 * Runner миграции ver. 6.94 — коды задач (РЕМ-42).
 *
 * Запуск из backend/:
 *   npm run migrate:task-codes
 *
 * Только проверка, без изменений:
 *   npm run migrate:task-codes:check
 *
 * Кроме схемы делает то, что в чистом SQL не выразить: придумывает проектам
 * ключи по их названиям, разводя совпадения («Обслуживание» и «Обследования»
 * оба дают ОБС), и раздаёт коды уже существующим задачам в порядке создания —
 * чтобы номера шли так же, как шла работа. Повторный запуск ничего не портит:
 * трогаются только строки без ключа и без кода.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');
const codes = require('../services/tasks/codes');

sequelize.options.logging = false;

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.94 task-codes.sql');
const MIGRATION_LOCK_ID = 694001;

async function schemaState(connection) {
  const columns = await connection.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'task_projects' AND column_name = 'key')
        OR (table_name = 'tasks' AND column_name = 'code'))
  `);
  const tables = await connection.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'task_code_counters'
  `);
  const has = new Set(columns.rows.map(row => `${row.table_name}.${row.column_name}`));
  return {
    projectKey: has.has('task_projects.key'),
    taskCode: has.has('tasks.code'),
    counters: tables.rows.length > 0,
  };
}

async function dataState(connection, schema) {
  if (!schema.projectKey || !schema.taskCode) return { projectsLeft: null, tasksLeft: null };
  const projects = await connection.query(
    'SELECT count(*)::int AS count FROM task_projects WHERE key IS NULL'
  );
  const tasks = await connection.query(
    'SELECT count(*)::int AS count FROM tasks WHERE code IS NULL'
  );
  return { projectsLeft: projects.rows[0].count, tasksLeft: tasks.rows[0].count };
}

function printState(schema, data) {
  console.log(`   ${schema.projectKey ? '✓' : '✗'} колонка task_projects.key`);
  console.log(`   ${schema.taskCode ? '✓' : '✗'} колонка tasks.code`);
  console.log(`   ${schema.counters ? '✓' : '✗'} таблица task_code_counters`);
  if (data.projectsLeft !== null) {
    console.log(`   ${data.projectsLeft ? '○' : '✓'} проектов без ключа: ${data.projectsLeft}`);
    console.log(`   ${data.tasksLeft ? '○' : '✓'} задач без кода: ${data.tasksLeft}`);
  }
}

/** Ключи проектам: по названию, с разведением совпадений. */
async function fillProjectKeys(connection) {
  const { rows } = await connection.query(
    'SELECT id, name, key FROM task_projects ORDER BY "createdAt" ASC NULLS FIRST, name ASC'
  );
  const taken = rows.filter(row => row.key).map(row => row.key.toUpperCase());
  let filled = 0;
  for (const row of rows) {
    if (row.key) continue;
    const key = codes.uniqueKey(row.name, taken);
    await connection.query('UPDATE task_projects SET key = $1 WHERE id = $2', [key, row.id]);
    taken.push(key);
    filled += 1;
    console.log(`      ${key.padEnd(6)} ← ${row.name}`);
  }
  return filled;
}

/**
 * Коды задачам: по дате создания внутри своего префикса.
 *
 * Счётчики выставляются после раздачи, а не по ходу: так один и тот же запуск
 * можно повторить на половине пути, не оставив дыр в нумерации.
 */
async function fillTaskCodes(connection) {
  const { rows } = await connection.query(`
    SELECT t.id, COALESCE(p.key, $1) AS prefix
    FROM tasks t
    LEFT JOIN task_projects p ON p.id = t."projectId"
    WHERE t.code IS NULL
    ORDER BY t."createdAt" ASC, t.id ASC
  `, [codes.NO_PROJECT_PREFIX]);

  const used = await connection.query(`
    SELECT split_part(code, '-', 1) AS prefix, max(split_part(code, '-', 2)::int) AS top
    FROM tasks WHERE code IS NOT NULL AND code ~ '^[^-]+-[0-9]+$'
    GROUP BY 1
  `);
  const next = new Map(used.rows.map(row => [row.prefix, Number(row.top) + 1]));

  for (const row of rows) {
    const number = next.get(row.prefix) || 1;
    next.set(row.prefix, number + 1);
    await connection.query('UPDATE tasks SET code = $1 WHERE id = $2', [`${row.prefix}-${number}`, row.id]);
  }

  for (const [prefix, value] of next) {
    await connection.query(`
      INSERT INTO task_code_counters (prefix, next) VALUES ($1, $2)
      ON CONFLICT (prefix) DO UPDATE SET next = GREATEST(task_code_counters.next, EXCLUDED.next)
    `, [prefix, value]);
  }
  return rows.length;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let lockHeld = false;

  console.log('\n▶ Миграция ver. 6.94 — коды задач\n');
  if (!fs.existsSync(MIGRATION_FILE)) {
    throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);
  }

  try {
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    console.log('   Состояние:');
    let schema = await schemaState(connection);
    let data = await dataState(connection, schema);
    printState(schema, data);

    const complete = schema.projectKey && schema.taskCode && schema.counters
      && data.projectsLeft === 0 && data.tasksLeft === 0;

    if (checkOnly) {
      console.log(complete ? '\n✅ Миграция 6.94 применена\n' : '\n⚠️  Миграция 6.94 не применена или применена частично\n');
      if (!complete) process.exitCode = 2;
      return;
    }
    if (complete) {
      console.log('\n✅ Уже применена, ничего делать не нужно\n');
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockHeld = true;

    schema = await schemaState(connection);
    if (!schema.projectKey || !schema.taskCode || !schema.counters) {
      console.log('\n   Применяю SQL...');
      try {
        await connection.query(fs.readFileSync(MIGRATION_FILE, 'utf8'));
      } catch (error) {
        // SQL сам открывает транзакцию: после падения соединение нельзя
        // возвращать в пул в состоянии aborted transaction.
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }

    console.log('\n   Ключи проектов:');
    const projects = await fillProjectKeys(connection);
    if (!projects) console.log('      все проекты уже с ключами');

    console.log('\n   Коды задач...');
    const tasks = await fillTaskCodes(connection);
    console.log(`      выдано кодов: ${tasks}`);

    schema = await schemaState(connection);
    data = await dataState(connection, schema);
    console.log('\n   Состояние после:');
    printState(schema, data);
    console.log('\n✅ Миграция 6.94 применена\n');
  } finally {
    if (connection) {
      if (lockHeld) await connection.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
      sequelize.connectionManager.releaseConnection(connection);
    }
    await sequelize.close();
  }
}

main().catch(error => {
  console.error(`\n❌ ${error.message}\n`);
  process.exitCode = 1;
});
