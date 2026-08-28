#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.56 — новые шаги онбординга «Проверка отделом кадров»
 * (hr_check) и «Карточка врача» (doctor_card).
 *
 * Схему она не трогает: шаги описаны в коде (services/onboarding/process.js), а
 * назначения — строки в onb_assignments с текстовым stepKey. Работы ровно на
 * одно: открыть задачи тем заявкам, которые начали процесс до выката. Чек-лист
 * готовности собирается из шагов, и без таких задач новые пункты остались бы у
 * них вечно незакрытыми — заявка никогда не дошла бы до «Запущен», а открыть
 * пункты было бы нечем.
 *
 * Шаги в разных местах процесса, поэтому и заявки разные: кадры идут от
 * согласования (approved и mis_created), карточка врача — после создания
 * учётки (только mis_created, остальным её поставит сам движок).
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

const MIGRATION_FILE = 'ver. 7.56 onboarding-new-steps.sql';
const migrationPath = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

// Те же шаги и статусы, что и в SQL. Запущенных и черновиков миграция не
// касается: первым процесс уже закончен, вторым задачи поставит согласование.
const STEPS = [
  { key: 'hr_check',    title: 'Проверка отделом кадров', statuses: ['approved', 'mis_created'] },
  { key: 'doctor_card', title: 'Карточка врача',          statuses: ['mis_created'] },
];

async function stepState(step) {
  // Заявки, у которых задачи по шагу ещё нет. Это и есть мера готовности:
  // таблиц и колонок миграция не добавляет.
  const [[pending]] = await sequelize.query(`
    SELECT count(*)::int AS missing
      FROM onb_applications a
     WHERE a.status IN (:statuses)
       AND NOT EXISTS (
         SELECT 1 FROM onb_tasks t
          WHERE t."applicationId" = a.id AND t."stepKey" = :stepKey
       )
  `, { replacements: { statuses: step.statuses, stepKey: step.key } });

  const [[tasks]] = await sequelize.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "completedAt" IS NULL)::int AS open,
           count(*) FILTER (WHERE "completedAt" IS NULL
                              AND "assigneeIds" = '[]'::jsonb)::int AS unassigned
      FROM onb_tasks WHERE "stepKey" = :stepKey
  `, { replacements: { stepKey: step.key } });

  // Назначение — не часть миграции, но без него задачи висят без исполнителя, и
  // узнать об этом лучше здесь, а не через неделю по просроченной заявке.
  const [[assignees]] = await sequelize.query(`
    SELECT count(*)::int AS total FROM onb_assignments WHERE "stepKey" = :stepKey
  `, { replacements: { stepKey: step.key } });

  return {
    ...step,
    missing: Number(pending.missing),
    total: Number(tasks.total),
    open: Number(tasks.open),
    unassigned: Number(tasks.unassigned),
    assignees: Number(assignees.total)
  };
}

async function getState() {
  const steps = [];
  for (const step of STEPS) steps.push(await stepState(step));
  return { steps };
}

function stateIsComplete(state) {
  return state.steps.every(step => step.missing === 0);
}

function printState(state) {
  for (const step of state.steps) {
    console.log(`   ${step.missing === 0 ? '✓' : '✗'} «${step.title}»: заявок без задачи — ${step.missing}`);
    console.log(`       задач по шагу ${step.total}, из них открытых ${step.open}`);
    if (step.unassigned) {
      console.log(`       ⚠ открытых задач без исполнителя: ${step.unassigned}`);
    }
    console.log(`       ${step.assignees ? '✓' : '⚠'} назначено исполнителей: ${step.assignees}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.56 — новые шаги онбординга\n');
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
      : '\n⚠️  Есть заявки без задач по новым шагам — запустите npm run migrate:7.56\n');
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
      throw new Error('итоговая проверка не пройдена: остались заявки без задач по новым шагам');
    }
    console.log('\n✅ Миграция 7.56 успешно применена');
  }

  console.log('   Дальше:');
  console.log('   1) выдайте доступ исполнителям: «Пользователи → Модули → Онбординг врача»;');
  console.log('   2) назначьте их в настройках раздела. «Проверка отделом кадров» — шаг сетевой,');
  console.log('      филиал выбирать не нужно; «Карточка врача» — филиальный, по одному на МЦ.');
  console.log('      Сохранение подхватит и уже открытые задачи.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
