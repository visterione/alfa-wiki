'use strict';

/**
 * ver. 6.27 — Свой логотип клиники-конкурента.
 *
 * Добавляет competitor_sources."logoIsCustom": пометку, что значок загружен
 * человеком. Без неё ночная синхронизация затирала бы вручную загруженный
 * файл картинкой с сайта при первом же прогоне (competitorPricesSync.syncLogo).
 *
 * Запуск из каталога backend:
 *   node scripts/migrate-competitor-custom-logo.js
 *
 * Повторный запуск безопасен: колонка добавляется только если её ещё нет,
 * существующие значения не трогаются.
 */

const { sequelize } = require('../models');

async function run() {
  console.log('🔄 Подключаюсь к базе...');
  await sequelize.authenticate();
  console.log('✅ Подключение есть');

  const [before] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'competitor_sources' AND column_name = 'logoIsCustom'`
  );
  if (before.length) {
    console.log('ℹ️  Колонка "logoIsCustom" уже есть — миграция не нужна.');
    return;
  }

  console.log('🔄 Добавляю колонку "logoIsCustom"...');
  await sequelize.query(`
    ALTER TABLE competitor_sources
      ADD COLUMN IF NOT EXISTS "logoIsCustom" BOOLEAN NOT NULL DEFAULT false
  `);
  await sequelize.query(`
    COMMENT ON COLUMN competitor_sources."logoIsCustom" IS
      'Логотип загружен человеком — автосбор с сайта его не трогает'
  `);

  const [[check]] = await sequelize.query(
    `SELECT data_type, column_default, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'competitor_sources' AND column_name = 'logoIsCustom'`
  );
  if (!check) throw new Error('колонка не появилась — миграция не сработала');

  const [[stats]] = await sequelize.query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE "logoData" IS NOT NULL) AS with_logo
       FROM competitor_sources`
  );

  console.log(`✅ Колонка добавлена: ${check.data_type}, по умолчанию ${check.column_default}`);
  console.log(`   Источников в зеркале: ${stats.total}, из них со значком: ${stats.with_logo}`);
  console.log('   Все помечены как «значок с сайта» — загруженные вручную появятся после первой загрузки.');
}

run()
  .then(() => console.log('🎉 Готово. Перезапустите бэкенд, чтобы модель увидела новое поле.'))
  .catch(err => {
    console.error('❌ Миграция не прошла:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
