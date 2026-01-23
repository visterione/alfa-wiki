const { sequelize } = require('../models');

async function runMigration() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Creating price_comparisons table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS price_comparisons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        "createdBy" UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
        competitors JSONB DEFAULT '[]'::jsonb NOT NULL,
        "ownMedCenters" JSONB DEFAULT '[]'::jsonb NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    console.log('✅ price_comparisons table created');

    console.log('🔄 Creating price_comparison_items table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS price_comparison_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "comparisonId" UUID NOT NULL REFERENCES price_comparisons(id) ON UPDATE CASCADE ON DELETE CASCADE,
        "serviceCode" VARCHAR(100) NOT NULL,
        "serviceName" VARCHAR(500) NOT NULL,
        "misServiceId" VARCHAR(50),
        prices JSONB DEFAULT '{}'::jsonb NOT NULL,
        "sortOrder" INTEGER DEFAULT 0 NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    console.log('✅ price_comparison_items table created');

    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS price_comparisons_created_by_idx
      ON price_comparisons("createdBy");
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS price_comparison_items_comparison_id_idx
      ON price_comparison_items("comparisonId");
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS price_comparison_items_service_code_idx
      ON price_comparison_items("serviceCode");
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
