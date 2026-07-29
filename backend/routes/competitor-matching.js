'use strict';

/**
 * Сопоставление услуг конкурентов с позициями сравнения цен и подстановка цен.
 *
 * Читать соответствия может любой сотрудник — это часть картины по ценам.
 * Подбирать, утверждать и подставлять — только с доступом «Парсер цен»:
 * подтверждение соответствия решает, какая цена окажется в сравнении,
 * и цена ошибки здесь та же, что у ручного ввода.
 */

const express = require('express');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { sequelize, CompetitorServiceMatch, PriceComparison } = require('../models');
const matching = require('../services/competitorMatching');
const fill = require('../services/competitorPriceFill');

const router = express.Router();
const canApprove = [authenticate, requireAdminAccess('parser')];

/** Соответствия сравнения — со всем, что нужно человеку для решения. */
router.get('/:comparisonId/matches', authenticate, async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT m.id, m.status, m.method, m.score, m."confirmedAt",
              it.id            AS "itemId",
              it."serviceName" AS "ourName",
              it."serviceCode" AS "ourCode",
              cs.id            AS "competitorServiceId",
              cs.name          AS "competitorName",
              cs.category      AS "competitorCategory",
              cs.codes         AS "competitorCodes",
              src."competitorLabel",
              src.city,
              u."displayName"  AS "confirmedByName",
              (SELECT min(p.price) FROM competitor_prices p WHERE p."serviceId" = cs.id) AS price
         FROM competitor_service_matches m
         JOIN price_comparison_items it  ON it.id  = m."itemId"
         JOIN competitor_services    cs  ON cs.id  = m."competitorServiceId"
         JOIN competitor_sources     src ON src.id = cs."sourceId"
         LEFT JOIN users             u   ON u.id   = m."confirmedBy"
        WHERE it."comparisonId" = :comparisonId
        ORDER BY it."sortOrder", m.status, m.score DESC NULLS LAST`,
      { replacements: { comparisonId: req.params.comparisonId } }
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('❌ Не удалось прочитать сопоставления:', err.message);
    res.status(500).json({ success: false, error: 'matches_failed', message: 'Не удалось прочитать сопоставления' });
  }
});

/**
 * Подобрать соответствия автоматически.
 *
 * Пересчёт безопасен: подтверждённое и отклонённое остаётся нетронутым,
 * иначе разобранная вручную сотня позиций терялась бы при первом же запуске.
 */
router.post('/:comparisonId/matches/suggest', ...canApprove, async (req, res) => {
  try {
    const comparison = await PriceComparison.findByPk(req.params.comparisonId);
    if (!comparison) {
      return res.status(404).json({ success: false, error: 'not_found', message: 'Сравнение не найдено' });
    }

    const result = await matching.suggestForComparison(req.params.comparisonId);
    console.log(`🔗 Подбор соответствий для «${comparison.name}»: позиций ${result.items}, предложено ${result.created}`);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('❌ Подбор соответствий не удался:', err.message);
    res.status(500).json({ success: false, error: 'suggest_failed', message: 'Подбор соответствий не удался' });
  }
});

/** Принять соответствие. Цена появится в сравнении после подстановки. */
router.post('/:comparisonId/matches/:matchId/confirm', ...canApprove, async (req, res) => {
  try {
    const match = await CompetitorServiceMatch.findByPk(req.params.matchId);
    if (!match) {
      return res.status(404).json({ success: false, error: 'not_found', message: 'Соответствие не найдено' });
    }

    await match.update({
      status: 'confirmed',
      confirmedBy: req.user.id,
      confirmedAt: new Date()
    });
    res.json({ success: true, data: match });
  } catch (err) {
    console.error('❌ Не удалось принять соответствие:', err.message);
    res.status(500).json({ success: false, error: 'confirm_failed', message: 'Не удалось принять соответствие' });
  }
});

/**
 * Отказаться от соответствия.
 *
 * Заодно убираем цену, приехавшую по нему: связь сняли — значит и цене
 * в сравнении взяться неоткуда. Ручные цены при этом не трогаются.
 */
router.post('/:comparisonId/matches/:matchId/reject', ...canApprove, async (req, res) => {
  try {
    const match = await CompetitorServiceMatch.findByPk(req.params.matchId);
    if (!match) {
      return res.status(404).json({ success: false, error: 'not_found', message: 'Соответствие не найдено' });
    }

    const cleared = await fill.clearParserPrice(match);
    await match.update({ status: 'rejected', confirmedBy: req.user.id, confirmedAt: new Date() });
    res.json({ success: true, data: { cleared } });
  } catch (err) {
    console.error('❌ Не удалось отклонить соответствие:', err.message);
    res.status(500).json({ success: false, error: 'reject_failed', message: 'Не удалось отклонить соответствие' });
  }
});

/**
 * Подставить цены подтверждённых соответствий в сравнение.
 *
 * В ответе видно не только сколько проставлено, но и сколько значений парсер
 * не тронул: там уже стоит цена, введённая человеком, и перезаписывать её
 * он не имеет права.
 */
router.post('/:comparisonId/fill', ...canApprove, async (req, res) => {
  try {
    const comparison = await PriceComparison.findByPk(req.params.comparisonId);
    if (!comparison) {
      return res.status(404).json({ success: false, error: 'not_found', message: 'Сравнение не найдено' });
    }

    const summary = await fill.fillComparison(req.params.comparisonId, { actor: req.user });
    console.log(`💰 Подстановка цен в «${comparison.name}»: проставлено ${summary.filled}, ручных не тронуто ${summary.protectedByHuman}`);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('❌ Подстановка цен не удалась:', err.message);
    res.status(500).json({ success: false, error: 'fill_failed', message: 'Подстановка цен не удалась' });
  }
});

module.exports = router;
