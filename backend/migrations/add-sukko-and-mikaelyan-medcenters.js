/**
 * Миграция: Добавление медцентров "Сукко" и "ИП Микаелян"
 *
 * 1. Расширяет ENUM-типы в PostgreSQL новыми значениями
 * 2. Вставляет новые записи в таблицу med_centers
 *
 * Запуск: node backend/migrations/add-sukko-and-mikaelyan-medcenters.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize, MedCenter } = require('../models');

async function migrate() {
  try {
    console.log('🚀 Начало миграции: добавление Сукко и ИП Микаелян');

    // 1. Расширяем ENUM-типы в PostgreSQL
    // Sequelize ENUM для PostgreSQL создаёт отдельный тип вида "enum_tablename_columnname"
    const enumQueries = [
      // MedCenter.name
      `ALTER TYPE "enum_med_centers_name" ADD VALUE IF NOT EXISTS 'Сукко'`,
      `ALTER TYPE "enum_med_centers_name" ADD VALUE IF NOT EXISTS 'ИП Микаелян'`,
      // Accreditation.medCenter
      `ALTER TYPE "enum_accreditations_medCenter" ADD VALUE IF NOT EXISTS 'Сукко'`,
      `ALTER TYPE "enum_accreditations_medCenter" ADD VALUE IF NOT EXISTS 'ИП Микаелян'`,
      // Promotion.medCenter
      `ALTER TYPE "enum_promotions_medCenter" ADD VALUE IF NOT EXISTS 'Сукко'`,
      `ALTER TYPE "enum_promotions_medCenter" ADD VALUE IF NOT EXISTS 'ИП Микаелян'`,
    ];

    for (const q of enumQueries) {
      try {
        await sequelize.query(q);
        console.log(`  ✅ ${q}`);
      } catch (e) {
        // Тип может называться иначе — выводим предупреждение и продолжаем
        console.warn(`  ⚠️  Пропущено (${e.message}): ${q}`);
      }
    }

    // 2. Проверяем и добавляем записи в med_centers
    const toAdd = [
      { name: 'Сукко', displayName: 'МЦ Сукко', description: 'Медицинский центр Сукко' },
      { name: 'ИП Микаелян', displayName: 'ИП Микаелян', description: 'ИП Микаелян' },
    ];

    for (const mc of toAdd) {
      const [record, created] = await MedCenter.findOrCreate({
        where: { name: mc.name },
        defaults: mc,
      });
      if (created) {
        console.log(`  ✅ Добавлен медцентр: ${mc.name} (id: ${record.id})`);
      } else {
        console.log(`  ℹ️  Медцентр уже существует: ${mc.name} (id: ${record.id})`);
      }
    }

    console.log('');
    console.log('🎉 Миграция успешно завершена!');
  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

migrate();
