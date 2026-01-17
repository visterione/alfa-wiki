const { sequelize } = require('../models');
require('dotenv').config();

async function migrateAccreditationFiles() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Creating accreditation_files table...');

    // Создаем таблицу для файлов аккредитаций
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS accreditation_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "accreditationId" UUID NOT NULL REFERENCES accreditations(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        "originalName" VARCHAR(255) NOT NULL,
        "mimeType" VARCHAR(100),
        size INTEGER,
        path VARCHAR(1000) NOT NULL,
        "uploadedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    console.log('✅ Table created successfully');

    console.log('🔄 Creating indexes...');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_accreditation_files_accreditation_id
        ON accreditation_files("accreditationId");
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_accreditation_files_uploaded_by
        ON accreditation_files("uploadedBy");
    `);

    console.log('✅ Indexes created successfully');

    console.log('🔄 Adding comments...');

    await sequelize.query(`
      COMMENT ON TABLE accreditation_files IS 'Файлы, прикрепленные к аккредитациям';
    `);

    await sequelize.query(`
      COMMENT ON COLUMN accreditation_files.id IS 'Уникальный идентификатор файла';
    `);

    await sequelize.query(`
      COMMENT ON COLUMN accreditation_files."accreditationId" IS 'ID аккредитации, к которой прикреплен файл';
    `);

    await sequelize.query(`
      COMMENT ON COLUMN accreditation_files.filename IS 'Имя файла на сервере';
    `);

    await sequelize.query(`
      COMMENT ON COLUMN accreditation_files."originalName" IS 'Оригинальное имя файла';
    `);

    await sequelize.query(`
      COMMENT ON COLUMN accreditation_files."mimeType" IS 'MIME тип файла';
    `);

    await sequelize.query(`
      COMMENT ON COLUMN accreditation_files.size IS 'Размер файла в байтах';
    `);

    await sequelize.query(`
      COMMENT ON COLUMN accreditation_files.path IS 'Путь к файлу на сервере';
    `);

    await sequelize.query(`
      COMMENT ON COLUMN accreditation_files."uploadedBy" IS 'ID пользователя, загрузившего файл';
    `);

    console.log('✅ Comments added successfully');

    console.log('');
    console.log('🎉 Migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart your backend server');
    console.log('2. Open the accreditations page');
    console.log('3. Click the "Files" button to test file upload');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateAccreditationFiles();
