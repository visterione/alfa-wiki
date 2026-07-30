'use strict';

/**
 * Автосопоставление услуг конкурентов с нашими позициями в сравнении цен.
 *
 * Задача не транспортная, а смысловая: «Общий анализ крови» у конкурента
 * и наша позиция в МИС — разные строки, и связать их нужно до того, как
 * цена попадёт в сравнение.
 *
 * Два способа, и доверие к ним разное:
 *
 *   1. По коду 804н — точно. Код у нас лежит в partner_service_cache.subCode
 *      и достаётся через misServiceId позиции сравнения. Работает только для
 *      лабораторных услуг: по стоматологии и приёмам кодов нет вовсе.
 *   2. По названию — похоже, но не точно. Триграммы (pg_trgm) справляются
 *      с русской морфологией без словаря: «приём стоматолога» и «прием
 *      врача-стоматолога» имеют общие триграммы, хотя ни одно слово
 *      не совпадает целиком.
 *
 * Поэтому подбор ничего не решает сам: он создаёт соответствия со статусом
 * `suggested`, а принимает их человек. «Автоматом» здесь означает
 * «автопредложение», и иначе быть не могло — по названиям всегда найдётся
 * пара вроде «Приём первичный» против «Приём повторный».
 */

const { sequelize, CompetitorServiceMatch } = require('../models');

// Ниже этого сходства названий предлагать нечего: на реальных прайсах всё,
// что слабее, — совпадения по общим словам вроде «приём» и «врача»
const NAME_THRESHOLD = 0.45;

// Сколько кандидатов берём из каждой клиники до выбора лучшего.
const CANDIDATES_PER_ITEM = 5;

// findCandidates уже отбрасывает всё слабее NAME_THRESHOLD и оставляет один
// лучший вариант на клинику. Этот лучший вариант используем автоматически:
// иначе «автоматизация» снова превращается в сотни кликов. Отдельно ниже
// отсекаются смысловые конфликты, которые одной похожестью названий не видны.
const AUTO_NAME_THRESHOLD = NAME_THRESHOLD;

/**
 * Название под сравнение: регистр, ё и пунктуация не должны мешать.
 *
 * ВАЖНО: то же самое повторено в SQL — миграция ver. 6.17 и заполнение
 * nameNormalized при синхронизации. Менять нужно в обоих местах, иначе
 * поиск начнёт промахиваться на ровном месте.
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

/**
 * Устойчивая идентичность нашей услуги между разными листами сравнения.
 *
 * Строки price_comparison_items принадлежат листу, поэтому их UUID различаются.
 * Сама услуга при этом та же: сначала узнаём её по ID МИС, затем по артикулу,
 * и только для рукописных строк — по полностью нормализованному названию.
 */
function ownServiceKey(item) {
  const misId = String(item?.misServiceId || '').trim();
  if (misId) return `mis:${misId}`;

  const code = String(item?.serviceCode || '').trim().toLowerCase();
  if (code) return `code:${code}`;

  const name = normalizeName(item?.serviceName);
  return name ? `name:${name}` : null;
}

// Код 804н: буква A или B, дальше группы цифр через точку (A09.05.118.011).
// Строгая проверка нужна, чтобы не принять за код обычный артикул.
const CODE_804N = /^[AB]\d{2}(\.\d{2,3}){2,}$/;

// Кириллические буквы, неотличимые от латинских на вид. В прайсах и выгрузках
// они встречаются вперемешку: у нас первая буква кода бывает и латинской «A»
// (U+0041), и кириллической «А» (U+0410), а у конкурентов — только латинская.
// Без приведения к одному алфавиту половина кодов не совпала бы никогда.
const LOOKALIKE = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y' };

/** Код к единому виду; не похоже на 804н — значит кода нет. */
function normalizeCode(code) {
  const raw = String(code || '').trim().toUpperCase();
  if (!raw) return null;

  const latin = raw.replace(/[А-Я]/g, ch => LOOKALIKE[ch] || ch);
  return CODE_804N.test(latin) ? latin : null;
}

/**
 * Код 804н нашей позиции.
 *
 * Два источника, и первый важнее. В модели serviceCode описан как артикул,
 * но на реальных данных там как раз и лежит код 804н — таких позиций впятеро
 * больше, чем тех, до чьего кода удаётся добраться через МИС. Поэтому сначала
 * смотрим прямо в поле, и только если там не код — идём в кэш услуг МИС
 * через misServiceId.
 *
 * Позиции, заведённые руками и без кода, останутся без него: их сопоставит
 * только поиск по названию.
 */
async function code804For(item, transaction = null) {
  const own = normalizeCode(item.serviceCode);
  if (own) return own;

  const misId = Number(item.misServiceId);
  if (!Number.isFinite(misId)) return null;

  const [rows] = await sequelize.query(
    `SELECT "subCode" FROM partner_service_cache
      WHERE "serviceId" = :serviceId AND "subCode" IS NOT NULL AND "subCode" <> ''
      LIMIT 1`,
    { replacements: { serviceId: misId }, transaction }
  );
  return normalizeCode(rows[0]?.subCode);
}

/**
 * Кандидаты из каталогов конкурентов для одной нашей позиции.
 *
 * Ищем только среди источников, у которых проставлено, как они называются
 * в сравнениях: без этого непонятно, в какую колонку класть цену, и такой
 * кандидат бесполезен.
 */
async function findCandidates(item, { labels = null } = {}) {
  const code = await code804For(item);
  const normalized = normalizeName(item.serviceName);
  const found = new Map();

  // 1. По коду 804н — точное попадание, ему верим без оговорок
  if (code) {
    const [rows] = await sequelize.query(
      `SELECT cs.id, cs.name, cs."nameNormalized", cs.category, cs.codes,
              src."competitorLabel", src.name AS "sourceName", src.city
         FROM competitor_services cs
         JOIN competitor_sources  src ON src.id = cs."sourceId"
        WHERE cs."isActive"
          AND src."competitorLabel" IS NOT NULL
          AND cs.codes @> :code::jsonb
          ${labels ? 'AND src."competitorLabel" IN (:labels)' : ''}
        LIMIT 50`,
      { replacements: { code: JSON.stringify([code]), labels } }
    );
    for (const row of rows) {
      found.set(row.id, { ...row, method: 'code804', score: 1 });
    }
  }

  // 2. По названию — добираем то, чего не дал код
  if (normalized) {
    const [rows] = await sequelize.query(
      `SELECT id, name, "nameNormalized", category, codes,
              "competitorLabel", "sourceName", city, score
         FROM (
           SELECT cs.id, cs.name, cs."nameNormalized", cs.category, cs.codes,
                  src."competitorLabel", src.name AS "sourceName", src.city,
                  similarity(cs."nameNormalized", :name) AS score,
                  row_number() OVER (
                    PARTITION BY src.id
                    ORDER BY similarity(cs."nameNormalized", :name) DESC
                  ) AS source_rank
             FROM competitor_services cs
             JOIN competitor_sources src ON src.id = cs."sourceId"
            WHERE cs."isActive"
              AND src."competitorLabel" IS NOT NULL
              AND cs."nameNormalized" % :name
              ${labels ? 'AND src."competitorLabel" IN (:labels)' : ''}
         ) ranked
        WHERE source_rank <= :perSource
        ORDER BY score DESC`,
      { replacements: { name: normalized, labels, perSource: CANDIDATES_PER_ITEM } }
    );
    for (const row of rows) {
      if (found.has(row.id)) continue;
      if (Number(row.score) < NAME_THRESHOLD) continue;
      found.set(row.id, { ...row, method: 'name', score: Number(row.score) });
    }
  }

  // По одному лучшему кандидату на конкурента: показывать человеку пять
  // позиций одной клиники бессмысленно, выбирать он будет всё равно из них
  const best = new Map();
  for (const candidate of found.values()) {
    const current = best.get(candidate.competitorLabel);
    if (!current || candidate.score > current.score) best.set(candidate.competitorLabel, candidate);
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
}

const SEMANTIC_CONFLICTS = [
  ['первич', 'повторн'],
  ['взросл', 'детск'],
  ['ребен', 'взросл']
];

function hasSemanticConflict(ourName, competitorName) {
  const ours = normalizeName(ourName);
  const theirs = normalizeName(competitorName);
  const opposed = SEMANTIC_CONFLICTS.some(([left, right]) =>
    (ours.includes(left) && !ours.includes(right) && theirs.includes(right) && !theirs.includes(left)) ||
    (ours.includes(right) && !ours.includes(left) && theirs.includes(left) && !theirs.includes(right))
  );
  if (opposed) return true;

  const oursWithoutContrast = ours.includes('без контраст');
  const theirsWithoutContrast = theirs.includes('без контраст');
  const oursWithContrast = !oursWithoutContrast && (ours.includes('с контраст') || ours.includes('контрастирован'));
  const theirsWithContrast = !theirsWithoutContrast && (theirs.includes('с контраст') || theirs.includes('контрастирован'));
  return (oursWithoutContrast && theirsWithContrast) || (oursWithContrast && theirsWithoutContrast);
}

function canAutoConfirm(item, candidate) {
  if (candidate.method === 'code804') return true;
  if (normalizeName(item.serviceName) === normalizeName(candidate.name)) return true;
  return candidate.method === 'name' &&
    Number(candidate.score) >= AUTO_NAME_THRESHOLD &&
    !hasSemanticConflict(item.serviceName, candidate.name);
}

/**
 * Подтверждённые связи — это общий словарь, а не работа внутри одного листа.
 * Собираем его один раз и переиспользуем при любом следующем подборе.
 */
async function learnedMappings(labels) {
  if (!labels?.length) return new Map();

  const [rows] = await sequelize.query(
    `SELECT learned."misServiceId", learned."serviceCode", learned."serviceName",
            cs.id, cs.name, cs."nameNormalized", cs.category, cs.codes,
            src."competitorLabel", src.name AS "sourceName", src.city,
            m.method, m.score
       FROM competitor_service_matches m
       JOIN price_comparison_items learned ON learned.id = m."itemId"
       JOIN competitor_services cs ON cs.id = m."competitorServiceId"
       JOIN competitor_sources src ON src.id = cs."sourceId"
      WHERE m.status = 'confirmed'
        AND cs."isActive"
        AND src."competitorLabel" IN (:labels)
      ORDER BY m."confirmedAt" DESC NULLS LAST`,
    { replacements: { labels } }
  );

  const byService = new Map();
  for (const row of rows) {
    const key = ownServiceKey(row);
    if (!key) continue;
    if (!byService.has(key)) byService.set(key, new Map());
    // Последнее подтверждение для клиники выигрывает; ORDER BY уже это обеспечил.
    if (!byService.get(key).has(row.competitorLabel)) {
      byService.get(key).set(row.competitorLabel, row);
    }
  }
  return byService;
}

/**
 * Подобрать соответствия для всех позиций сравнения.
 *
 * Пересчёт безопасен: подтверждённые и отклонённые соответствия остаются
 * нетронутыми. Иначе человек, разобравший сотню позиций, потерял бы работу
 * при первом же повторном запуске.
 */
async function suggestForComparison(comparisonId, { actor = null } = {}) {
  const [items] = await sequelize.query(
    `SELECT id, "serviceName", "serviceCode", "misServiceId"
       FROM price_comparison_items WHERE "comparisonId" = :comparisonId ORDER BY "sortOrder"`,
    { replacements: { comparisonId } }
  );

  const [[comparison]] = await sequelize.query(
    'SELECT competitors FROM price_comparisons WHERE id = :comparisonId',
    { replacements: { comparisonId } }
  );
  // Ищем только среди конкурентов, перечисленных в самом сравнении: остальные
  // клиники в нём не участвуют, и предлагать их — только мешать
  const labels = Array.isArray(comparison?.competitors) && comparison.competitors.length
    ? comparison.competitors
    : null;

  if (!labels?.length) {
    return { items: items.length, created: 0, autoConfirmed: 0, reused: 0, review: 0, skipped: 0 };
  }

  const learned = await learnedMappings(labels);
  let created = 0;
  let autoConfirmed = 0;
  let reused = 0;
  let skipped = 0;

  for (const item of items) {
    const confirmedLabels = new Set();

    // Сначала применяем словарь, выученный на других листах.
    const remembered = learned.get(ownServiceKey(item));
    for (const [label, candidate] of remembered || []) {
      const [match, isNew] = await CompetitorServiceMatch.findOrCreate({
        where: { itemId: item.id, competitorServiceId: candidate.id },
        defaults: {
          status: 'confirmed',
          method: 'learned',
          score: candidate.score,
          confirmedBy: actor?.id || null,
          confirmedAt: new Date()
        }
      });

      if (match.status === 'suggested') {
        await match.update({
          status: 'confirmed',
          method: 'learned',
          confirmedBy: actor?.id || null,
          confirmedAt: new Date()
        });
      }
      if (match.status === 'confirmed') {
        confirmedLabels.add(label);
        reused += isNew ? 1 : 0;
      }
    }

    const candidates = await findCandidates(item, { labels });

    for (const candidate of candidates) {
      if (confirmedLabels.has(candidate.competitorLabel)) continue;
      const automatic = canAutoConfirm(item, candidate);
      const [match, isNew] = await CompetitorServiceMatch.findOrCreate({
        where: { itemId: item.id, competitorServiceId: candidate.id },
        defaults: {
          status: automatic ? 'confirmed' : 'suggested',
          method: candidate.method,
          score: candidate.score.toFixed(3),
          confirmedBy: automatic ? actor?.id || null : null,
          confirmedAt: automatic ? new Date() : null
        }
      });

      if (isNew) {
        created += 1;
        if (automatic) {
          autoConfirmed += 1;
          confirmedLabels.add(candidate.competitorLabel);
        }
        continue;
      }

      // Решение человека не трогаем никогда
      if (match.status !== 'suggested') {
        skipped += 1;
        continue;
      }

      // Прежнее предложение можно уточнить: код мог появиться там, где
      // раньше было только похожее название
      await match.update({
        status: automatic ? 'confirmed' : 'suggested',
        method: candidate.method,
        score: candidate.score.toFixed(3),
        confirmedBy: automatic ? actor?.id || null : null,
        confirmedAt: automatic ? new Date() : null
      });
      if (automatic) {
        autoConfirmed += 1;
        confirmedLabels.add(candidate.competitorLabel);
      }
    }
  }

  const review = await CompetitorServiceMatch.count({
    where: { status: 'suggested' },
    include: [{
      association: 'item',
      required: true,
      where: { comparisonId },
      attributes: []
    }]
  });

  return { items: items.length, created, autoConfirmed, reused, review, skipped };
}

/**
 * Одно ручное решение обучает все листы, где встречается та же наша услуга
 * и добавлена та же клиника.
 */
async function reuseConfirmedMatch(matchId, { actor = null } = {}) {
  const [[origin]] = await sequelize.query(
    `SELECT m."competitorServiceId", it.id AS "itemId", it."misServiceId",
            it."serviceCode", it."serviceName", src."competitorLabel"
       FROM competitor_service_matches m
       JOIN price_comparison_items it ON it.id = m."itemId"
       JOIN competitor_services cs ON cs.id = m."competitorServiceId"
       JOIN competitor_sources src ON src.id = cs."sourceId"
      WHERE m.id = :matchId`,
    { replacements: { matchId } }
  );
  if (!origin?.competitorLabel) return { reused: 0, comparisonIds: [], origin: null };

  const [items] = await sequelize.query(
    `SELECT it.id, it."comparisonId", it."misServiceId", it."serviceCode", it."serviceName"
       FROM price_comparison_items it
       JOIN price_comparisons pc ON pc.id = it."comparisonId"
      WHERE pc.competitors @> :label::jsonb`,
    { replacements: { label: JSON.stringify([origin.competitorLabel]) } }
  );

  const key = ownServiceKey(origin);
  const comparisonIds = new Set();
  let reused = 0;
  for (const item of items) {
    if (item.id === origin.itemId || ownServiceKey(item) !== key) continue;
    const [match, isNew] = await CompetitorServiceMatch.findOrCreate({
      where: { itemId: item.id, competitorServiceId: origin.competitorServiceId },
      defaults: {
        status: 'confirmed',
        method: 'learned',
        score: 1,
        confirmedBy: actor?.id || null,
        confirmedAt: new Date()
      }
    });
    if (match.status === 'suggested') {
      await match.update({
        status: 'confirmed',
        method: 'learned',
        confirmedBy: actor?.id || null,
        confirmedAt: new Date()
      });
    }
    if (match.status === 'confirmed') {
      comparisonIds.add(item.comparisonId);
      if (isNew) reused += 1;
    }
  }
  return {
    reused,
    comparisonIds: [...comparisonIds],
    origin: { itemId: origin.itemId, competitorLabel: origin.competitorLabel }
  };
}

async function autoMatchAllComparisons() {
  const [rows] = await sequelize.query(
    `SELECT id FROM price_comparisons
      WHERE jsonb_array_length(COALESCE(competitors, '[]'::jsonb)) > 0`
  );
  const totals = { comparisons: 0, autoConfirmed: 0, reused: 0, review: 0 };
  for (const row of rows) {
    const result = await suggestForComparison(row.id);
    totals.comparisons += 1;
    totals.autoConfirmed += result.autoConfirmed;
    totals.reused += result.reused;
    totals.review += result.review;
  }
  return totals;
}

module.exports = {
  NAME_THRESHOLD,
  CANDIDATES_PER_ITEM,
  AUTO_NAME_THRESHOLD,
  normalizeName,
  normalizeCode,
  ownServiceKey,
  hasSemanticConflict,
  canAutoConfirm,
  code804For,
  findCandidates,
  suggestForComparison,
  reuseConfirmedMatch,
  autoMatchAllComparisons
};
