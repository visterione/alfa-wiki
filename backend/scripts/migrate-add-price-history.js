const { sequelize } = require('../models');

async function runMigration() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Adding priceHistory column to price_comparison_items table...');

    // Проверяем, существует ли уже колонка
    const [results] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'price_comparison_items'
      AND column_name = 'priceHistory';
    `);

    if (results.length > 0) {
      console.log('⚠️  Column priceHistory already exists, skipping...');
    } else {
      await sequelize.query(`
        ALTER TABLE price_comparison_items
        ADD COLUMN "priceHistory" JSONB DEFAULT '{}'::jsonb NOT NULL;
      `);
      console.log('✅ priceHistory column added successfully');
    }

    console.log('\n🎉 Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
