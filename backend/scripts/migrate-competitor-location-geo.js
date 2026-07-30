'use strict';

/**
 * ver. 6.28 — Координаты точек конкурентов и ручная привязка к филиалу прайса.
 *
 * Добавляет в competitor_locations: lat, lon, geoOrigin, geocodedAt,
 * filialIdManual. Нужно для карты клиник с ценовыми диапазонами: без
 * координат точку не нарисовать, без филиала — не показать её цену.
 *
 * Запуск из каталога backend:
 *   node scripts/migrate-competitor-location-geo.js
 *
 * Повторный запуск безопасен: колонки добавляются только если их ещё нет,
 * данные не трогаются.
 */

const { sequelize } = require('../models');

const COLUMNS = [
  ['lat', 'NUMERIC(9, 6)'],
  ['lon', 'NUMERIC(9, 6)'],
  ['geoOrigin', 'VARCHAR(16)'],
  ['geocodedAt', 'TIMESTAMP WITH TIME ZONE'],
  ['filialIdManual', 'INTEGER']
];

async function run() {
  console.log('🔄 Подключаюсь к базе...');
  await sequelize.authenticate();
  console.log('✅ Подключение есть');

  const [existing] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'competitor_locations'`
  );
  const have = new Set(existing.map(row => row.column_name));

  let added = 0;
  for (const [name, type] of COLUMNS) {
    if (have.has(name)) {
      console.log(`   • "${name}" уже есть — пропускаю`);
      continue;
    }
    await sequelize.query(
      `ALTER TABLE competitor_locations ADD COLUMN IF NOT EXISTS "${name}" ${type}`
    );
    console.log(`   ✅ "${name}" добавлена`);
    added += 1;
  }

  await sequelize.query(`
    COMMENT ON COLUMN competitor_locations."geoOrigin" IS
      'nominatim | manual — выправленное мышью автопрогон не трогает'
  `);
  await sequelize.query(`
    COMMENT ON COLUMN competitor_locations."filialIdManual" IS
      'Филиал прайса, указанный человеком; перекрывает parserFilialId'
  `);

  // Карта запрашивает точки по прямоугольнику видимой области
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS competitor_locations_geo_idx
      ON competitor_locations (lat, lon)
      WHERE lat IS NOT NULL
  `);

  const [[stats]] = await sequelize.query(`
    SELECT count(*) AS total,
           count(lat) AS with_coords,
           count("parserFilialId") AS linked_by_parser
      FROM competitor_locations
  `);

  console.log(added ? `\n✅ Колонок добавлено: ${added}` : '\nℹ️  Все колонки уже были на месте');
  console.log(`   Точек в зеркале: ${stats.total}`);
  console.log(`   С координатами: ${stats.with_coords} — остальные ждут геокодирования`);
  console.log(`   Связано с филиалом прайса: ${stats.linked_by_parser}`);
}

run()
  .then(() => console.log('🎉 Готово. Перезапустите бэкенд, чтобы модель увидела новые поля.'))
  .catch(err => {
    console.error('❌ Миграция не прошла:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
