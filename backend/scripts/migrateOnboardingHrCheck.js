#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.56 — шаг онбординга «Проверка отделом кадров» (hr_check).
 *
 * Схему она не трогает: шаги описаны в коде (services/onboarding/process.js), а
 * назначения — строки в onb_assignments с текстовым stepKey. Работы ровно на
 * одно: открыть задачу тем заявкам, которые согласовали до выката. Чек-лист
 * готовности собирается из шагов, и без такой задачи новый пункт остался бы у
 * них вечно незакрытым — заявка никогда не дошла бы до «Запущен», а открыть
 * пункт было бы нечем.
 *
 * Запуск из backend/:
 *   npm run migrate:7.56
 *
 * Только проверка, без изменений:
 *   npm run migrate:7.56:check
 *
 * SQL идемпотентен: повторную задачу ловит уникальный индекс
 * onb_tasks_app_step_uniq, повторный запуск безопасен.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.56 onboarding-hr-check.sql';
const migrationPath = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

// Те же статусы, что и в SQL. Запущенных и черновиков миграция не касается:
// первым процесс уже закончен, вторым задачу поставит согласование главврача.
const STATUSES = ['approved', 'mis_created'];

async function getState() {
  // Заявки в работе, у которых задачи по новому шагу ещё нет. Это и есть
  // единственная мера готовности: таблиц и колонок миграция не добавляет.
  const [[pending]] = await sequelize.query(`
    SELECT count(*)::int AS missing
      FROM onb_applications a
     WHERE a.status IN (:statuses)
       AND NOT EXISTS (
         SELECT 1 FROM onb_tasks t
          WHERE t."applicationId" = a.id AND t."stepKey" = 'hr_check'
       )
  `, { replacements: { statuses: STATUSES } });

  const [[tasks]] = await sequelize.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "completedAt" IS NULL)::int AS open,
           count(*) FILTER (WHERE "completedAt" IS NULL
                              AND "assigneeIds" = '[]'::jsonb)::int AS unassigned
      FROM onb_tasks WHERE "stepKey" = 'hr_check'
  `);

  // Назначение — не часть миграции, но без него задачи висят без исполнителя, и
  // узнать об этом лучше здесь, а не через неделю по просроченной заявке.
  const [[assignees]] = await sequelize.query(`
    SELECT count(*)::int AS total FROM onb_assignments WHERE "stepKey" = 'hr_check'
  `);

  return {
    missing: Number(pending.missing),
    tasks: { total: Number(tasks.total), open: Number(tasks.open), unassigned: Number(tasks.unassigned) },
    assignees: Number(assignees.total)
  };
}

function stateIsComplete(state) {
  return state.missing === 0;
}

function printState(state) {
  console.log(`   ${state.missing === 0 ? '✓' : '✗'} заявок в работе без задачи «Проверка отделом кадров»: ${state.missing}`);
  console.log(`   – задач по шагу всего: ${state.tasks.total}, из них открытых: ${state.tasks.open}`);
  if (state.tasks.unassigned) {
    console.log(`   ⚠ открытых задач без исполнителя: ${state.tasks.unassigned}`);
  }
  console.log(`   ${state.assignees ? '✓' : '⚠'} назначено исполнителей на шаг: ${state.assignees}`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.56 — проверка отделом кадров в онбординге\n');
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`не найден файл миграции: ${migrationPath}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(stateIsComplete(before)
      ? '\n✅ Миграция 7.56 применена\n'
      : '\n⚠️  Есть заявки без задачи по новому шагу — запустите npm run migrate:7.56\n');
    return;
  }

  if (stateIsComplete(before)) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
  } else {
    console.log(`\n   Применяю SQL: ${MIGRATION_FILE}`);
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(fs.readFileSync(migrationPath, 'utf8'), { transaction });
    });

    console.log('\n   Состояние после:');
    const after = await getState();
    printState(after);
    if (!stateIsComplete(after)) {
      throw new Error('итоговая проверка не пройдена: остались заявки без задачи по шагу');
    }
    console.log('\n✅ Миграция 7.56 успешно применена');
  }

  console.log('   Дальше:');
  console.log('   1) выдайте сотруднику кадров доступ: «Пользователи → Модули → Онбординг врача»;');
  console.log('   2) назначьте его на шаг «Проверка отделом кадров» в настройках раздела — шаг сетевой,');
  console.log('      филиал выбирать не нужно. Сохранение подхватит и уже открытые задачи.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
