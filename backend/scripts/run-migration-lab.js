#!/usr/bin/env node
/**
 * Скрипт для выполнения миграции medCenter → lab
 */

const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

const runMigration = async () => {
  try {
    console.log('🔄 Начинаем миграцию medCenter → lab...\n');

    // Сначала откатываем любую зависшую транзакцию
    try {
      await sequelize.query('ROLLBACK;');
      console.log('✅ Откатили зависшую транзакцию');
    } catch (e) {
      // Игнорируем ошибку, если транзакции не было
    }

    // Читаем файл миграции
    const migrationPath = path.join(__dirname, '../migrations/rename-medcenter-to-lab-analyses.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Извлекаем только команды между BEGIN и COMMIT
    const sqlCommands = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd && !cmd.match(/^(BEGIN|COMMIT)$/i));

    console.log('📋 Найдено команд:', sqlCommands.length);

    // Выполняем в транзакции
    const transaction = await sequelize.transaction();

    try {
      for (let i = 0; i < sqlCommands.length; i++) {
        const cmd = sqlCommands[i];
        if (cmd) {
          console.log(`\n[${i + 1}/${sqlCommands.length}] Выполняем:`);
          console.log(cmd.substring(0, 100) + (cmd.length > 100 ? '...' : ''));
          await sequelize.query(cmd, { transaction });
        }
      }

      await transaction.commit();
      console.log('\n✅ Миграция выполнена успешно!');

      // Проверяем результат
      const [results] = await sequelize.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'analyses'
        AND column_name IN ('lab', 'medCenter')
        ORDER BY column_name;
      `);

      console.log('\n📊 Текущие колонки в таблице analyses:');
      results.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });

      // Проверяем search_index
      const [indexResults] = await sequelize.query(`
        SELECT COUNT(*) as count
        FROM search_index
        WHERE entity_type = 'analysis'
        AND metadata ? 'lab';
      `);

      console.log(`\n🔍 Записей в search_index с полем 'lab': ${indexResults[0].count}`);

      process.exit(0);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('\n❌ Ошибка при выполнении миграции:', error.message);
    console.error(error);
    process.exit(1);
  }
};

// Запуск
runMigration();
