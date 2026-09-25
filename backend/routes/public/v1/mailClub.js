'use strict';

/**
 * Почтовый клуб — приём подписчиков с сайтов медцентров (ver. 8.79).
 *
 *   POST /api/public/v1/mail-club/subscribe   — записать адрес в клуб клиники
 *   GET  /api/public/v1/mail-club/clinics     — какие clinic_id мы принимаем
 *
 * Заголовок X-Api-Key обязателен, право — mail-club:subscribe. Ключ тот же,
 * которым сайт шлёт анкеты: выдавать его заново не нужно, достаточно
 * поставить галочку в «Интеграциях».
 *
 * Клуб выбирается параметром clinic_id, а не ключом. Сайты делает один
 * разработчик, и ключ у него один на все; клиника же на каждом сайте своя.
 *
 * Отдельный маршрут, а не ещё одна форма в forms/: форма — это заявка,
 * которую бот доставляет в чат и которую кто-то разбирает. Подписка никуда не
 * доставляется и никем не разбирается — она сразу становится строкой списка.
 */

const express = require('express');
const router = express.Router();

const { apiKeyAuth, rateLimitByClient, clientIp } = require('../../../middleware/publicApi');
const fieldValidator = require('../../../services/public/fieldValidator');
const mailClub = require('../../../services/mailClub');

const SCOPE = 'mail-club:subscribe';

// Описание полей — тем же движком, что у форм, чтобы ответ об ошибке у
// разработчика сайта выглядел одинаково во всех наших методах.
const FIELDS = [
  { key: 'email', label: 'Электронная почта', type: 'email', required: true },
  { key: 'clinic_id', label: 'ID клиники в МИС', type: 'string', required: true, max: 20 },
  // Всё ниже — не для работы, а для ответа на «откуда у вас мой адрес».
  // Запрос приходит с сервера сайта, и его IP — это IP сайта, а не человека;
  // адрес и браузер посетителя знает только сайт.
  { key: 'page_url', label: 'Страница подписки', type: 'string', max: 500 },
  { key: 'visitor_ip', label: 'IP посетителя', type: 'string', max: 64 },
  { key: 'visitor_user_agent', label: 'Браузер посетителя', type: 'string', max: 400 },
];

function fail(res, status, error, message, extra = {}) {
  res.locals.errorCode = error;
  return res.status(status).json({ ok: false, error, message, ...extra });
}

router.post('/subscribe', apiKeyAuth(SCOPE), rateLimitByClient(), async (req, res) => {
  try {
    const result = fieldValidator.validate(req.body || {}, FIELDS);
    if (!result.ok) {
      return fail(res, 400, 'validation_failed', 'Некоторые поля заполнены неверно', {
        fields: result.fields,
        unknownFields: result.unknownFields.length ? result.unknownFields : undefined,
      });
    }
    const input = result.value;

    const { medCenter, error } = await mailClub.findMedCenterByClinicId(input.clinic_id);
    if (error === 'ambiguous_clinic') {
      // Не вина сайта, а справочника: этот clinic_id записан у двух клиник.
      // Ответ 500, а не 400, чтобы разработчик не искал ошибку у себя.
      console.error(`[mail-club] clinic_id ${input.clinic_id} записан у нескольких медцентров`);
      return fail(res, 500, 'ambiguous_clinic', 'Клиника настроена у нас неоднозначно, мы уже разбираемся');
    }
    if (error) {
      // Адрес не кладём «куда-нибудь»: подписчик чужой клиники хуже, чем
      // ошибка, которую разработчик сайта увидит на первой же проверке.
      return fail(res, 400, 'unknown_clinic',
        `Клиники с clinic_id «${input.clinic_id}» у нас нет. Допустимые значения — GET /api/public/v1/mail-club/clinics`);
    }

    const { status } = await mailClub.subscribe({
      email: input.email,
      medCenterId: medCenter.id,
      source: 'site',
      apiClientId: req.apiClient.id,
      consent: mailClub.consentOf({
        pageUrl: input.page_url,
        visitorIp: input.visitor_ip,
        visitorUserAgent: input.visitor_user_agent,
        requestIp: clientIp(req),
      }),
    });

    // 201 — новый подписчик, 200 — адрес уже был. Сайту в обоих случаях
    // показывать «Спасибо, вы подписаны»: для человека это одно и то же.
    return res.status(status === 'subscribed' ? 201 : 200).json({
      ok: true,
      status,
      clinic: medCenter.displayName || medCenter.name,
    });
  } catch (error) {
    console.error('[mail-club] ошибка подписки:', error);
    return fail(res, 500, 'internal_error', 'Внутренняя ошибка сервера');
  }
});

/**
 * Список клиник, чьи clinic_id мы принимаем. Для разработчика сайта: сверить,
 * что номер на сайте совпадает с нашим справочником, не переписываясь с нами.
 */
router.get('/clinics', apiKeyAuth(SCOPE), rateLimitByClient(), async (req, res) => {
  try {
    const rows = await mailClub.clubCenters();
    const clinics = [];
    for (const mc of rows) {
      for (const id of mc.misClinicIds || []) {
        if (!mailClub.normalizeClinicId(id)) continue;
        clinics.push({ clinic_id: String(id), name: mc.displayName || mc.name });
      }
    }
    res.json({ ok: true, clinics });
  } catch (error) {
    console.error('[mail-club] ошибка списка клиник:', error);
    return fail(res, 500, 'internal_error', 'Внутренняя ошибка сервера');
  }
});

module.exports = router;
