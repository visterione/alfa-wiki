/**
 * Скрипт для добавления полей misUserId и supersededById в таблицу accreditations
 *   misUserId      — ID сотрудника в МИС (источник ФИО/специальности/клиник)
 *   supersededById — ID новой версии аккредитации, заменившей эту (архив/история)
 */

const { sequelize } = require('../models');

async function addColumns() {
  try {
    console.log('Добавление столбцов misUserId и supersededById...');

    await sequelize.query(`
      ALTER TABLE accreditations
      ADD COLUMN IF NOT EXISTS "misUserId" INTEGER;
    `);
    await sequelize.query(`
      COMMENT ON COLUMN accreditations."misUserId" IS 'ID сотрудника в МИС (источник ФИО/специальности/клиник)';
    `);
    console.log('✓ Столбец misUserId добавлен');

    await sequelize.query(`
      ALTER TABLE accreditations
      ADD COLUMN IF NOT EXISTS "supersededById" UUID;
    `);
    await sequelize.query(`
      COMMENT ON COLUMN accreditations."supersededById" IS 'ID новой версии аккредитации, заменившей эту (для архива/истории)';
    `);
    console.log('✓ Столбец supersededById добавлен');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_accreditations_mis_user_id
      ON accreditations("misUserId");
    `);
    console.log('✓ Индекс по misUserId создан');

    const [results] = await sequelize.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'accreditations' AND column_name IN ('misUserId', 'supersededById')
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
