#!/usr/bin/env node
'use strict';

/**
 * Зачистка тестовых данных складского модуля ver. 7.13.
 *
 * Из backend/ на production:
 *   npm run warehouse:reset:check   # показать, что уйдёт и что останется
 *   npm run warehouse:reset -- --yes
 *
 * Флаг --yes обязателен и намеренно не имеет короткой формы. Это единственный
 * скрипт репозитория, который удаляет данные пачкой, и запустить его случайно,
 * промахнувшись по строке в истории команд, не должно получаться.
 *
 * Топология — корпуса, этажи с контурами, кабинеты с полигонами планов, места
 * хранения, отделения — не трогается. Полный список того, что остаётся, и
 * причины см. в migrations/«ver. 7.13 warehouse-reset-testdata.sql».
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

sequelize.options.logging = false;

const FILE = path.join(__dirname, '..', 'migrations', 'ver. 7.13 warehouse-reset-testdata.sql');
const LOCK_ID = 713002;

// Порядок — от самого заметного к служебному: человек читает этот список перед
// тем, как согласиться, и первым должен видеть то, чего жальче всего.
const WIPE = [
  ['warehouse_assets',              'карточки оборудования'],
  ['warehouse_nomenclature',        'номенклатура'],
  ['warehouse_stock',               'остатки на местах хранения'],
  ['warehouse_movements',           'движения'],
  ['warehouse_documents',           'документы'],
  ['warehouse_batches',             'партии'],
  ['warehouse_inventory_sessions',  'инвентаризации'],
  ['warehouse_inventory_items',     'строки инвентаризаций'],
  ['warehouse_maintenance_orders',  'заявки на ТО'],
  ['warehouse_repairs',             'ремонты'],
  ['warehouse_rfq',                 'запросы поставщикам'],
  ['warehouse_reorder_rules',       'точки заказа'],
  ['warehouse_consumption_norms',   'нормы расхода'],
  ['warehouse_osv_imports',         'снимки ведомости 1С'],
  ['warehouse_osv_lines',           'строки ведомости'],
  ['warehouse_osv_mappings',        'разметка веток ведомости'],
  ['warehouse_osv_placements',      'размещения строк по кабинетам'],
  ['warehouse_saved_reports',       'сохранённые отчёты'],
  ['warehouse_utilization_daily',   'суточная утилизация кабинетов'],
  ['warehouse_asset_files',         'файлы карточек'],
  ['warehouse_mail_log',            'лог рассылок'],
  ['warehouse_outbox',              'очередь обмена с 1С'],
  ['warehouse_doc_counters',        'счётчики номеров документов'],
  ['warehouse_inventory_counters',  'счётчики инвентарных номеров'],
];

const KEEP = [
  ['warehouse_buildings',        'корпуса'],
  ['warehouse_floors',           'этажи с габаритами и контуром плана'],
  ['warehouse_floor_shapes',     'отрисованные стены и помещения'],
  ['warehouse_rooms',            'кабинеты вместе с полигонами на плане'],
  ['warehouse_storages',         'места хранения'],
  ['warehouse_departments',      'отделения'],
  ['warehouse_specialties',      'специальности'],
  ['warehouse_categories',       'категории'],
  ['warehouse_item_rules',       'словарь предметов'],
  ['warehouse_contractors',      'контрагенты'],
  ['warehouse_user_permissions', 'доступы к модулю'],
];

async function counts(connection, list) {
  const sql = list
    .map(([table], i) => `SELECT ${i} AS n, (SELECT count(*) FROM ${table}) AS c`)
    .join(' UNION ALL ');
  const result = await connection.query(sql);
  const rows = new Map(result.rows.map(r => [Number(r.n), Number(r.c)]));
  return list.map(([table, label], i) => ({ table, label, count: rows.get(i) || 0 }));
}

function print(title, rows) {
  console.log(`\n   ${title}`);
  for (const row of rows) {
    const num = String(row.count).padStart(7);
    console.log(`   ${num}  ${row.label}${row.count ? '' : '  —'}`);
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const confirmed = process.argv.includes('--yes');
  let connection;
  let locked = false;

  try {
    if (!fs.existsSync(FILE)) throw new Error(`не найден файл миграции: ${FILE}`);
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();

    console.log('\n▶ Зачистка тестовых данных склада ver. 7.13');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

    const wipe = await counts(connection, WIPE);
    const keep = await counts(connection, KEEP);
    print('Будет удалено:', wipe);
    print('Останется нетронутым:', keep);

    const total = wipe.reduce((sum, row) => sum + row.count, 0);
    if (checkOnly) {
      console.log(`\n   Всего под удаление: ${total} записей`);
      console.log('   Запуск: npm run warehouse:reset -- --yes\n');
      return;
    }
    if (!confirmed) {
      console.log(`\n⚠️  Всего под удаление: ${total} записей.`);
      console.log('   Запуск без подтверждения отменён. Повторите с флагом --yes:');
      console.log('   npm run warehouse:reset -- --yes\n');
      process.exitCode = 2;
      return;
    }
    if (!total) {
      console.log('\n✅ Удалять нечего — складские операции уже пусты\n');
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    console.log(`\n   Применяю ${path.basename(FILE)}...`);
    // Файл держит собственную транзакцию: он рассчитан и на прямой запуск
    // через psql, поэтому здесь его не оборачиваем второй раз.
    await connection.query(fs.readFileSync(FILE, 'utf8'));

    const after = await counts(connection, WIPE);
    const left = after.reduce((sum, row) => sum + row.count, 0);
    if (left) throw new Error(`после зачистки осталось ${left} записей`);

    console.log('\n✅ Складские операции зачищены, топология на месте');
    console.log('   Дальше: залить словарь (npm run migrate:7.13), загрузить ведомость,');
    console.log('   разметить ветки по кабинетам и запустить разбор\n');
  } finally {
    if (connection && locked) {
      await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    }
    if (connection) {
      try { await sequelize.connectionManager.releaseConnection(connection); } catch (_) {}
    }
    await sequelize.close().catch(() => {});
  }
}

main().catch(error => {
  const message = error?.original?.message || error?.parent?.message || error?.message
    || error?.original?.code || error?.name || String(error);
  console.error(`\n❌ Зачистка не выполнена: ${message}\n`);
  process.exitCode = 1;
});
