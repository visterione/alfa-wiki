'use strict';

/**
 * Итог ИИ-звонка от CRM партнёра (ver. 8.95).
 *
 *   POST /api/public/v1/ai-call/result   чем кончился разговор с пациентом
 *   GET  /api/public/v1/ai-call/results  словарь исходов — чтобы не спрашивать нас
 *
 * Ключ — из «Интеграций», право ai-call:result.
 *
 * ЗАЧЕМ ЭТО ЕСТЬ. Портал отдаёт партнёру лид на пациента, который не ответил на
 * напоминание (services/notifications/aiCall.js), робот звонит и выясняет, придёт
 * ли человек. Без обратного пути этот ответ оставался у партнёра: визит в МИС
 * висел активным, администратор держал под него время, и о неявке узнавали в день
 * приёма — то есть звонок ничего не менял.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ СЕКРЕТОМ В ПУТИ. Отчёты о доставке от Имобиса приходят на
 * /api/notifications/report/:secret — секретом в адресе, потому что провайдер не
 * умеет иначе. Здесь такой нужды нет, а плата за секрет в пути высока: он не
 * отзывается по одному, не имеет журнала обращений и не ограничен по IP. Этот же
 * приёмник пишет в МИС — отменяет визиты живым людям, — и право на такое должно
 * отзываться одной кнопкой в «Интеграциях».
 *
 * ЧТО ДЕЛАЕТ ИТОГ. Только «подтвердил» и «отменил» меняют визит, и меняют ровно
 * теми же двумя методами МИС, которыми его меняет кнопка в боте. Остальные
 * исходы — не дозвон, автоответчик, «позвоните позже» — записываются в заявку и
 * видны в журнале: они ничего не решают, но по ним считается, работает ли обзвон.
 */

const express = require('express');
const router = express.Router();

const { apiKeyAuth, rateLimitByClient } = require('../../../middleware/publicApi');
const aiCall = require('../../../services/notifications/aiCall');

const SCOPE = 'ai-call:result';

router.use(apiKeyAuth(SCOPE), rateLimitByClient());

/**
 * Словарь исходов, который мы понимаем. Отдаём отдельным адресом, чтобы на
 * вопрос «какие значения result вы принимаете» отвечал не человек в переписке, а
 * сам сервис: список будет расти, и переписка устареет первой.
 */
router.get('/results', (req, res) => {
  res.json({
    ok: true,
    results: Object.entries(aiCall.RESULTS).map(([code, aliases]) => ({
      code,
      aliases,
      // Что произойдёт в МИС. Партнёру это важнее самого кода: он выбирает, чем
      // отчитаться, и должен видеть, какой выбор отменяет визит.
      mis: aiCall.TO_MIS[code] === 'confirm' ? 'подтверждение визита'
        : (aiCall.TO_MIS[code] === 'cancel' ? 'отмена визита' : 'только запись в журнал')
    }))
  });
});

/**
 * Итог одного звонка.
 *
 * Обязательных полей два: номер визита и исход. Остальные — ФИО, время визита,
 * клиника — принимаются и сохраняются как есть: они не нужны нам для действия
 * (ключ один — appointment_id), но нужны в журнале, чтобы на спор «мы звонили не
 * про этот визит» отвечало присланное, а не память.
 */
router.post('/result', async (req, res) => {
  const body = req.body || {};

  try {
    const done = await aiCall.applyResult({
      // Имена принимаем во всех трёх видах, в каких их естественно назвать:
      // спорить об этом в переписке дороже, чем прочитать три ключа.
      appointmentId: body.appointment_id ?? body.appointmentId ?? body.visit_id ?? body.visitId,
      result: body.result ?? body.status ?? body.funnel_step ?? body.funnelStep,
      comment: body.comment ?? body.note ?? null,
      leadId: body.lead_id ?? body.leadId ?? null,
      // Тело целиком: словарь исходов у партнёра будет расти, и «other» без
      // исходного тела означал бы итог, о котором известно только то, что он был.
      raw: body
    });

    res.json({ ok: true, ...done });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[ai-call] итог звонка:', err);
    res.locals.errorCode = status >= 500 ? 'internal_error' : (status === 404 ? 'not_found' : 'bad_request');
    res.status(status).json({ ok: false, error: res.locals.errorCode, message: err.message });
  }
});

module.exports = router;
