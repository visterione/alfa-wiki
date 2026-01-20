/**
 * Миграция для создания таблиц kanban_boards и board_permissions
 *
 * Запуск: node scripts/migrateKanbanBoards.js
 */

require('dotenv').config();
const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    // Читаем SQL файл миграции
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', 'create-kanban-boards.sql'),
      'utf8'
    );

    console.log('🔄 Running migration: create-kanban-boards.sql');
    await sequelize.query(migrationSQL);
    console.log('✅ Migration completed successfully');

    console.log('🔄 Checking tables...');
    const [boards] = await sequelize.query("SELECT COUNT(*) FROM kanban_boards");
    const [permissions] = await sequelize.query("SELECT COUNT(*) FROM board_permissions");
    const [tasks] = await sequelize.query("SELECT COUNT(*) FROM kanban_tasks");

    console.log(`✅ kanban_boards: ${boards[0].count} rows`);
    console.log(`✅ board_permissions: ${permissions[0].count} rows`);
    console.log(`✅ kanban_tasks: ${tasks[0].count} rows`);

    console.log('✅ All migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
