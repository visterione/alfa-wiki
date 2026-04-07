#!/usr/bin/env node
/**
 * Миграция: добавить поле lab в price_comparison_items
 * Запуск: node backend/scripts/run-migration-item-lab.js
 */

const { sequelize } = require('../models');

const runMigration = async () => {
  try {
    console.log('🔄 Добавляем поле lab в price_comparison_items...\n');

    try {
      await sequelize.query('ROLLBACK;');
    } catch (e) {}

    const transaction = await sequelize.transaction();

    try {
      await sequelize.query(
        `ALTER TABLE price_comparison_items ADD COLUMN IF NOT EXISTS "lab" VARCHAR(255) NOT NULL DEFAULT '';`,
        { transaction }
      );

      await transaction.commit();
      console.log('✅ Миграция выполнена успешно!');

      const [results] = await sequelize.query(`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'price_comparison_items' AND column_name = 'lab';
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
