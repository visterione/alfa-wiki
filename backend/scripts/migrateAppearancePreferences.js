#!/usr/bin/env node
'use strict';

/**
 * Миграция ver. 7.60 — персональное оформление стало общим для мобилки и веба.
 *
 * Тема, акцент, фон переписки и звук жили в users.settings->'mobile', пока их
 * применяло только приложение. Теперь то же самое показывает браузер, и
 * namespace называется 'appearance'.
 *
 * Схему миграция не трогает: settings — jsonb, работы ровно на одно копирование
 * ключа. Без него человек, у которого настройки уже были, открыл бы веб в
 * системной теме и решил, что его выбор потеряли.
 *
 * Копируем, а не переносим. Установленные на телефонах сборки до 7.60 читают
 * только 'mobile', и до тех пор, пока люди не обновятся, оба ключа должны
 * существовать; сервер с 7.60 пишет сразу в оба (services/userPreferences.js).
 * Поэтому в отчёте есть строка про расхождения: она про телефоны, которые ещё
 * не обновились, а не про ошибку миграции.
 *
 * Запуск из backend/:
 *   npm run migrate:7.60
 *
 * Только проверка, без изменений:
 *   npm run migrate:7.60:check
 *
 * SQL идемпотентен — он берёт только тех, у кого 'appearance' ещё нет, — так
 * что повторный запуск ничего не испортит и уже сделанный выбор в вебе не
 * затрёт старым значением с телефона.
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const MIGRATION_FILE = 'ver. 7.60 appearance-preferences.sql';
const migrationPath = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);

async function getState() {
  const [[row]] = await sequelize.query(`
    SELECT
      count(*) FILTER (
        WHERE settings ? 'mobile'
          AND jsonb_typeof(settings->'mobile') = 'object'
          AND NOT settings ? 'appearance'
      )::int AS pending,
      count(*) FILTER (WHERE settings ? 'appearance')::int AS migrated,
      count(*) FILTER (WHERE settings ? 'mobile')::int AS legacy,
      -- Расхождение — это телефон со старой сборкой, который написал в
      -- 'mobile' после того, как ключи разошлись. Само по себе оно ничего не
      -- ломает: читается 'appearance', а поверх него — недостающие ключи из
      -- 'mobile'. Но по этому числу видно, когда старый ключ можно убирать.
      count(*) FILTER (
        WHERE settings ? 'appearance'
          AND settings ? 'mobile'
          AND settings->'appearance' IS DISTINCT FROM settings->'mobile'
      )::int AS diverged
    FROM users
  `);

  return {
    pending: Number(row.pending),
    migrated: Number(row.migrated),
    legacy: Number(row.legacy),
    diverged: Number(row.diverged),
  };
}

function printState(state) {
  console.log(`   ${state.pending === 0 ? '✓' : '✗'} людей с настройками только в старом ключе: ${state.pending}`);
  console.log(`       оформление в 'appearance': ${state.migrated}`);
  console.log(`       оформление в 'mobile' (остаётся до обновления телефонов): ${state.legacy}`);
  if (state.diverged) {
    console.log(`       ⚠ ключи разошлись у ${state.diverged} — это сборки мобилки до 7.60, читается 'appearance'`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('\n▶ Миграция ver. 7.60 — оформление из «мобильного» стало общим\n');
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`не найден файл миграции: ${migrationPath}`);
  }

  await sequelize.authenticate();
  console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

  console.log('\n   Состояние до:');
  const before = await getState();
  printState(before);

  if (checkOnly) {
    console.log(before.pending === 0
      ? '\n✅ Миграция 7.60 применена\n'
      : '\n⚠️  Есть люди с оформлением только в старом ключе — запустите npm run migrate:7.60\n');
    return;
  }

  if (before.pending === 0) {
    console.log('\n✅ Миграция уже применена, ничего делать не нужно\n');
    return;
  }

  console.log(`\n   Применяю SQL: ${MIGRATION_FILE}`);
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(fs.readFileSync(migrationPath, 'utf8'), { transaction });
  });

  console.log('\n   Состояние после:');
  const after = await getState();
  printState(after);
  if (after.pending !== 0) {
    throw new Error('итоговая проверка не пройдена: остались люди с оформлением только в старом ключе');
  }
  console.log(`\n✅ Миграция 7.60 успешно применена: перенесено ${before.pending}`);
  console.log('   Старый ключ \'mobile\' остаётся намеренно: его читают сборки мобилки до 7.60.');
  console.log('   Убрать его можно будет, когда люди обновятся — расхождений в проверке станет 0.\n');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(`\n❌ Миграция не выполнена: ${error?.original?.message || error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
