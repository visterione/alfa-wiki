'use strict';

/**
 * Сопоставление услуг конкурентов с позициями сравнения цен и подстановка цен.
 *
 * Читать и запускать автоматический подбор может любой сотрудник — это часть
 * обычного добавления конкурента. Вручную решать оставшиеся спорные пары может
 * сотрудник с доступом «Парсер цен».
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
              COALESCE(src."displayName", src.name) AS "sourceName",
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
// Автоматический подбор — часть обычного действия «добавить конкурента» на
// странице сравнения. Ручные решения по спорным парам по-прежнему оставлены
// сотрудникам с доступом к парсеру.
router.post('/:comparisonId/matches/suggest', authenticate, async (req, res) => {
  try {
    const comparison = await PriceComparison.findByPk(req.params.comparisonId);
    if (!comparison) {
      return res.status(404).json({ success: false, error: 'not_found', message: 'Сравнение не найдено' });
    }

    const result = await matching.suggestForComparison(req.params.comparisonId, { actor: req.user });
    const filled = await fill.fillComparison(req.params.comparisonId, { actor: req.user });
    console.log(
      `🔗 Автосопоставление для «${comparison.name}»: позиций ${result.items}, ` +
      `принято ${result.autoConfirmed}, переиспользовано ${result.reused}, проверить ${result.review}`
    );
    res.json({ success: true, data: { ...result, filled: filled.filled, protectedByHuman: filled.protectedByHuman } });
  } catch (err) {
    console.error('❌ Подбор соответствий не удался:', err.message);
    res.status(500).json({ success: false, error: 'suggest_failed', message: 'Подбор соответствий не удался' });
  }
});

/**
 * Принять соответствие.
 *
 * Цена уходит в сравнение сразу, отдельного шага «подставить» нет: человек
 * принимает соответствие ровно затем, чтобы увидеть цену конкурента, — просить
 * его нажать ещё одну кнопку с непонятным названием было лишним. Дальше цену
 * поддерживает свежей ночная синхронизация.
 */
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

    const learned = await matching.reuseConfirmedMatch(match.id, { actor: req.user });
    const summary = await fill.fillComparison(req.params.comparisonId, {
      actor: req.user,
      // Явное принятие — осознанное разрешение заменить прежнее ручное
      // значение именно для этой услуги и этой клиники.
      overwriteMatchIds: [match.id],
      overwriteItemSources: learned.origin ? [learned.origin] : []
    });
    for (const comparisonId of learned.comparisonIds) {
      await fill.fillComparison(comparisonId, { actor: req.user });
    }
    res.json({
      success: true,
      data: {
        match,
        filled: summary.filled,
        protectedByHuman: summary.protectedByHuman,
        reused: learned.reused
      }
    });
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
