/**
 * Миграция: Изменение типа поля size с INTEGER на BIGINT
 *
 * Описание:
 * Изменяет тип данных столбца size с INTEGER на BIGINT в таблицах:
 * - media
 * - accreditation_files
 * - vehicle_files
 *
 * Это необходимо для поддержки файлов размером более 2 ГБ
 * (максимум INTEGER: 2,147,483,647 байт)
 *
 * Запуск: node backend/migrations/change-media-size-to-bigint.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🚀 Начало миграции: изменение типа поля size с INTEGER на BIGINT');

    // Изменяем тип столбца size в таблице media
    console.log('📝 Обновление таблицы media...');
    await sequelize.query(`
      ALTER TABLE media
      ALTER COLUMN size TYPE BIGINT;
    `);
    console.log('✅ Таблица media обновлена');

    // Изменяем тип столбца size в таблице accreditation_files
    console.log('📝 Обновление таблицы accreditation_files...');
    await sequelize.query(`
      ALTER TABLE accreditation_files
      ALTER COLUMN size TYPE BIGINT;
    `);
    console.log('✅ Таблица accreditation_files обновлена');

    // Изменяем тип столбца size в таблице vehicle_files
    console.log('📝 Обновление таблицы vehicle_files...');
    await sequelize.query(`
      ALTER TABLE vehicle_files
      ALTER COLUMN size TYPE BIGINT;
    `);
    console.log('✅ Таблица vehicle_files обновлена');

    console.log('ℹ️  Теперь поддерживаются файлы до 9,223,372,036,854,775,807 байт (~9 ЭБ)');

    await sequelize.close();
    console.log('✅ Миграция завершена успешно');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    await sequelize.close();
    process.exit(1);
  }
}

migrate();
