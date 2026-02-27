require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function runMigration() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Adding forwardedFrom column to messages...');
    await sequelize.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS "forwardedFrom" JSONB DEFAULT NULL;
    `);
    console.log('✅ forwardedFrom column added to messages');

    console.log('\n🎉 Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
