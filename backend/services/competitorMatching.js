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

// Сколько кандидатов показываем человеку на одну позицию. Больше пяти
// не помогает: если верного нет и среди них, подбор промахнулся
const CANDIDATES_PER_ITEM = 5;

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
      `SELECT cs.id, cs.name, cs.category, cs.codes, src."competitorLabel", src.name AS "sourceName", src.city
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
      `SELECT cs.id, cs.name, cs.category, cs.codes, src."competitorLabel", src.name AS "sourceName", src.city,
              similarity(cs."nameNormalized", :name) AS score
         FROM competitor_services cs
         JOIN competitor_sources  src ON src.id = cs."sourceId"
        WHERE cs."isActive"
          AND src."competitorLabel" IS NOT NULL
          AND cs."nameNormalized" % :name
          ${labels ? 'AND src."competitorLabel" IN (:labels)' : ''}
        ORDER BY score DESC
        LIMIT :limit`,
      { replacements: { name: normalized, labels, limit: CANDIDATES_PER_ITEM * 4 } }
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

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, CANDIDATES_PER_ITEM);
}

/**
 * Подобрать соответствия для всех позиций сравнения.
 *
 * Пересчёт безопасен: подтверждённые и отклонённые соответствия остаются
 * нетронутыми. Иначе человек, разобравший сотню позиций, потерял бы работу
 * при первом же повторном запуске.
 */
async function suggestForComparison(comparisonId) {
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

  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const candidates = await findCandidates(item, { labels });

    for (const candidate of candidates) {
      const [match, isNew] = await CompetitorServiceMatch.findOrCreate({
        where: { itemId: item.id, competitorServiceId: candidate.id },
        defaults: {
          status: 'suggested',
          method: candidate.method,
          score: candidate.score.toFixed(3)
        }
      });

      if (isNew) {
        created += 1;
        continue;
      }

      // Решение человека не трогаем никогда
      if (match.status !== 'suggested') {
        skipped += 1;
        continue;
      }

      // Прежнее предложение можно уточнить: код мог появиться там, где
      // раньше было только похожее название
      await match.update({ method: candidate.method, score: candidate.score.toFixed(3) });
    }
  }

  return { items: items.length, created, skipped };
}

module.exports = {
  NAME_THRESHOLD,
  CANDIDATES_PER_ITEM,
  normalizeName,
  normalizeCode,
  code804For,
  findCandidates,
  suggestForComparison
};
