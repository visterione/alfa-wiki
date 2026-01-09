/**
 * Миграция для создания таблицы analyses (анализы)
 * 
 * Запуск: node scripts/migrateAnalyses.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Создание таблицы analyses
    console.log('🔄 Creating analyses table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS analyses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "medCenter" VARCHAR(50) NOT NULL,
        "serviceCode" VARCHAR(100) NOT NULL,
        "serviceName" VARCHAR(500) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        "isStopped" BOOLEAN DEFAULT false,
        "preparationLink" VARCHAR(1000),
        comment TEXT,
        "misServiceId" VARCHAR(50),
        "lastPriceUpdate" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Analyses table created');

    // Создание индексов
    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_medcenter ON analyses("medCenter");
      CREATE INDEX IF NOT EXISTS idx_analyses_servicecode ON analyses("serviceCode");
      CREATE INDEX IF NOT EXISTS idx_analyses_servicename ON analyses("serviceName");
      CREATE INDEX IF NOT EXISTS idx_analyses_isstopped ON analyses("isStopped");
      CREATE INDEX IF NOT EXISTS idx_analyses_misserviceid ON analyses("misServiceId");
    `);
    console.log('✅ Indexes created');

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Следующие шаги:');
    console.log('  1. Добавьте модель Analysis в backend/models/index.js');
    console.log('  2. Зарегистрируйте роут в server.js:');
    console.log('     const analysesRoutes = require("./routes/analyses");');
    console.log('     app.use("/api/analyses", analysesRoutes);');
    console.log('  3. Создайте wiki-страницу со slug "analyses"');
    console.log('  4. Вставьте HTML код из analyses.html');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();