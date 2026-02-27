require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function runMigration() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Creating performed_service_bonuses table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS performed_service_bonuses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "misUserId" VARCHAR(50) NOT NULL,
        "doctorName" VARCHAR(255),
        "serviceCode" VARCHAR(255) NOT NULL,
        "serviceName" VARCHAR(255),
        "bonusPercent" DECIMAL(10,4),
        "bonusRub" DECIMAL(10,2),
        "createdBy" UUID,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT performed_service_bonuses_mis_user_service_unique UNIQUE ("misUserId", "serviceCode")
      );
    `);
    console.log('✅ performed_service_bonuses table created');

    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS performed_service_bonuses_mis_user_id_idx
      ON performed_service_bonuses("misUserId");
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
