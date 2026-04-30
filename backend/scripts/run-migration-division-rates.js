const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '../migrations/ver. 3.52 add-division-rates.sql'),
      'utf8'
    );
    await sequelize.query(sql);
    console.log('✅ Колонка rates добавлена в structural_divisions');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    process.exit(1);
  }
}

runMigration();
