#!/usr/bin/env node
'use strict';

/**
 * Миграция привязки колонок сравнения к клиникам парсера (ver. 6.34).
 *
 * Добавляет price_comparisons."competitorBindings" и раскладывает по нему то,
 * что раньше держалось на совпадении строк с competitor_sources."competitorLabel".
 *
 * Восстановление обратное генерации: подпись филиальной колонки когда-то
 * собиралась как «<название в сравнениях> — <филиал>», поэтому здесь тем же
 * алгоритмом строятся все возможные подписи каждого источника, и колонки
 * листов сопоставляются с ними по точному совпадению. Что не сошлось —
 * выводится списком: такие колонки останутся ручными, и цены в них
 * подставляться не будут, пока человек не заведёт их заново.
 *
 * Запуск на сервере:
 *   cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/backend
 *   node scripts/migrateCompetitorBindings.js
 *
 * Идемпотентный: уже проставленные привязки не трогает.
 *
 * Флаги:
 *   --check   только показать, что получится, ничего не менять
 */

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', 'ver. 6.34 competitor-bindings.sql');

sequelize.options.logging = false;

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = :table AND column_name = :column`,
    { replacements: { table, column } }
  );
  return rows.length > 0;
}

/**
 * Все подписи колонок, которые могли получиться у источников.
 *
 * Возвращает Map<подпись, { parserSourceId, filialId, ambiguous }>.
 * `ambiguous` — у двух филиалов одно название, и по подписи без номера
 * понять, какой из них имелся в виду, уже нельзя.
 */
async function columnLabelIndex() {
  const [sources] = await sequelize.query(
    `SELECT id, "parserSourceId", "competitorLabel"
       FROM competitor_sources
      WHERE "competitorLabel" IS NOT NULL AND "competitorLabel" <> ''`
  );

  // Тот же запрос, которым страница сравнения получает список филиалов:
  // подписи должны совпасть с теми, что она когда-то и предложила
  const [filials] = await sequelize.query(
    `SELECT DISTINCT ON (cs."sourceId", p."filialId")
            cs."sourceId", p."filialId", p."filialName",
            loc.name AS "locationName", loc.address
       FROM competitor_services cs
       JOIN competitor_prices p ON p."serviceId" = cs.id
       LEFT JOIN LATERAL (
         SELECT l.name, l.address
           FROM competitor_locations l
          WHERE l."sourceId" = cs."sourceId"
            AND l."parserFilialId" = p."filialId"
          ORDER BY (l.origin = 'manual') DESC, l."updatedAt" DESC
          LIMIT 1
       ) loc ON true
      WHERE p."filialId" IS NOT NULL OR p."filialName" IS NOT NULL
      ORDER BY cs."sourceId", p."filialId", p."filialName"`
  );

  const filialsBySource = new Map();
  for (const row of filials) {
    if (!filialsBySource.has(row.sourceId)) filialsBySource.set(row.sourceId, []);
    filialsBySource.get(row.sourceId).push(row);
  }

  const index = new Map();
  const add = (label, binding) => {
    if (index.has(label)) index.get(label).conflict = true;
    else index.set(label, binding);
  };

  for (const source of sources) {
    const label = source.competitorLabel;
    // Колонка ровно с подписью источника означала «вся клиника»
    add(label, { parserSourceId: source.parserSourceId, filialId: null });

    const own = filialsBySource.get(source.id) || [];
    const counts = new Map();
    for (const filial of own) {
      const name = filial.filialName || filial.locationName || filial.address || `Филиал ${filial.filialId}`;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    for (const filial of own) {
      const name = filial.filialName || filial.locationName || filial.address || `Филиал ${filial.filialId}`;
      const duplicated = counts.get(name) > 1;
      const binding = { parserSourceId: source.parserSourceId, filialId: filial.filialId };
      add(`${label} — ${name}${duplicated ? ` №${filial.filialId}` : ''}`, binding);
      // Подпись без номера могла остаться с тех пор, когда второй одноимённый
      // филиал ещё не попадал в лист. Кого из двух имели в виду — неизвестно.
      if (duplicated) add(`${label} — ${name}`, { ...binding, ambiguous: true });
    }
  }
  return index;
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('');
  console.log('▶ Миграция ver. 6.34 — привязка колонок сравнения к клиникам парсера');
  console.log('');

  await sequelize.authenticate();
  const { database, host } = sequelize.config;
  console.log(`   База: ${database} на ${host}`);
  console.log('');

  if (!(await columnExists('price_comparisons', 'competitorBindings'))) {
    if (checkOnly) {
      console.log('⚠️  Колонки "competitorBindings" ещё нет — запустите без --check');
      console.log('');
      return;
    }
    if (!fs.existsSync(MIGRATION_FILE)) throw new Error(`не найден файл миграции: ${MIGRATION_FILE}`);
    console.log('   Добавляю price_comparisons."competitorBindings"...');
    await sequelize.query(fs.readFileSync(MIGRATION_FILE, 'utf8'));
  } else {
    console.log('   Колонка "competitorBindings" уже есть');
  }

  if (!(await columnExists('competitor_sources', 'competitorLabel'))) {
    console.log('');
    console.log('   Старой подписи "competitorLabel" в базе нет — раскладывать нечего.');
    console.log('');
    return;
  }

  const index = await columnLabelIndex();
  console.log(`   Подписей, которые могли породить источники: ${index.size}`);
  console.log('');

  const [comparisons] = await sequelize.query(
    `SELECT id, name, competitors, "competitorBindings"
       FROM price_comparisons
      WHERE jsonb_array_length(COALESCE(competitors, '[]'::jsonb)) > 0
      ORDER BY name`
  );

  let bound = 0;
  const orphans = [];
  const ambiguous = [];

  for (const comparison of comparisons) {
    const columns = Array.isArray(comparison.competitors) ? comparison.competitors : [];
    const bindings = { ...(comparison.competitorBindings || {}) };
    let changed = false;

    for (const column of columns) {
      if (bindings[column]) continue;              // уже привязано — не трогаем
      const found = index.get(column);
      if (!found) continue;                        // своя клиника или ручная колонка
      if (found.ambiguous || found.conflict) {
        ambiguous.push(`${comparison.name} → ${column}`);
        continue;
      }
      bindings[column] = { parserSourceId: found.parserSourceId, filialId: found.filialId };
      changed = true;
      bound += 1;
    }

    // Колонка, похожая на клинику парсера, но ни с чем не сошедшаяся
    for (const column of columns) {
      if (bindings[column]) continue;
      if ([...index.keys()].some(label => column.startsWith(`${label} — `))) {
        orphans.push(`${comparison.name} → ${column}`);
      }
    }

    if (changed && !checkOnly) {
      await sequelize.query(
        'UPDATE price_comparisons SET "competitorBindings" = :bindings WHERE id = :id',
        { replacements: { bindings: JSON.stringify(bindings), id: comparison.id } }
      );
    }
  }

  console.log(`   Листов просмотрено: ${comparisons.length}`);
  console.log(`   Колонок привязано: ${bound}${checkOnly ? ' (не сохранено, --check)' : ''}`);

  if (ambiguous.length) {
    console.log('');
    console.log('   ⚠ Не привязаны — подпись подходит сразу нескольким филиалам:');
    ambiguous.forEach(row => console.log(`     • ${row}`));
  }
  if (orphans.length) {
    console.log('');
    console.log('   ⚠ Не привязаны — подписи такого филиала в прайсе больше нет:');
    orphans.forEach(row => console.log(`     • ${row}`));
  }
  if (ambiguous.length || orphans.length) {
    console.log('');
    console.log('   Цены в эти колонки подставляться не будут. Уже введённые значения');
    console.log('   на месте: колонку нужно удалить и добавить заново на странице');
    console.log('   сравнения — тогда она привяжется к нужному филиалу.');
  }

  console.log('');
  console.log(checkOnly ? '✅ Проверка завершена' : '✅ Готово');
  console.log('');
}

main()
  .then(() => sequelize.close())
  .catch(async err => {
    console.error('');
    console.error('❌ Миграция не выполнена:', err.message);
    console.error('');
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
