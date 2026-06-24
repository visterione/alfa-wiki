/**
 * Скрипт для добавления полей series и number в таблицу accreditations
 *   series — серия аккредитации (буквы/цифры, необязательно)
 *   number — номер аккредитации (буквы/цифры, необязательно)
 */

const { sequelize } = require('../models');

async function addColumns() {
  try {
    console.log('Добавление столбцов series и number...');

    await sequelize.query(`
      ALTER TABLE accreditations
      ADD COLUMN IF NOT EXISTS "series" VARCHAR(50);
    `);
    await sequelize.query(`
      COMMENT ON COLUMN accreditations."series" IS 'Серия аккредитации (буквы/цифры, необязательно)';
    `);
    console.log('✓ Столбец series добавлен');

    await sequelize.query(`
      ALTER TABLE accreditations
      ADD COLUMN IF NOT EXISTS "number" VARCHAR(50);
    `);
    await sequelize.query(`
      COMMENT ON COLUMN accreditations."number" IS 'Номер аккредитации (буквы/цифры, необязательно)';
    `);
    console.log('✓ Столбец number добавлен');

    const [results] = await sequelize.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'accreditations' AND column_name IN ('series', 'number')
      ORDER BY column_name;
    `);
    console.log('\n✓ Миграция выполнена. Столбцы:', results);
  } catch (error) {
    console.error('Ошибка при выполнении миграции:', error);
    throw error;
  }
}

addColumns()
  .then(() => { console.log('\nГотово!'); process.exit(0); })
  .catch((error) => { console.error('\nОшибка:', error); process.exit(1); });
