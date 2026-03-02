/**
 * Migration: Increase serviceName column in performed_service_bonuses from VARCHAR(255) to VARCHAR(500)
 * Needed because some MIS service names exceed 255 characters.
 *
 * Run: node backend/scripts/migrate-psb-service-name.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function migrate() {
  console.log('Starting migration: performed_service_bonuses serviceName VARCHAR(255) → VARCHAR(500)');

  try {
    await sequelize.authenticate();
    console.log('Connected to database.');

    await sequelize.query(`
      ALTER TABLE performed_service_bonuses
      ALTER COLUMN "serviceName" TYPE VARCHAR(500);
    `);
    console.log('Column "serviceName" altered to VARCHAR(500).');

    console.log('Migration complete.');
    process.exit(0);
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  }
}

migrate().catch(e => { console.error(e); process.exit(1); });
