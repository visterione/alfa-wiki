require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function runMigration() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Creating executor_settings table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS executor_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "misUserId" VARCHAR(50) NOT NULL UNIQUE,
        "doctorName" VARCHAR(255),
        settings JSONB DEFAULT '{}'::jsonb NOT NULL,
        "updatedBy" UUID,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    console.log('✅ executor_settings table created');

    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS executor_settings_mis_user_id_idx
      ON executor_settings("misUserId");
    `);
    console.log('✅ Indexes created');

    console.log('\n🎉 Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
