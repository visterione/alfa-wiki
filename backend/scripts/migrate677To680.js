#!/usr/bin/env node
'use strict';

/**
 * Миграции 6.77–6.80 одним прогоном.
 *
 * Четыре релиза приезжают на прод вместе, и накатывать их по одному значит четыре
 * раза вспоминать, какая команда следующая и что делать, если третья упала. Здесь
 * они идут в порядке версий, каждая в своей транзакции (BEGIN/COMMIT лежат в
 * самих .sql), и первая же ошибка останавливает остальные: половина 6.79 без
 * 6.80 — это состояние, из которого понятно, что делать, а вот 6.80 поверх
 * недоехавшей 6.79 — уже нет.
 *
 * ── Что делает каждая ────────────────────────────────────────────────────────
 *
 *   6.77 — недельное рабочее расписание сотрудника и история его изменений;
 *   6.78 — команды модуля задач становятся закрытыми;
 *   6.79 — словарь предметов склада и базовое дерево категорий;
 *   6.80 — размещение позиций ведомости по кабинетам.
 *
 * ── Почему можно запускать повторно ──────────────────────────────────────────
 *
 * Перед каждым шагом проверяется состояние схемы, и уже применённая миграция
 * пропускается. Сами файлы тоже написаны идемпотентно (IF NOT EXISTS, DROP
 * CONSTRAINT IF EXISTS), так что повторный запуск после обрыва связи ничего не
 * ломает и не дублирует.
 *
 * ── Блокировка ───────────────────────────────────────────────────────────────
 *
 * Каждый шаг берёт advisory lock со своим номером. Это защита от второго
 * одновременного запуска — например, когда деплой случайно пошёл дважды.
 *
 * Запуск:
 *   npm run migrate:6.77-6.80          — применить
 *   npm run migrate:6.77-6.80:check    — только показать состояние, ничего не менять
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const migrationsDir = path.join(__dirname, '..', 'migrations');
const file = name => path.join(migrationsDir, name);

/** Одна проверка состояния: подпись для человека и SQL, отвечающий true/false. */
const STEPS = [
  {
    version: '6.77',
    title: 'Рабочее расписание сотрудника',
    file: file('ver. 6.77 task-work-schedules.sql'),
    lockId: 677001,
    sql: `
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='users' AND column_name='taskWorkSchedule') AS "колонка users.taskWorkSchedule",
        to_regclass('public.task_schedule_changes') IS NOT NULL AS "таблица истории расписаний",
        to_regclass('public.task_schedule_changes_user_created_idx') IS NOT NULL AS "индекс истории"
    `,
  },
  {
    version: '6.78',
    title: 'Закрытые команды модуля задач',
    file: file('ver. 6.78 private-task-teams.sql'),
    lockId: 678001,
    sql: `
      SELECT
        (SELECT COUNT(*) FROM task_teams
          WHERE access <> 'members' OR "isHidden" IS NOT TRUE) = 0 AS "все команды закрыты",
        (SELECT column_default = '''members''::character varying' FROM information_schema.columns
          WHERE table_name='task_teams' AND column_name='access') AS "умолчание access",
        (SELECT column_default = 'true' FROM information_schema.columns
          WHERE table_name='task_teams' AND column_name='isHidden') AS "умолчание isHidden",
        (SELECT COUNT(*) = 2 FROM pg_constraint
          WHERE conrelid = 'task_teams'::regclass
            AND conname IN ('task_teams_private_access', 'task_teams_always_hidden')) AS "ограничения на месте"
    `,
  },
  {
    version: '6.79',
    title: 'Словарь предметов склада',
    file: file('ver. 6.79 warehouse-item-rules.sql'),
    lockId: 679001,
    sql: `
      SELECT
        to_regclass('public.warehouse_item_rules') IS NOT NULL AS "таблица словаря",
        to_regclass('public.warehouse_item_rules_pattern_uniq') IS NOT NULL AS "уникальность выражений",
        (SELECT COUNT(*) = 3 FROM pg_constraint
          WHERE conrelid = to_regclass('public.warehouse_item_rules')
            AND conname IN ('warehouse_item_rules_match_chk',
                            'warehouse_item_rules_accounting_chk',
                            'warehouse_item_rules_pattern_chk')) AS "ограничения на месте"
    `,
    // Категории заводятся этой же миграцией, но полнотой схемы не являются: их
    // могли завести и руками, и тогда вставка ничего не делает. Показываем
    // числом, а не галочкой, чтобы не выдавать «не применено» на ровном месте.
    info: `SELECT COUNT(*)::int AS n FROM warehouse_categories`,
    infoLabel: n => `категорий в справочнике: ${n}`,
  },
  {
    version: '6.80',
    title: 'Размещение имущества по кабинетам',
    file: file('ver. 6.80 warehouse-osv-placements.sql'),
    lockId: 680001,
    sql: `
      SELECT
        to_regclass('public.warehouse_osv_placements') IS NOT NULL AS "таблица размещений",
        to_regclass('public.warehouse_osv_placements_uniq') IS NOT NULL AS "уникальность строка+кабинет",
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='warehouse_assets' AND column_name='osvPlacementId') AS "ссылка у карточек"
    `,
  },
];

async function checkStep(connection, step) {
  const result = await connection.query(step.sql);
  const row = result.rows[0] || {};
  const checks = Object.entries(row).map(([label, value]) => [label, value === true]);
  const complete = checks.length > 0 && checks.every(([, ok]) => ok);

  let info = null;
  if (step.info) {
    const extra = await connection.query(step.info);
    info = step.infoLabel(extra.rows[0]?.n);
  }
  return { checks, complete, info };
}

function printStep(step, state) {
  console.log(`\n── ${step.version} · ${step.title}`);
  for (const [label, ok] of state.checks) console.log(`   ${ok ? '✓' : '✗'} ${label}`);
  if (state.info) console.log(`   · ${state.info}`);
}

async function applyStep(connection, step) {
  if (!fs.existsSync(step.file)) {
    throw new Error(`не найден файл миграции: ${path.basename(step.file)}`);
  }

  await connection.query('SELECT pg_advisory_lock($1)', [step.lockId]);
  try {
    // Состояние перечитывается уже под блокировкой: между первой проверкой и
    // этим моментом миграцию мог применить параллельный запуск.
    const before = await checkStep(connection, step);
    if (before.complete) {
      console.log(`   уже применена — пропускаю`);
      return false;
    }

    try {
      await connection.query(fs.readFileSync(step.file, 'utf8'));
    } catch (error) {
      // Файл сам открывает транзакцию, поэтому после ошибки соединение остаётся
      // в ней. Без явного отката следующий шаг упал бы на «current transaction
      // is aborted» и увёл диагностику в сторону от настоящей причины.
      await connection.query('ROLLBACK').catch(() => {});
      throw error;
    }

    const after = await checkStep(connection, step);
    if (!after.complete) {
      printStep(step, after);
      throw new Error(`миграция ${step.version} выполнилась, но итоговая проверка схемы не пройдена`);
    }
    console.log(`   ✅ применена`);
    return true;
  } finally {
    await connection.query('SELECT pg_advisory_unlock($1)', [step.lockId]).catch(() => {});
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;

  try {
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();

    const database = sequelize.config.database;
    const host = sequelize.config.host;
    console.log(`База: ${database} на ${host}`);
    console.log(checkOnly ? 'Режим: только проверка, ничего не меняется' : 'Режим: применение миграций 6.77–6.80');

    const states = [];
    for (const step of STEPS) {
      const state = await checkStep(connection, step);
      printStep(step, state);
      states.push(state);
    }

    if (checkOnly) {
      const pending = STEPS.filter((_, i) => !states[i].complete);
      console.log(pending.length
        ? `\nЖдут применения: ${pending.map(s => s.version).join(', ')}`
        : '\nВсё применено, делать нечего');
      if (pending.length) process.exitCode = 2;
      return;
    }

    console.log('\n── Применение ────────────────────────────────────────────');
    let applied = 0;
    for (const step of STEPS) {
      console.log(`\n${step.version} · ${step.title}`);
      if (await applyStep(connection, step)) applied += 1;
    }

    console.log(applied
      ? `\n✅ Готово. Применено миграций: ${applied} из ${STEPS.length}`
      : '\n✅ Готово. Все миграции были применены ранее');
    console.log('Перезапустите процесс приложения: pm2 restart alfa-wiki');
  } finally {
    if (connection) await sequelize.connectionManager.releaseConnection(connection);
  }
}

main()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error(`\n❌ Не выполнено: ${error?.original?.message || error.message}`);
    console.error('Схема осталась в том состоянии, в котором была до упавшего шага —');
    console.error('уже применённые миграции откатывать не нужно, скрипт можно запустить повторно.');
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
