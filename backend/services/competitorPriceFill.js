'use strict';

/**
 * Подстановка цен конкурентов в сравнение цен.
 *
 * Берутся только подтверждённые человеком соответствия: предложенное автоматом
 * в сравнение не попадает никогда.
 *
 * Главное правило — парсер перезаписывает только то, что проставил сам.
 * В price_comparison_items.prices цены сотрудников и цены парсера лежат в одном
 * объекте, и без разделения ночной прогон молча затирал бы ручные правки.
 * Признак происхождения живёт в priceSources: помечено — наше, не помечено —
 * человеческое и неприкосновенное.
 */

const { sequelize, PriceComparisonItem, CompetitorServiceMatch } = require('../models');
const { readBindings, columnsForRow } = require('./comparisonBindings');

/**
 * Цены подтверждённых соответствий одного сравнения, разложенные по колонкам.
 *
 * Колонку выбирает привязка, а не совпадение названий: в каждой колонке
 * человек указал клинику и филиал, и цена идёт ровно туда. Схлопывать десять
 * адресов до минимальной цены по городу нельзя — это скрывает реальные
 * различия прайсов, поэтому колонка филиала получает только его цены.
 */
async function pricesForComparison(comparisonId) {
  const [[comparison]] = await sequelize.query(
    'SELECT competitors, "competitorBindings" FROM price_comparisons WHERE id = :comparisonId',
    { replacements: { comparisonId } }
  );
  const bySource = readBindings(comparison);
  const sourceIds = [...bySource.keys()];
  if (!sourceIds.length) return [];

  const [rows] = await sequelize.query(
    `SELECT m.id            AS "matchId",
            m."itemId",
            src."parserSourceId",
            cs.name         AS "competitorServiceName",
            p.price,
            p."filialId",
            p."filialName",
            loc.address,
            p."observedAt"
       FROM competitor_service_matches m
       JOIN price_comparison_items  it  ON it.id  = m."itemId"
       JOIN competitor_services     cs  ON cs.id  = m."competitorServiceId"
       JOIN competitor_sources      src ON src.id = cs."sourceId"
       JOIN competitor_prices       p   ON p."serviceId" = cs.id
       LEFT JOIN LATERAL (
         SELECT l.address
           FROM competitor_locations l
          WHERE l."sourceId" = src.id
            AND l."parserFilialId" = p."filialId"
          ORDER BY (l.origin = 'manual') DESC, l."updatedAt" DESC
          LIMIT 1
       ) loc ON true
      WHERE it."comparisonId" = :comparisonId
        AND m.status = 'confirmed'
        AND src."parserSourceId" IN (:sourceIds)
        AND p.price IS NOT NULL
      ORDER BY m."itemId", src."parserSourceId", p.price ASC`,
    { replacements: { comparisonId, sourceIds } }
  );

  // Одна цена может попасть в две колонки: филиальную и «вся клиника».
  // В колонке остаётся минимальная из подходящих ей — по филиалу, если
  // колонка филиальная, и по всей клинике, если колонка общая. ORDER BY
  // по цене уже поставил нужную строку первой.
  const cheapest = new Map();
  for (const row of rows) {
    for (const column of columnsForRow(bySource, row)) {
      const key = `${row.itemId}|${column}`;
      if (!cheapest.has(key)) cheapest.set(key, { ...row, column });
    }
  }
  return [...cheapest.values()];
}

/**
 * Разложить цены по позициям сравнения.
 *
 * Возвращает сводку, а не молчит: человеку важно видеть не только сколько
 * проставлено, но и сколько значений парсер не тронул, потому что там уже
 * стоит ручная цена.
 */
async function fillComparison(
  comparisonId,
  { actor = null, overwriteMatchIds = [], overwriteItemSources = [] } = {}
) {
  const prices = await pricesForComparison(comparisonId);
  const forcedMatches = new Set(overwriteMatchIds);
  // «Эту услугу у этой клиники человек только что разобрал руками» — какой
  // именно колонкой она обернётся, вызывающему знать не нужно
  const forcedCells = new Set(
    overwriteItemSources.map(({ itemId, parserSourceId }) => `${itemId}|${parserSourceId}`)
  );

  const byItem = new Map();
  for (const row of prices) {
    if (!byItem.has(row.itemId)) byItem.set(row.itemId, []);
    byItem.get(row.itemId).push(row);
  }

  const summary = { items: 0, filled: 0, unchanged: 0, protectedByHuman: 0 };
  const now = new Date().toISOString();
  for (const [itemId, rowsForItem] of byItem) {
    const item = await PriceComparisonItem.findByPk(itemId);
    if (!item) continue;

    const nextPrices = { ...(item.prices || {}) };
    const nextSources = { ...(item.priceSources || {}) };
    const nextHistory = { ...(item.priceHistory || {}) };
    let touched = false;

    for (const row of rowsForItem) {
      const label = row.column;
      const value = Number(row.price);
      const existing = nextPrices[label];
      const wasSetByParser = nextSources[label]?.source === 'parser';

      // Значение стоит, но его поставил не парсер — это ручная работа
      // сотрудника, и трогать её нельзя
      const hasHumanValue = existing !== undefined && existing !== null && existing !== '' && !wasSetByParser;
      // Автоматика ручную цену бережёт. Но если человек только что явно
      // подтвердил конкретное соответствие, его действие означает «брать цену
      // парсера» — блокировать именно эту замену было бы противоречием.
      const forcedByUser = forcedMatches.has(row.matchId) ||
        forcedCells.has(`${row.itemId}|${row.parserSourceId}`);
      if (hasHumanValue && !forcedByUser) {
        summary.protectedByHuman += 1;
        continue;
      }

      if (Number(existing) === value && wasSetByParser) {
        summary.unchanged += 1;
        continue;
      }

      nextPrices[label] = value;
      nextSources[label] = {
        source: 'parser',
        matchId: row.matchId,
        competitorServiceName: row.competitorServiceName,
        filialId: row.filialId ?? null,
        filialName: row.filialName || null,
        address: row.address || null,
        observedAt: row.observedAt || null,
        syncedAt: now
      };

      // История ведётся в том же виде, что и для правок сотрудников, — иначе
      // в интерфейсе сравнения появится запись без автора
      if (!nextHistory[label]) nextHistory[label] = [];
      nextHistory[label].push({
        price: value,
        userId: actor?.id || null,
        username: actor ? `Парсер (запустил ${actor.displayName || actor.username})` : 'Парсер',
        changedAt: now
      });

      touched = true;
      summary.filled += 1;
    }

    if (touched) {
      item.prices = nextPrices;
      item.priceSources = nextSources;
      item.priceHistory = nextHistory;
      // JSONB Sequelize сам изменённым не считает — помечаем явно,
      // иначе update молча ничего не сохранит
      item.changed('prices', true);
      item.changed('priceSources', true);
      item.changed('priceHistory', true);
      await item.save();
      summary.items += 1;
    }
  }

  return summary;
}

/**
 * Обновить цены во всех сравнениях, где есть принятые соответствия.
 *
 * Вызывается ночью следом за забором цен. Берёт только подтверждённое —
 * предложенное по-прежнему ждёт человека, — и не трогает ручные цены,
 * поэтому работать без присмотра ей можно.
 */
async function fillAllComparisons() {
  const [rows] = await sequelize.query(
    `SELECT DISTINCT it."comparisonId"
       FROM competitor_service_matches m
       JOIN price_comparison_items it ON it.id = m."itemId"
      WHERE m.status = 'confirmed'`
  );

  const totals = { comparisons: 0, filled: 0, protectedByHuman: 0 };
  for (const row of rows) {
    const summary = await fillComparison(row.comparisonId);
    totals.comparisons += 1;
    totals.filled += summary.filled;
    totals.protectedByHuman += summary.protectedByHuman;
  }
  return totals;
}

/**
 * Убрать из сравнения цену, проставленную парсером.
 *
 * Нужно при отказе от соответствия: человек снял связь — значит и цена,
 * приехавшая по ней, в сравнении больше не место. Ручные цены не трогаются.
 *
 * Колонок может оказаться несколько: рядом с колонкой филиала бывает колонка
 * «вся клиника», и одна цена стояла в обеих.
 */
async function clearParserPrice(match) {
  const item = await PriceComparisonItem.findByPk(match.itemId);
  if (!item) return false;

  const sources = { ...(item.priceSources || {}) };
  const labels = Object.keys(sources).filter(
    key => sources[key]?.source === 'parser' && sources[key]?.matchId === match.id
  );
  if (!labels.length) return false;

  const prices = { ...(item.prices || {}) };
  for (const label of labels) {
    delete prices[label];
    delete sources[label];
  }

  item.prices = prices;
  item.priceSources = sources;
  item.changed('prices', true);
  item.changed('priceSources', true);
  await item.save();
  return true;
}

/** Сколько соответствий ждут человека — для значка в интерфейсе. */
async function pendingCount(comparisonId) {
  return CompetitorServiceMatch.count({
    where: { status: 'suggested' },
    include: [{
      association: 'item',
      required: true,
      where: { comparisonId },
      attributes: []
    }]
  });
}

module.exports = {
  pricesForComparison,
  fillComparison,
  fillAllComparisons,
  clearParserPrice,
  pendingCount
};
