/**
 * Добавляет столбец medCenters (JSONB-массив) в таблицу accreditations и
 * заполняет его для существующих записей значением [medCenter].
 *
 * Аккредитация привязана к специальности и может распространяться на несколько
 * медцентров; medCenter остаётся как «первый из списка» для совместимости.
 */

const { sequelize } = require('../models');

async function run() {
  try {
    console.log('Добавление столбца medCenters...');

    await sequelize.query(`
      ALTER TABLE accreditations
      ADD COLUMN IF NOT EXISTS "medCenters" JSONB;
    `);
    await sequelize.query(`
      COMMENT ON COLUMN accreditations."medCenters" IS 'Медцентры, на которые распространяется аккредитация (массив)';
    `);
    console.log('✓ Столбец medCenters добавлен');

    // Бэкфилл: для записей без massива проставляем [medCenter]
    const [, meta] = await sequelize.query(`
      UPDATE accreditations
      SET "medCenters" = jsonb_build_array("medCenter")
      WHERE "medCenters" IS NULL AND "medCenter" IS NOT NULL;
    `);
    console.log('✓ Бэкфилл выполнен');

    const [rows] = await sequelize.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'accreditations' AND column_name = 'medCenters';
    `);
    console.log('\n✓ Миграция выполнена. Столбец:', rows);
  } catch (error) {
    console.error('Ошибка миграции:', error);
    throw error;
  }
}

run()
  .then(() => { console.log('\nГотово!'); process.exit(0); })
  .catch(() => process.exit(1));
