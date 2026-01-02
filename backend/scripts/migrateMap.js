/**
 * Миграция для создания таблицы map_markers
 * 
 * Запуск: node scripts/migrateMap.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Создание таблицы map_markers
    console.log('🔄 Creating map_markers table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS map_markers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        color VARCHAR(20) DEFAULT '#4a90e2',
        media JSONB DEFAULT '[]'::jsonb,
        category VARCHAR(100),
        "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Map markers table created');

    // Создание индексов
    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_map_markers_coords ON map_markers(lat, lng);
      CREATE INDEX IF NOT EXISTS idx_map_markers_color ON map_markers(color);
      CREATE INDEX IF NOT EXISTS idx_map_markers_category ON map_markers(category);
      CREATE INDEX IF NOT EXISTS idx_map_markers_created_by ON map_markers("createdBy");
    `);
    console.log('✅ Indexes created');

    // Создание папки для загрузок
    const fs = require('fs');
    const path = require('path');
    const uploadDir = path.join(__dirname, '../uploads/map');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log('✅ Upload directory created:', uploadDir);
    }

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Следующие шаги:');
    console.log('');
    console.log('  1. Добавь модель MapMarker в backend/models/index.js');
    console.log('');
    console.log('  2. Добавь в module.exports в models/index.js:');
    console.log('     MapMarker,');
    console.log('');
    console.log('  3. Добавь связь после relationships:');
    console.log('     MapMarker.belongsTo(User, { foreignKey: "createdBy", as: "creator" });');
    console.log('');
    console.log('  4. Зарегистрируй роут в server.js:');
    console.log('     const mapRoutes = require("./routes/map");');
    console.log('     app.use("/api/map", mapRoutes);');
    console.log('');
    console.log('  5. Добавь статическую раздачу для map uploads в server.js:');
    console.log('     app.use("/uploads/map", express.static(path.join(__dirname, "uploads/map")));');
    console.log('');
    console.log('  6. Добавь компонент MapPage в frontend');
    console.log('═══════════════════════════════════════════════════════════');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();