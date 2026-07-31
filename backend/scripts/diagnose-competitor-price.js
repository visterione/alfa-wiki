'use strict';

/**
 * Почему в сравнении цен пуста ячейка конкурента.
 *
 * Цена конкурента проходит через пять звеньев, и оборваться может любое:
 * привязка колонки к клинике → код 804н нашей позиции → соответствие →
 * цена в зеркале → сама колонка. По таблице сравнения видно только итог —
 * прочерк, одинаковый для всех случаев. Скрипт проходит цепочку по шагам
 * и показывает, на каком именно она рвётся.
 *
 * Запуск (из каталога backend):
 *   node scripts/diagnose-competitor-price.js "<часть названия или код 804н>"
 *   node scripts/diagnose-competitor-price.js A07.16.006
 *   node scripts/diagnose-competitor-price.js "уреазный" --sheet "Лаборатории 2026"
 *
 * Ничего не меняет — только читает.
 */

const { sequelize } = require('../models');
const matching = require('../services/competitorMatching');
const { readBindings } = require('../services/comparisonBindings');

const args = process.argv.slice(2);
const sheetFlag = args.indexOf('--sheet');
const sheetName = sheetFlag >= 0 ? args[sheetFlag + 1] : null;
// Индексы флага исключаем только когда он есть: при sheetFlag === -1
// проверка на sheetFlag + 1 выбросила бы нулевой аргумент, то есть сам запрос.
const needle = args
  .filter((a, i) => sheetFlag < 0 || (i !== sheetFlag && i !== sheetFlag + 1))
  .join(' ')
  .trim();

const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
const line = (char = '─') => console.log(char.repeat(78));

async function run() {
  if (!needle) {
    console.log('Укажите, что искать: node scripts/diagnose-competitor-price.js "A07.16.006"');
    return;
  }

  // ── 1. Наша позиция ──────────────────────────────────────────────────────
  const items = await q(
    `SELECT it.id, it."comparisonId", it."serviceCode", it."serviceName", it."misServiceId",
            it.prices, it."priceSources",
            pc.name AS sheet, pc."comparisonType", pc.competitors, pc."competitorBindings"
       FROM price_comparison_items it
       JOIN price_comparisons pc ON pc.id = it."comparisonId"
      WHERE (it."serviceCode" ILIKE :like OR it."serviceName" ILIKE :like)
        ${sheetName ? 'AND pc.name = :sheet' : ''}
      ORDER BY pc.name, it."sortOrder"
      LIMIT 20`,
    { like: `%${needle}%`, sheet: sheetName }
  );

  if (!items.length) {
    console.log(`Позиция «${needle}» не найдена ни в одном сравнении.`);
    return;
  }
  if (items.length > 1) {
    console.log(`Найдено позиций: ${items.length}. Разбираем каждую.`);
    if (!sheetName) console.log('Сузить можно так: --sheet "Название листа"\n');
  }

  // ── Клиники парсера, к которым вообще можно привязать колонку ────────────
  const sources = await q(
    `SELECT src.id, src."parserSourceId", src.name, src."displayName", src.city,
            src."syncedAt", src."syncStatus",
            count(cs.id) FILTER (WHERE cs."isActive") AS services
       FROM competitor_sources src
       LEFT JOIN competitor_services cs ON cs."sourceId" = src.id
      GROUP BY src.id
      ORDER BY src.name`
  );
  const sourceById = new Map(sources.map(s => [s.parserSourceId, s]));
  const sourceTitle = id => {
    const source = sourceById.get(id);
    if (!source) return `клиника #${id} (в зеркале её нет)`;
    return `${source.displayName || source.name}${source.city ? ` (${source.city})` : ''}`;
  };

  for (const item of items) {
    line('═');
    console.log(`ЛИСТ «${item.sheet}» (${item.comparisonType})`);
    // ID нужен, чтобы посмотреть в браузере, что реально приходит на страницу:
    // расхождение между базой и таблицей ищется именно так
    console.log(`         id: ${item.comparisonId}`);
    console.log(`ПОЗИЦИЯ  ${item.serviceName}`);
    console.log(`         артикул/код: ${item.serviceCode || '—'} · ID МИС: ${item.misServiceId || '—'}`);

    const code = await matching.code804For(item);
    console.log(`\n1. Код 804н нашей позиции: ${code || 'НЕТ'}`);
    if (!code) {
      console.log('   ⚠ Без кода сопоставление идёт только по названию (порог сходства ' +
        `${matching.NAME_THRESHOLD}). Проверьте, что в «${item.serviceCode || 'пусто'}» ` +
        'лежит код вида A07.16.006, а не артикул прайса.');
    }

    const columns = Array.isArray(item.competitors) ? item.competitors : [];
    const bySource = readBindings(item);
    // Колонка → клиника, чтобы не искать привязку заново на каждой строке
    const sourceOfColumn = new Map();
    for (const [parserSourceId, targets] of bySource) {
      for (const target of targets) sourceOfColumn.set(target.column, { parserSourceId, ...target });
    }

    console.log(`\n2. Колонки конкурентов в листе (${columns.length}):`);
    columns.forEach(col => {
      const bound = sourceOfColumn.get(col);
      console.log(`   • ${col}` + (bound
        ? ` → ${sourceTitle(bound.parserSourceId)}${bound.filialId == null ? ', вся клиника' : `, филиал ${bound.filialId}`}`
        : ' → не привязана к парсеру'));
    });
    if (!columns.length) {
      console.log('   ⚠ Ни одной. Добавьте конкурента на странице сравнения цен — ' +
        'без колонки подставлять цену некуда.');
      continue;
    }

    // ── 3. Какие клиники вообще участвуют ─────────────────────────────────
    const sourceIds = [...bySource.keys()];
    console.log(`\n3. Клиники, попавшие в подбор по этим колонкам (${sourceIds.length}):`);
    sourceIds.forEach(id => console.log(`   ✓ ${sourceTitle(id)}`));

    const orphanColumns = columns.filter(col => !sourceOfColumn.has(col));
    if (orphanColumns.length) {
      console.log('\n   ⚠ Колонки без привязки к клинике парсера:');
      orphanColumns.forEach(col => console.log(`     ✗ ${col}`));
      console.log('     Цены в них не появятся: колонку нужно завести заново на странице');
      console.log('     сравнения — «Управление колонками» → «+ Конкурент» → выбрать клинику.');
      console.log('     (Своими медцентрами это не касается: они колонками конкурентов не значатся.)');
    }

    // ── 4. Что нашлось бы в каталогах конкурентов ─────────────────────────
    if (sourceIds.length) {
      const candidates = await matching.findCandidates(item, { sourceIds });
      console.log(`\n4. Кандидаты в каталогах конкурентов (${candidates.length}):`);
      if (!candidates.length) {
        console.log('   ⚠ Ни одного. Либо у конкурента нет услуги с этим кодом 804н,');
        console.log('     либо в его каталоге код не проставлен — посмотрите админку парсера,');
        console.log('     колонка «Услуг» → каталог, там видно код каждой услуги.');
      }
      candidates.forEach(c => console.log(
        `   • [${sourceTitle(c.parserSourceId)}] ${c.name}\n` +
        `     ${c.method === 'code804' ? 'по коду 804н' : `по названию, сходство ${Number(c.score).toFixed(2)}`}` +
        ` · принялось бы автоматически: ${matching.canAutoConfirm(item, c) ? 'да' : 'НЕТ, нужно решение человека'}`
      ));
    }

    // ── 5. Что уже записано в соответствиях ───────────────────────────────
    const matches = await q(
      `SELECT m.status, m.method, m.score, m."confirmedAt",
              cs.name AS competitor_service, cs.codes, cs."isActive",
              src."parserSourceId",
              u."displayName" AS decided_by,
              (SELECT count(*) FROM competitor_prices p WHERE p."serviceId" = cs.id) AS prices
         FROM competitor_service_matches m
         JOIN competitor_services cs ON cs.id = m."competitorServiceId"
         JOIN competitor_sources  src ON src.id = cs."sourceId"
         LEFT JOIN users u ON u.id = m."confirmedBy"
        WHERE m."itemId" = :itemId
        ORDER BY src."parserSourceId"`,
      { itemId: item.id }
    );

    console.log(`\n5. Соответствия, записанные для этой позиции (${matches.length}):`);
    if (!matches.length) {
      console.log('   ⚠ Ни одного. Автоподбор по этой позиции не отрабатывал.');
      console.log('     Запустите «Сопоставить автоматически» в админке парсера,');
      console.log('     вкладка «Сопоставление», выбрав этот лист.');
    }
    for (const m of matches) {
      const mark = m.status === 'confirmed' ? '✓' : m.status === 'rejected' ? '✗' : '?';
      console.log(`   ${mark} [${sourceTitle(m.parserSourceId)}] ${m.status} · ${m.competitor_service}`);
      console.log(`     коды: ${JSON.stringify(m.codes)} · цен в зеркале: ${m.prices}` +
        `${m.isActive ? '' : ' · УСЛУГА ПОГАШЕНА (пропала из прайса)'}`);
      if (m.status === 'rejected') {
        console.log(`     ⚠ Отклонено${m.decided_by ? ` (${m.decided_by})` : ''}. Отклонённое ` +
          'автоподбор больше не трогает и в админке не показывает —');
        console.log('       цены по нему не будет, пока строку не удалить из competitor_service_matches.');
      }
      if (m.status === 'suggested') {
        console.log('     ⚠ Ждёт решения человека: примите его во вкладке «Сопоставление».');
      }
      if (m.status === 'confirmed' && Number(m.prices) === 0) {
        console.log('     ⚠ Соответствие принято, но цен у услуги в зеркале нет — заберите цены.');
      }
      // Самый незаметный случай: связь и цены на месте, а колонки под них нет.
      // В таблице сравнения такая клиника просто отсутствует, и понять, что
      // цена уже посчитана и ждёт колонки, по интерфейсу невозможно.
      if (m.status === 'confirmed' && Number(m.prices) > 0 && !bySource.has(m.parserSourceId)) {
        console.log(`     ⚠ Колонки клиники «${sourceTitle(m.parserSourceId)}» в этом листе НЕТ — цену класть некуда.`);
        console.log('       Добавьте конкурента на странице сравнения цен: «Управление колонками» → «+ Конкурент».');
      }
    }

    // ── 6. Что в итоге лежит в самой строке ───────────────────────────────
    const prices = item.prices || {};
    const sourcesMap = item.priceSources || {};
    console.log('\n6. Значения в строке сравнения:');
    const keys = Object.keys(prices);
    if (!keys.length) console.log('   (пусто)');
    keys.forEach(k => console.log(
      `   • «${k}» = ${prices[k]}` +
      ` (${sourcesMap[k]?.source === 'parser' ? 'парсер' : 'внесено человеком'})`
    ));

    const confirmedSources = new Set(
      matches.filter(m => m.status === 'confirmed').map(m => m.parserSourceId)
    );
    const missing = columns.filter(col => prices[col] === undefined || prices[col] === null || prices[col] === '');
    if (missing.length) {
      console.log('\n   Пустые колонки конкурентов:');
      missing.forEach(col => {
        const bound = sourceOfColumn.get(col);
        let why;
        if (!bound) why = 'колонка не привязана к клинике парсера (см. п.2)';
        else if (!confirmedSources.has(bound.parserSourceId)) {
          const rejected = matches.some(m => m.parserSourceId === bound.parserSourceId && m.status === 'rejected');
          const pending = matches.some(m => m.parserSourceId === bound.parserSourceId && m.status === 'suggested');
          why = rejected ? 'соответствие отклонено (см. п.5)'
            : pending ? 'соответствие ждёт решения (см. п.5)'
              : 'принятого соответствия нет — автоподбор не нашёл или не запускался';
        } else if (bound.filialId != null) {
          why = `соответствие принято, но цены филиала ${bound.filialId} у этой услуги нет`;
        } else why = 'соответствие принято, но цена не разложилась — проверьте п.5/6';
        console.log(`     ✗ ${col} → ${why}`);
      });
    }
  }
  line('═');
}

run()
  .catch(err => { console.error('Ошибка:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
