'use strict';

/**
 * ver. 6.65 — Артикулы услуг лаборатории в позициях сравнения цен.
 *
 * Добавляет price_comparison_items."misRefs": какие услуги МИС стоят за
 * колонкой листа. Лабораторный лист собран по коду 804н, а артикул у каждой
 * лаборатории свой — и для файла импорта в МИС он единственный ключ
 * обновления прайса.
 *
 * Запуск из каталога backend:
 *   node scripts/migrate-comparison-mis-refs.js
 *
 * Повторный запуск безопасен: колонка добавляется, только если её ещё нет.
 * Заполнять её задним числом нечем — артикулы приходят из МИС. Существующие
 * листы получат их при первой же сборке файла импорта: она читает
 * прейскурант МИС и сохраняет найденное сюда.
 */

const { sequelize } = require('../models');

async function run() {
  console.log('🔄 Подключаюсь к базе...');
  await sequelize.authenticate();
  console.log('✅ Подключение есть');

  const [before] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'price_comparison_items' AND column_name = 'misRefs'`
  );
  if (before.length) {
    console.log('ℹ️  Колонка "misRefs" уже есть — миграция не нужна.');
    return;
  }

  console.log('🔄 Добавляю колонку "misRefs"...');
  await sequelize.query(`
    ALTER TABLE price_comparison_items
      ADD COLUMN IF NOT EXISTS "misRefs" JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await sequelize.query(`
    COMMENT ON COLUMN price_comparison_items."misRefs" IS
      'Услуги МИС за колонкой листа: {"CL-lab": [{code, serviceId, title, categoryPath}]}. '
      'Заполняется при добавлении услуг и при сборке файла импорта'
  `);

  const [[check]] = await sequelize.query(
    `SELECT data_type, column_default
       FROM information_schema.columns
      WHERE table_name = 'price_comparison_items' AND column_name = 'misRefs'`
  );
  if (!check) throw new Error('колонка не появилась — миграция не сработала');

  const [[stats]] = await sequelize.query('SELECT count(*) AS total FROM price_comparison_items');

  console.log(`✅ Колонка добавлена: ${check.data_type}, по умолчанию ${check.column_default}`);
  console.log(`   Позиций в сравнениях: ${stats.total} — артикулы подтянутся при первой сборке файла импорта.`);
}

run()
  .then(() => console.log('🎉 Готово. Перезапустите бэкенд, чтобы модель увидела новое поле.'))
  .catch(err => {
    console.error('❌ Миграция не прошла:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
