'use strict';

/**
 * Раздел «Площадки» модуля отзывов (ver. 8.80): учётные записи площадок для
 * Альфа Парсера и привязка мест к доскам.
 *
 *   GET    /api/review-collector                   всё для страницы одним запросом
 *   GET    /api/review-collector/health            какие учётки требуют внимания
 *   POST   /api/review-collector/accounts          завести учётку (сразу уходит на проверку)
 *   PATCH  /api/review-collector/accounts/:id      изменить; новый пароль — новая проверка
 *   DELETE /api/review-collector/accounts/:id      удалить вместе с местами
 *   POST   /api/review-collector/accounts/:id/check  проверить вход
 *   POST   /api/review-collector/accounts/:id/input  клик или текст в удалённый вход
 *   PATCH  /api/review-collector/places/:id        доска и режим места
 *
 * Только администраторам: здесь пароли всех площадок сети. Пароль в ответах
 * не возвращается никогда — модель прячет его по умолчанию.
 */

const express = require('express');
const { Op } = require('sequelize');

const {
  ReviewPlatformAccount, ReviewPlatformPlace, ReviewCollectorJob, ReviewBoard, MedCenter,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const collector = require('../services/reviewCollector/jobs');
const platforms = require('../services/reviewCollector/platforms');
const { accountProblem } = require('../services/reviewCollector/health');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Раздел доступен только администраторам' });
  next();
}

router.use(authenticate, requireAdmin);

function fail(res, err, fallback) {
  const status = err.status || 500;
  if (status >= 500) console.error('[review-collector]', err);
  res.status(status).json({ error: status >= 500 ? fallback : err.message });
}

router.get('/', async (req, res) => {
  try {
    const [accounts, boards, lastChecks] = await Promise.all([
      ReviewPlatformAccount.findAll({
        include: [{ model: ReviewPlatformPlace, as: 'places' }],
        order: [['platform', 'ASC'], ['createdAt', 'ASC'], [{ model: ReviewPlatformPlace, as: 'places' }, 'name', 'ASC']],
      }),
      ReviewBoard.findAll({
        where: { archived: false },
        include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }],
      }),
      // Незакрытая проверка у учётки — чтобы кнопка показывала «проверяется»,
      // а не предлагала нажать ещё раз.
      ReviewCollectorJob.findAll({
        where: { kind: 'check', status: { [Op.in]: ['queued', 'taken'] } },
        attributes: ['accountId'],
      }),
    ]);

    const checking = new Set(lastChecks.map(j => j.accountId));

    res.json({
      platforms: platforms.list(),
      accounts: accounts.map(a => {
        const json = a.toJSON();
        return { ...json, checking: checking.has(a.id), problem: accountProblem(json) };
      }),
      boards: boards
        .map(b => ({ id: b.id, name: b.medCenter?.name || '—' }))
        .sort((x, y) => x.name.localeCompare(y.name, 'ru')),
    });
  } catch (err) {
    fail(res, err, 'Не удалось загрузить площадки');
  }
});

// Сколько учёток требуют внимания — для треугольника на кнопке «Площадки»
// (ver. 8.87). Лёгкий запрос: его делает каждый заход в раздел отзывов.
router.get('/health', async (req, res) => {
  try {
    const accounts = await ReviewPlatformAccount.findAll({
      where: { isEnabled: true },
      attributes: ['id', 'platform', 'label', 'login', 'status', 'statusAt', 'createdAt', 'isEnabled'],
      include: [{ model: ReviewPlatformPlace, as: 'places', attributes: ['mode', 'boardId'] }],
    });
    const problems = accounts
      .map(a => ({ account: a.toJSON(), problem: accountProblem(a.toJSON()) }))
      .filter(x => x.problem)
      .map(({ account, problem }) => ({
        id: account.id,
        platform: account.platform,
        name: account.label || account.login,
        problem,
      }));
    res.json({ count: problems.length, problems });
  } catch (err) {
    fail(res, err, 'Не удалось проверить площадки');
  }
});

router.post('/accounts', async (req, res) => {
  try {
    const account = await collector.createAccount(req.body || {}, req.user.id);
    res.status(201).json({ id: account.id });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Учётная запись с таким логином на этой площадке уже есть' });
    }
    fail(res, err, 'Не удалось сохранить учётную запись');
  }
});

router.patch('/accounts/:id', async (req, res) => {
  try {
    await collector.updateAccount(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Учётная запись с таким логином на этой площадке уже есть' });
    }
    fail(res, err, 'Не удалось сохранить учётную запись');
  }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    const n = await ReviewPlatformAccount.destroy({ where: { id: req.params.id } });
    if (!n) return res.status(404).json({ error: 'Учётная запись не найдена' });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'Не удалось удалить учётную запись');
  }
});

router.post('/accounts/:id/check', async (req, res) => {
  try {
    const account = await ReviewPlatformAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Учётная запись не найдена' });
    await collector.enqueueCheck(account.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'Не удалось поставить проверку');
  }
});

// Ввод человека в удалённый вход (ver. 8.85): клик по снимку капчи в
// координатах снимка, текст в активное поле или клавиша.
router.post('/accounts/:id/input', async (req, res) => {
  try {
    await collector.enqueueInput(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'Не удалось передать ввод');
  }
});

router.patch('/places/:id', async (req, res) => {
  try {
    const place = await ReviewPlatformPlace.findByPk(req.params.id);
    if (!place) return res.status(404).json({ error: 'Место не найдено' });

    const patch = {};
    if (req.body.boardId !== undefined) {
      if (req.body.boardId) {
        const board = await ReviewBoard.findByPk(req.body.boardId);
        if (!board) return res.status(400).json({ error: 'Доска не найдена' });
      }
      patch.boardId = req.body.boardId || null;
    }
    if (req.body.mode !== undefined) {
      if (!['off', 'shadow', 'live'].includes(req.body.mode)) {
        return res.status(400).json({ error: 'Неизвестный режим' });
      }
      patch.mode = req.body.mode;
    }

    const boardId = patch.boardId !== undefined ? patch.boardId : place.boardId;
    const mode = patch.mode || place.mode;
    if (mode !== 'off' && !boardId) {
      return res.status(400).json({ error: 'Сначала выберите медцентр для этого места' });
    }
    // Другая доска — старый отчёт сверки про неё ничего не говорит.
    if (patch.boardId !== undefined && patch.boardId !== place.boardId) patch.stats = {};

    await place.update(patch);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'Не удалось сохранить место');
  }
});

module.exports = router;
