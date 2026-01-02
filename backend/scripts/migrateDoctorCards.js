/**
 * Миграция для doctor_cards
 * Запуск: node scripts/migrateDoctorCards.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected');

    // Добавляем столбец misUserId если его нет
    console.log('🔄 Adding misUserId column if not exists...');
    await sequelize.query(`
      ALTER TABLE doctor_cards ADD COLUMN IF NOT EXISTS "misUserId" VARCHAR(50);
    `);
    console.log('✅ Column checked/added');

    // Индексы по одному
    const indexes = [
      ['idx_doctor_cards_page_slug', '"pageSlug"'],
      ['idx_doctor_cards_full_name', '"fullName"'],
      ['idx_doctor_cards_specialty', 'specialty'],
      ['idx_doctor_cards_sort_order', '"sortOrder"'],
      ['idx_doctor_cards_mis_user_id', '"misUserId"']
    ];

    console.log('🔄 Creating indexes...');
    for (const [name, col] of indexes) {
      try {
        await sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON doctor_cards(${col});`);
        console.log(`✅ ${name}`);
      } catch (e) {
        console.log(`⚠️ ${name}: ${e.parent?.message || e.message}`);
      }
    }

    console.log('\n🎉 Migration completed!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();