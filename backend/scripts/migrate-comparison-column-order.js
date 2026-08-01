'use strict';

/**
 * ver. 6.40 — Свой порядок колонок на листе сравнения цен.
 *
 * Добавляет price_comparisons."columnOrder": список названий колонок в том
 * порядке, в каком человек расставил их, перетаскивая заголовки таблицы.
 * Пустой массив означает порядок по умолчанию — эталон первым, остальные
 * как пришли, — поэтому существующие листы после миграции выглядят
 * ровно так же, как до неё.
 *
 * Запуск из каталога backend:
 *   node scripts/migrate-comparison-column-order.js
 *
 * Повторный запуск безопасен: колонка добавляется, только если её ещё нет.
 */

const { sequelize } = require('../models');

async function run() {
  console.log('🔄 Подключаюсь к базе...');
  await sequelize.authenticate();
  console.log('✅ Подключение есть');

  const [before] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'price_comparisons' AND column_name = 'columnOrder'`
  );
  if (before.length) {
    console.log('ℹ️  Колонка "columnOrder" уже есть — миграция не нужна.');
    return;
  }

  console.log('🔄 Добавляю колонку "columnOrder"...');
  await sequelize.query(`
    ALTER TABLE price_comparisons
      ADD COLUMN IF NOT EXISTS "columnOrder" JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await sequelize.query(`
    COMMENT ON COLUMN price_comparisons."columnOrder" IS
      'Порядок колонок в таблице; пустой массив — порядок по умолчанию'
  `);

  const [[check]] = await sequelize.query(
    `SELECT data_type, column_default
       FROM information_schema.columns
      WHERE table_name = 'price_comparisons' AND column_name = 'columnOrder'`
  );
  if (!check) throw new Error('колонка не появилась — миграция не сработала');

  const [[stats]] = await sequelize.query('SELECT count(*) AS total FROM price_comparisons');

  console.log(`✅ Колонка добавлена: ${check.data_type}, по умолчанию ${check.column_default}`);
  console.log(`   Листов сравнения: ${stats.total} — все с порядком по умолчанию.`);
}

run()
  .then(() => console.log('🎉 Готово. Перезапустите бэкенд, чтобы модель увидела новое поле.'))
  .catch(err => {
    console.error('❌ Миграция не прошла:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
