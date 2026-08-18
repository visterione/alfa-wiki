#!/usr/bin/env node
'use strict';

/**
 * Runner миграции ver. 6.98 — уровень видимости блоков задач в календаре.
 *
 * Запуск из backend/:
 *   npm run migrate:task-visibility
 *
 * Только проверка, без изменений:
 *   npm run migrate:task-visibility:check
 *
 * Через node, а не psql, по простой причине: параметры подключения лежат в
 * backend/.env и в шелле их нет. `psql -U "$DB_USER"` подставляет пустую строку
 * и уходит в локальный сокет под именем системного пользователя — «role
 * administrator does not exist». Приложение читает .env само, и повторять эту
 * работу руками незачем.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.98 task-block-visibility.sql');

/** Сколько блоков задач на каком уровне видимости. */
async function state() {
  const [rows] = await sequelize.query(`
    SELECT visibility, count(*)::int AS count
    FROM calendar_events
    WHERE "taskPartId" IS NOT NULL
    GROUP BY visibility
    ORDER BY visibility
  `);
  const byLevel = Object.fromEntries(rows.map(row => [row.visibility, row.count]));
  return { byLevel, left: byLevel.team || 0, total: rows.reduce((sum, row) => sum + row.count, 0) };
}

function print({ byLevel, total }) {
  if (!total) {
    console.log('   блоков задач в календаре нет');
    return;
  }
  for (const [level, count] of Object.entries(byLevel)) {
    const mark = level === 'team' ? '○' : '✓';
    console.log(`   ${mark} уровень ${level.padEnd(8)} ${count}`);
  }
}

(async () => {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 6.98 — блоки задач становятся «занято, без названия»\n');
  if (!fs.existsSync(MIGRATION_FILE)) {
    throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);
  }

  try {
    await sequelize.authenticate();
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    const before = await state();
    console.log('   Состояние:');
    print(before);

    if (checkOnly) {
      console.log(before.left
        ? `\n⚠️  Миграция не применена: блоков с уровнем team — ${before.left}\n`
        : '\n✅ Миграция 6.98 применена\n');
      if (before.left) process.exitCode = 2;
      return;
    }

    if (!before.left) {
      console.log('\n✅ Уже применена, ничего делать не нужно\n');
      return;
    }

    console.log('\n   Применяю SQL...');
    await sequelize.query(fs.readFileSync(MIGRATION_FILE, 'utf8'));

    const after = await state();
    console.log('\n   Состояние после:');
    print(after);
    console.log(`\n✅ Закрыто блоков: ${before.left}\n`);
  } finally {
    await sequelize.close();
  }
})().catch(error => {
  console.error(`\n❌ ${error.message}\n`);
  process.exitCode = 1;
});
