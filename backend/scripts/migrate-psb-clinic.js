/**
 * Migration: Add clinicId column to performed_service_bonuses table
 * and update unique constraint to (misUserId, serviceCode, clinicId).
 *
 * Run: node backend/scripts/migrate-psb-clinic.js
 */

const { sequelize } = require('../models');

async function migrate() {
  const qi = sequelize.getQueryInterface();
  const dialect = sequelize.getDialect();

  console.log('Starting migration: performed_service_bonuses + clinicId');

  try {
    // 1. Add clinicId column if it doesn't exist
    await sequelize.query(`
      ALTER TABLE performed_service_bonuses
      ADD COLUMN IF NOT EXISTS "clinicId" VARCHAR(50) NOT NULL DEFAULT '';
    `);
    console.log('Column "clinicId" added (or already exists).');
  } catch (e) {
    console.error('Error adding column:', e.message);
    process.exit(1);
  }

  try {
    // 2. Drop old unique constraint on (misUserId, serviceCode) — name may vary
    //    Try common generated names; ignore errors if not found.
    const dropAttempts = [
      `ALTER TABLE performed_service_bonuses DROP CONSTRAINT IF EXISTS performed_service_bonuses_mis_user_id_service_code_key;`,
      `ALTER TABLE performed_service_bonuses DROP CONSTRAINT IF EXISTS "performed_service_bonuses_misUserId_serviceCode_key";`,
      `DROP INDEX IF EXISTS "performed_service_bonuses_mis_user_id_service_code";`,
      `DROP INDEX IF EXISTS "performed_service_bonuses_misUserId_serviceCode";`,
    ];
    for (const sql of dropAttempts) {
      try { await sequelize.query(sql); } catch (_) { /* ignore */ }
    }
    console.log('Old unique constraint drop attempted.');
  } catch (e) {
    console.warn('Warning dropping old constraint:', e.message);
  }

  try {
    // 3. Create new unique index on (misUserId, serviceCode, clinicId)
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "performed_service_bonuses_misUserId_serviceCode_clinicId"
      ON performed_service_bonuses ("misUserId", "serviceCode", "clinicId");
    `);
    console.log('New unique index created.');
  } catch (e) {
    console.error('Error creating unique index:', e.message);
    process.exit(1);
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
