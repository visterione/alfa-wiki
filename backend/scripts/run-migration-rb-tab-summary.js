#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sequelize } = require('../models');

async function run() {
  try {
    await sequelize.query(`
      ALTER TABLE rb_user_permissions
      ADD COLUMN IF NOT EXISTS "tabSummary" VARCHAR(10) NOT NULL DEFAULT 'edit';
    `);
    console.log('✅ Колонка tabSummary добавлена в rb_user_permissions');
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
