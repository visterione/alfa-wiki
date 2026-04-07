#!/usr/bin/env node
/**
 * Миграция: добавить поле comparisonType в price_comparisons
 * Запуск: node backend/scripts/run-migration-comparison-type.js
 */

const { sequelize } = require('../models');

const runMigration = async () => {
  try {
    console.log('🔄 Добавляем поле comparisonType в price_comparisons...\n');

    try {
      await sequelize.query('ROLLBACK;');
    } catch (e) {}

    const transaction = await sequelize.transaction();

    try {
      await sequelize.query(
        `ALTER TABLE price_comparisons ADD COLUMN IF NOT EXISTS "comparisonType" VARCHAR(20) NOT NULL DEFAULT 'external';`,
        { transaction }
      );

      await transaction.commit();
      console.log('✅ Миграция выполнена успешно!');

      const [results] = await sequelize.query(`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'price_comparisons' AND column_name = 'comparisonType';
      `);
      console.log('\n📊 Результат:', results[0]);

      process.exit(0);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    process.exit(1);
  }
};

runMigration();
