'use strict';

/**
 * Прокси к alfa-parser — парсеру прайсов клиник-конкурентов.
 *
 * Парсер работает на отдельной машине в локальной сети и слушает по HTTP.
 * Страница вики открыта по HTTPS, поэтому дёрнуть его из браузера напрямую
 * нельзя — браузер запретит смешанный контент. Ходит сюда фронт, а в парсер
 * идёт уже этот бэкенд: ему смешанный контент не помеха, а парсер благодаря
 * этому не нужно ни выставлять наружу, ни переводить на HTTPS.
 *
 * Настройка — в services/parserClient.js. Снаружи всё закрыто JWT:
 * маршруты только для сотрудников вики.
 */

const express = require('express');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { CompetitorSource } = require('../models');
const parser = require('../services/parserClient');
const { syncAll } = require('../services/competitorPricesSync');

const router = express.Router();

// Заводить источники и запускать обходы может не всякий сотрудник: это
// действия с внешними последствиями — мы ходим на чужие сайты. Доступ даётся
// тумблером «Парсер» в настройках пользователя. Сами цены смотреть можно
// шире — они лежат в модуле сравнения цен.
const canManage = [authenticate, requireAdminAccess('parser')];

/** Ошибку парсера показываем так, чтобы по ней было понятно, что чинить. */
function fail(res, err, what) {
  const described = parser.describeError(err);
  console.error(`❌ Парсер (${what}): ${described.error} — ${err.message}`);
  return res.status(described.status).json({
    success: false,
    error: described.error,
    message: described.message
  });
}

// ═══════════════════════════════════════════════════════════════
// ДИАГНОСТИКА
// ═══════════════════════════════════════════════════════════════

/**
 * Связь с парсером: настроено ли на нашей стороне и отвечает ли он.
 *
 * /api/ping на парсере отвечает без ключа — поэтому «адрес неверный» и
 * «ключ неверный» тут не сливаются в одну неисправность.
 */
router.get('/ping', ...canManage, async (req, res) => {
  try {
    const data = await parser.ping();
    res.json({
      success: true,
      parserUrl: parser.parserUrl(),
      tokenConfiguredInWiki: parser.hasToken(),
      tokenConfiguredInParser: Boolean(data?.auth_configured),
      parser: data
    });
  } catch (err) {
    const described = parser.describeError(err);
    console.error(`❌ Парсер (ping): ${described.error} — ${err.message}`);
    // адрес отдаём и в случае неудачи: без него не видно, куда не достучались
    res.status(described.status).json({
      success: false,
      error: described.error,
      message: described.message,
      parserUrl: parser.parserUrl(),
      tokenConfiguredInWiki: parser.hasToken()
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ИСТОЧНИКИ (напрямую из парсера)
// ═══════════════════════════════════════════════════════════════

// Список клиник-конкурентов со сводкой последнего обхода
router.get('/sources', ...canManage, async (req, res) => {
  try {
    res.json({ success: true, data: await parser.listSources() });
  } catch (err) {
    fail(res, err, 'sources');
  }
});

// Источник целиком: филиалы и последние обходы
router.get('/sources/:id', ...canManage, async (req, res) => {
  try {
    res.json({ success: true, data: await parser.getSource(req.params.id) });
  } catch (err) {
    fail(res, err, `source ${req.params.id}`);
  }
});

/**
 * Страница каталога с ценами.
 *
 * Листается курсором `after`, а не постранично: у clinic23 по Краснодару
 * 6778 услуг и 67 тысяч строк цен, и offset на таком объёме способен
 * пропустить услугу, если обход допишет строки посреди выгрузки.
 * В ответе `next_after` — с чем звать следующий раз, null — каталог кончился.
 */
router.get('/sources/:id/services', ...canManage, async (req, res) => {
  try {
    const data = await parser.listServices(req.params.id, {
      after: req.query.after || 0,
      limit: req.query.limit || 500
    });
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `services ${req.params.id}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// СИНХРОНИЗАЦИЯ (наша копия прайсов)
// ═══════════════════════════════════════════════════════════════

// Синхронизация идёт минутами, поэтому её нельзя выполнять внутри запроса:
// маршрут только запускает её и сразу отвечает, а ход дела виден в /sync/status
let syncRunning = false;

/**
 * Что и когда мы забрали. Свежесть здесь двойная, и обе даты важны:
 * `syncedAt` — когда мы забирали данные, `lastRunAt` — когда парсер видел сайт.
 * Свежая синхронизация недельного обхода — это всё ещё недельные цены.
 */
router.get('/sync/status', ...canManage, async (req, res) => {
  try {
    const sources = await CompetitorSource.findAll({
      order: [['name', 'ASC']],
      attributes: [
        'id', 'parserSourceId', 'name', 'baseUrl', 'city', 'servicesTotal',
        'lastRunAt', 'lastRunStatus', 'syncedAt', 'syncStatus', 'syncError',
        'competitorLabel'
      ]
    });
    res.json({ success: true, running: syncRunning, data: sources });
  } catch (err) {
    console.error('❌ Не удалось прочитать состояние синхронизации:', err.message);
    res.status(500).json({ success: false, error: 'status_failed', message: 'Не удалось прочитать состояние синхронизации' });
  }
});

/**
 * Как эта клиника называется в сравнениях цен.
 *
 * В сравнении конкуренты перечислены человеческими названиями («Неомед»),
 * а в зеркале источники зовутся по домену («clinic23-krd»). Пока связь
 * не проставлена, цены источника подставлять некуда, и в сопоставлении
 * он не участвует.
 */
router.put('/sources/:parserSourceId/label', ...canManage, async (req, res) => {
  try {
    const source = await CompetitorSource.findOne({
      where: { parserSourceId: Number(req.params.parserSourceId) }
    });
    if (!source) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Источника нет в нашей копии — сначала заберите цены'
      });
    }

    const label = (req.body?.competitorLabel || '').trim();
    await source.update({ competitorLabel: label || null });
    res.json({ success: true, data: { competitorLabel: source.competitorLabel } });
  } catch (err) {
    console.error('❌ Не удалось сохранить название конкурента:', err.message);
    res.status(500).json({ success: false, error: 'label_failed', message: 'Не удалось сохранить название' });
  }
});

/** Забрать прайсы прямо сейчас, не дожидаясь ночного расписания. */
router.post('/sync', ...canManage, async (req, res) => {
  if (syncRunning) {
    return res.status(409).json({
      success: false,
      error: 'sync_already_running',
      message: 'Синхронизация уже идёт — дождитесь её окончания'
    });
  }

  syncRunning = true;
  res.status(202).json({
    success: true,
    message: 'Синхронизация запущена. Ход дела — в /api/parser/sync/status'
  });

  // Ответ уже ушёл: дальше работаем в фоне и общаемся с интерфейсом
  // через состояние в базе
  syncAll()
    .catch(err => console.error('❌ Ручная синхронизация прайсов конкурентов не удалась:', err.message))
    .finally(() => { syncRunning = false; });
});

// ═══════════════════════════════════════════════════════════════
// РАЗБОР ССЫЛКИ И ОБХОД
// ═══════════════════════════════════════════════════════════════

/**
 * Завести новый источник: разобрать ссылку на страницу с ценами.
 *
 * Отвечает сразу и обход не начинает. Разбор идёт минутами, а его результат
 * человек сначала смотрит глазами: сколько строк нашлось, что в превью, какие
 * у парсера сомнения. Дальше страница опрашивает /jobs/:id и, когда задача
 * встанет в `awaiting_confirm`, показывает экран подтверждения.
 */
router.post('/analyze', ...canManage, async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) {
    return res.status(400).json({ success: false, error: 'url_required', message: 'Вставьте ссылку на страницу с ценами' });
  }

  try {
    const data = await parser.post('/api/analyze', { url, city: req.body?.city || null });
    console.log(`🔎 Разбор ссылки ${url} запущен пользователем ${req.user?.username}`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, 'analyze');
  }
});

/**
 * Состояние задачи — это опрашивает страница разбора.
 *
 * Состояние `lost` означает, что парсер перезапускался: его реестр задач живёт
 * в памяти процесса. Это не сбой связи, и показывать его надо иначе.
 */
router.get('/jobs/:jobId', ...canManage, async (req, res) => {
  try {
    const data = await parser.get(`/api/jobs/${encodeURIComponent(req.params.jobId)}`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `job ${req.params.jobId}`);
  }
});

/** Человек принял разбор: заводим источники по отмеченным городам и обходим сайт. */
router.post('/jobs/:jobId/confirm', ...canManage, async (req, res) => {
  const cities = Array.isArray(req.body?.cities) ? req.body.cities : [];

  try {
    const data = await parser.post(`/api/jobs/${encodeURIComponent(req.params.jobId)}/confirm`, { cities });
    console.log(`✅ Разбор ${req.params.jobId} подтверждён пользователем ${req.user?.username}` + (cities.length ? `, города: ${cities.join(', ')}` : ''));
    res.json({ success: true, data });
  } catch (err) {
    // 409 — задача уже подтверждена или потеряна; это не поломка связи,
    // и страницу надо просто перечитать
    if (err.response?.status === 409) {
      return res.status(409).json({
        success: false,
        error: 'job_not_awaiting',
        message: 'Задача уже подтверждена или потеряна — обновите страницу'
      });
    }
    fail(res, err, `confirm ${req.params.jobId}`);
  }
});

/** Обойти заново уже заведённый источник — без подтверждения. */
router.post('/sources/:id/refresh', ...canManage, async (req, res) => {
  try {
    const data = await parser.post(`/api/sources/${encodeURIComponent(req.params.id)}/refresh`);
    console.log(`🔄 Обход источника ${req.params.id} запущен пользователем ${req.user?.username}`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `refresh ${req.params.id}`);
  }
});

module.exports = router;
