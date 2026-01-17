/**
 * Скрипт для добавления функционала архива и файлов для транспортных средств
 * 1. Добавляет поле isArchived в таблицу vehicles
 * 2. Создает таблицу vehicle_files для хранения файлов
 */

const { sequelize } = require('../models');

async function addVehicleArchivedAndFiles() {
  try {
    console.log('Начинаем миграцию для vehicles...\n');

    // 1. Добавляем столбец isArchived
    console.log('1. Добавление столбца isArchived в таблицу vehicles...');
    await sequelize.query(`
      ALTER TABLE vehicles
      ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false;
    `);
    console.log('✓ Столбец isArchived добавлен');

    // 2. Добавляем комментарий
    await sequelize.query(`
      COMMENT ON COLUMN vehicles."isArchived" IS 'Запись перенесена в архив';
    `);
    console.log('✓ Комментарий добавлен');

    // 3. Создаем индекс
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicles_is_archived ON vehicles("isArchived");
    `);
    console.log('✓ Индекс для isArchived создан\n');

    // 4. Создаем таблицу vehicle_files
    console.log('2. Создание таблицы vehicle_files...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS vehicle_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "vehicleId" UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
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
    console.log('✓ Таблица vehicle_files создана');

    // 5. Добавляем комментарии к таблице и колонкам
    await sequelize.query(`
      COMMENT ON TABLE vehicle_files IS 'Файлы, прикрепленные к записям о транспортных средствах';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN vehicle_files."vehicleId" IS 'ID транспортного средства, к которому прикреплен файл';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN vehicle_files.filename IS 'Имя файла на сервере';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN vehicle_files."originalName" IS 'Оригинальное имя файла';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN vehicle_files."mimeType" IS 'MIME тип файла';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN vehicle_files.size IS 'Размер файла в байтах';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN vehicle_files.path IS 'Путь к файлу на сервере';
    `);
    await sequelize.query(`
      COMMENT ON COLUMN vehicle_files."uploadedBy" IS 'ID пользователя, загрузившего файл';
    `);
    console.log('✓ Комментарии добавлены');

    // 6. Создаем индексы для vehicle_files
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicle_files_vehicle_id ON vehicle_files("vehicleId");
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicle_files_uploaded_by ON vehicle_files("uploadedBy");
    `);
    console.log('✓ Индексы для vehicle_files созданы\n');

    // 7. Проверяем результат
    console.log('3. Проверка результатов...');
    const [vehiclesColumn] = await sequelize.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'vehicles' AND column_name = 'isArchived';
    `);

    const [filesTable] = await sequelize.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'vehicle_files';
    `);

    if (vehiclesColumn.length > 0) {
      console.log('✓ Поле isArchived успешно добавлено:', vehiclesColumn[0]);
    } else {
      console.log('✗ Поле isArchived не найдено');
    }

    if (filesTable.length > 0) {
      console.log('✓ Таблица vehicle_files успешно создана');
    } else {
      console.log('✗ Таблица vehicle_files не найдена');
    }

    console.log('\n✓ Миграция успешно выполнена!');

  } catch (error) {
    console.error('Ошибка при выполнении миграции:', error);
    throw error;
  }
}

// Запускаем миграцию
addVehicleArchivedAndFiles()
  .then(() => {
    console.log('\nГотово!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nОшибка:', error);
    process.exit(1);
  });
