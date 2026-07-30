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

const { sequelize, PriceComparison, PriceComparisonItem, CompetitorServiceMatch } = require('../models');

/**
 * Названия конкурентов должны значиться в самом сравнении.
 *
 * Страница сравнения строит колонки так: всё, чего нет в `competitors`,
 * она считает НАШИМ медцентром. Поэтому подставить цену мало — если не
 * дописать сюда название, колонка появится, но встанет как своя клиника,
 * и вся арифметика по ней поедет.
 */
async function ensureCompetitorColumns(comparisonId, labels) {
  if (!labels.size) return;

  const comparison = await PriceComparison.findByPk(comparisonId);
  if (!comparison) return;

  const known = new Set(comparison.competitors || []);
  const missing = [...labels].filter(label => !known.has(label));
  if (!missing.length) return;

  comparison.competitors = [...known, ...missing];
  comparison.changed('competitors', true);
  await comparison.save();
}

/**
 * Цены подтверждённых соответствий одного сравнения.
 *
 * У клиники цена зависит от филиала, и одна услуга даёт до десяти строк.
 * В сравнение идёт самая низкая по источнику — так же, как это делает
 * страница сравнения в самом парсере: иначе одна позиция превращается
 * в десяток, и сравнивать становится нечего.
 */
async function pricesForComparison(comparisonId) {
  const [rows] = await sequelize.query(
    `SELECT m.id            AS "matchId",
            m."itemId",
            src."competitorLabel",
            cs.name         AS "competitorServiceName",
            p.price,
            p."filialName",
            p."observedAt"
       FROM competitor_service_matches m
       JOIN price_comparison_items  it  ON it.id  = m."itemId"
       JOIN competitor_services     cs  ON cs.id  = m."competitorServiceId"
       JOIN competitor_sources      src ON src.id = cs."sourceId"
       JOIN competitor_prices       p   ON p."serviceId" = cs.id
      WHERE it."comparisonId" = :comparisonId
        AND m.status = 'confirmed'
        AND src."competitorLabel" IS NOT NULL
        AND p.price IS NOT NULL
      ORDER BY m."itemId", src."competitorLabel", p.price ASC`,
    { replacements: { comparisonId } }
  );

  // Первая строка в группе и есть самая дешёвая — за это отвечает ORDER BY
  const cheapest = new Map();
  for (const row of rows) {
    const key = `${row.itemId}|${row.competitorLabel}`;
    if (!cheapest.has(key)) cheapest.set(key, row);
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
  { actor = null, overwriteMatchIds = [], overwriteItemLabels = [] } = {}
) {
  const prices = await pricesForComparison(comparisonId);
  const forcedMatches = new Set(overwriteMatchIds);
  const forcedCells = new Set(overwriteItemLabels);

  const byItem = new Map();
  for (const row of prices) {
    if (!byItem.has(row.itemId)) byItem.set(row.itemId, []);
    byItem.get(row.itemId).push(row);
  }

  const summary = { items: 0, filled: 0, unchanged: 0, protectedByHuman: 0 };
  const now = new Date().toISOString();
  const usedLabels = new Set(prices.map(row => row.competitorLabel));

  for (const [itemId, rowsForItem] of byItem) {
    const item = await PriceComparisonItem.findByPk(itemId);
    if (!item) continue;

    const nextPrices = { ...(item.prices || {}) };
    const nextSources = { ...(item.priceSources || {}) };
    const nextHistory = { ...(item.priceHistory || {}) };
    let touched = false;

    for (const row of rowsForItem) {
      const label = row.competitorLabel;
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
        forcedCells.has(`${row.itemId}|${label}`);
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
        filialName: row.filialName || null,
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

  // После записи цен, а не до: если подставлять было нечего, лишние колонки
  // в сравнении не нужны
  await ensureCompetitorColumns(comparisonId, usedLabels);

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
 */
async function clearParserPrice(match) {
  const item = await PriceComparisonItem.findByPk(match.itemId);
  if (!item) return false;

  const sources = { ...(item.priceSources || {}) };
  const label = Object.keys(sources).find(
    key => sources[key]?.source === 'parser' && sources[key]?.matchId === match.id
  );
  if (!label) return false;

  const prices = { ...(item.prices || {}) };
  delete prices[label];
  delete sources[label];

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
