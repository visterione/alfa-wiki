/**
 * Миграция для создания таблицы vehicles
 * 
 * Запуск: node scripts/migrateVehicles.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Создание ENUM типа для condition
    console.log('🔄 Creating ENUM type for condition...');
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE vehicle_condition_enum AS ENUM ('Хорошее', 'Удовлетворительное', 'Плохое');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✅ ENUM type created');

    // Создание таблицы vehicles
    console.log('🔄 Creating vehicles table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization VARCHAR(255) NOT NULL,
        "carBrand" VARCHAR(255) NOT NULL,
        "licensePlate" VARCHAR(50) NOT NULL,
        "carYear" INTEGER NOT NULL,
        mileage INTEGER NOT NULL DEFAULT 0,
        "nextTO" INTEGER NOT NULL DEFAULT 0,
        "insuranceDate" DATE NOT NULL,
        condition vehicle_condition_enum NOT NULL,
        comment TEXT,
        "reminded90" BOOLEAN DEFAULT false,
        "reminded60" BOOLEAN DEFAULT false,
        "reminded30" BOOLEAN DEFAULT false,
        "reminded14" BOOLEAN DEFAULT false,
        "reminded7" BOOLEAN DEFAULT false,
        "remindedTO" BOOLEAN DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Vehicles table created');

    // Создание индексов
    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicles_organization ON vehicles(organization);
      CREATE INDEX IF NOT EXISTS idx_vehicles_carbrand ON vehicles("carBrand");
      CREATE INDEX IF NOT EXISTS idx_vehicles_licenseplate ON vehicles("licensePlate");
      CREATE INDEX IF NOT EXISTS idx_vehicles_insurancedate ON vehicles("insuranceDate");
      CREATE INDEX IF NOT EXISTS idx_vehicles_condition ON vehicles(condition);
      CREATE INDEX IF NOT EXISTS idx_vehicles_mileage ON vehicles(mileage);
      CREATE INDEX IF NOT EXISTS idx_vehicles_nextto ON vehicles("nextTO");
    `);
    console.log('✅ Indexes created');

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Следующие шаги:');
    console.log('  1. Зарегистрируйте роут в server.js:');
    console.log('     const vehiclesRoutes = require("./routes/vehicles");');
    console.log('     app.use("/api/vehicles", vehiclesRoutes);');
    console.log('  2. Создайте wiki-страницу со slug "vehicles"');
    console.log('  3. Вставьте HTML код в режиме HTML редактора');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();