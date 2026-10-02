'use strict';

/**
 * Открытая линия: API оператора и настройка линий (ver. 7.85).
 *
 * Доступ к работе даёт состав линии, а не отдельное право: кто заведён в линию,
 * тот и отвечает. Настройка самих линий — за администратором.
 */

const express = require('express');
const multer = require('multer');
const { Op } = require('sequelize');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sequelize, OmniLine, OmniLineOperator, OmniLineAccessRule, OmniLineExclusion, OmniConversation, OmniShift, MessengerBot, MedCenter, Role, User, OmniQuickReply } = require('../models');
const openLine = require('../services/openLine');
const openLineAccess = require('../services/openLineAccess');
const fileAccess = require('../services/fileAccess');
const openLineFiles = require('../services/openLineFiles');
const { getChannel } = require('../services/messengers');
const crypto = require('crypto');

const router = express.Router();

// Файл держим в памяти: он уходит в мессенджер телом запроса и одновременно
// ложится к нам на диск. Промежуточный файл во временной папке пришлось бы
// читать обратно ради того же самого.
//
// Потолок общий с входящими (openLineFiles.MAX_BYTES): столько отдаёт Bot API
// одним файлом, и разрешать оператору больше, чем платформа согласится
// доставить, — это обещание, которое мы не сдержим.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: openLineFiles.MAX_BYTES }
});

/**
 * Ошибка multer — это ответ оператору («файл слишком большой»), а не наша
 * авария: через общий fail она стала бы пятисоткой без объяснения. Тот же
 * приём, что у картинки рассылки.
 */
function uploadFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    const mb = Math.round(openLineFiles.MAX_BYTES / (1024 * 1024));
    res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE'
        ? `Файл больше ${mb} МБ — столько мессенджер всё равно не примет`
        : (err.message || 'Не удалось принять файл')
    });
  });
}

// Коды ошибок логики → коды HTTP. Держим в одном месте, чтобы маршруты не
// повторяли одну и ту же лесенку if-ов.
const STATUS_BY_CODE = {
  not_operator: 403,
  not_yours: 403,
  already_taken: 409,
  not_found: 404
};

function fail(res, err, where) {
  if (err.name === 'OpenLineError') {
    return res.status(STATUS_BY_CODE[err.code] || 400).json({ error: err.message, code: err.code });
  }
  console.error(`[open-line] ${where}:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

// ── Смена ─────────────────────────────────────────────────────────────────

// Состояние сотрудника: заведён ли в линии, начат ли день.
router.get('/state', authenticate, async (req, res) => {
  try {
    const state = await openLine.shiftState(req.user.id);
    // Короткоживущий токен для ссылок на вложения: картинку в <img> заголовком
    // не подписать, поэтому он подставляется в ?t= — как в чатах и онбординге.
    res.json({ ...state, fileToken: fileAccess.issueToken(req.user.id) });
  } catch (err) {
    fail(res, err, 'GET /state');
  }
});

// Начать или закончить день. Кнопка одна: открывает все линии сотрудника —
// очередь у него общая.
router.post('/shift', authenticate, async (req, res) => {
  try {
    const on = req.body && req.body.on !== false;
    const result = on
      ? await openLine.startDay(req.user.id)
      : await openLine.endDay(req.user.id, req.app.get('io'));
    res.json({ ...result, ...(await openLine.shiftState(req.user.id)) });
  } catch (err) {
    fail(res, err, 'POST /shift');
  }
});

// ── Обращения ─────────────────────────────────────────────────────────────

router.get('/conversations', authenticate, async (req, res) => {
  try {
    const scope = ['queue', 'mine', 'closed'].includes(req.query.scope) ? req.query.scope : 'queue';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const q = String(req.query.q || '').slice(0, 100);
    // Отбор по одной линии (ver. 9.23). Проверка, что линия своя, — в сервисе:
    // чужая молча не действует, а не роняет список.
    const lineId = req.query.lineId ? String(req.query.lineId) : null;
    res.json(await openLine.listConversations(req.user.id, { scope, limit, offset, q, lineId }));
  } catch (err) {
    fail(res, err, 'GET /conversations');
  }
});

// Число на значке раздела в боковой панели (ver. 9.23). Тому, кто ни в одной
// линии не состоит, — нули, а не ошибка: панель спрашивает у всех, кому раздел
// открыт, и красная строка в консоли на каждый опрос никому не нужна.
router.get('/badge', authenticate, async (req, res) => {
  try {
    res.json(await openLine.badge(req.user.id));
  } catch (err) {
    fail(res, err, 'GET /badge');
  }
});

// ── Продуктивность ────────────────────────────────────────────────────────

// Рейтинг сотрудников и KPI. Открыт всем, кто работает на линии, а не только
// администратору: доска показателей имеет смысл, когда её видит тот, кого она
// касается. Администратор без линий смотрит по всей сети.
router.get('/stats', authenticate, async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    // Месяц по умолчанию: смены складываются в месячную картину, за неделю
    // случайный выходной перекашивает долю разобранного.
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    const own = await openLine.linesOfUser(req.user.id);
    let lineIds = own.map(r => r.lineId);

    if (req.user.isAdmin) {
      const all = await OmniLine.findAll({ attributes: ['id'] });
      lineIds = all.map(l => l.id);
    }
    if (!lineIds.length) {
      throw new openLine.OpenLineError('not_operator', 'Вы не заведены ни в одну линию');
    }

    res.json(await openLine.stats(lineIds, { from, to }));
  } catch (err) {
    fail(res, err, 'GET /stats');
  }
});

router.get('/conversations/:id', authenticate, async (req, res) => {
  try {
    res.json(await openLine.getConversation(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'GET /conversations/:id');
  }
});

// Карточка для всплывающего уведомления, когда сигнал пришёл без неё (ver. 9.23):
// его мог отправить процесс забора, запущенный до выката.
router.get('/conversations/:id/card', authenticate, async (req, res) => {
  try {
    res.json(await openLine.conversationCard(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'GET /card');
  }
});

// Оператор досмотрел переписку до конца (ver. 8.27). Зовётся интерфейсом, когда
// чат открыт и вкладка на переднем плане, — иначе отметка означала бы «портал
// был запущен», а не «человек это видел».
router.post('/conversations/:id/read', authenticate, async (req, res) => {
  try {
    res.json(await openLine.markRead(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'POST /read');
  }
});

router.post('/conversations/:id/assign', authenticate, async (req, res) => {
  try {
    res.json(await openLine.assign(req.user.id, req.params.id, req.app.get('io')));
  } catch (err) {
    fail(res, err, 'POST /assign');
  }
});

router.post('/conversations/:id/close', authenticate, async (req, res) => {
  try {
    const topicId = req.body && req.body.topicId ? String(req.body.topicId) : null;
    res.json(await openLine.close(req.user.id, req.params.id, req.app.get('io'), topicId));
  } catch (err) {
    fail(res, err, 'POST /close');
  }
});

router.post('/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });

    const result = await openLine.reply(req.user.id, req.params.id, text, req.app.get('io'));
    // Недоставленное сообщение — не ошибка запроса: оно сохранено в переписке с
    // пометкой, и оператор должен это увидеть, а не получить пустой отказ.
    res.json(result);
  } catch (err) {
    fail(res, err, 'POST /messages');
  }
});

// Файл от оператора: памятка, бланк, схема проезда (ver. 8.09).
router.post('/conversations/:id/files', authenticate, uploadFile, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не приложен' });

    // Имя приходит от multer в latin1 — русские названия иначе превращаются в
    // «Ð¿Ð°Ð¼ÑÑ‚ÐºÐ°.pdf». Тот же приём, что в аккредитациях.
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const result = await openLine.replyWithFile(req.user.id, req.params.id, {
      buffer: req.file.buffer,
      originalName,
      mimetype: req.file.mimetype
    }, String(req.body.caption || '').trim(), req.app.get('io'));

    res.json(result);
  } catch (err) {
    fail(res, err, 'POST /files');
  }
});

// Кому можно передать это обращение: состав его линии и другие линии сети.
router.get('/conversations/:id/transfer-targets', authenticate, async (req, res) => {
  try {
    res.json(await openLine.transferTargets(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'GET /transfer-targets');
  }
});

router.post('/conversations/:id/transfer', authenticate, async (req, res) => {
  try {
    const userId = req.body && req.body.userId;
    const lineId = req.body && req.body.lineId;
    // Передача либо сотруднику своей линии, либо на чужую линию целиком
    // (ver. 9.23) — сотрудника там выберут сами.
    if (lineId) {
      return res.json(await openLine.transferToLine(req.user.id, req.params.id, String(lineId), req.app.get('io')));
    }
    if (!userId) return res.status(400).json({ error: 'Не выбрано, кому передать' });
    res.json(await openLine.transfer(req.user.id, req.params.id, userId, req.app.get('io')));
  } catch (err) {
    fail(res, err, 'POST /transfer');
  }
});

// ── Быстрые ответы ────────────────────────────────────────────────────────
//
// Правит их сам оператор, без администратора: заготовка нужна тому, кто
// отвечает, и правится в тот момент, когда стало ясно, что формулировка не
// работает. Заявка администратору на такое — способ не завести заготовок вовсе.
//
// Поэтому здесь не requireAdmin, а своя проверка: заведён ли человек хоть в
// одну линию. Комплект общий на сеть, так что правка видна всем — это и
// задумано, колл-центр отвечает от лица клиники, а не от своего.

async function requireOperator(req, res, next) {
  try {
    if (req.user.isAdmin) return next();
    const lines = await openLine.linesOfUser(req.user.id);
    if (!lines.length) {
      return res.status(403).json({ error: 'Быстрые ответы правит тот, кто работает на линии', code: 'not_operator' });
    }
    next();
  } catch (err) {
    fail(res, err, 'проверка состава линии');
  }
}

const QUICK_TITLE_MAX = 80;
const QUICK_TEXT_MAX = 4000;

function quickReplyFields(body) {
  const title = String(body && body.title || '').trim();
  const text = String(body && body.text || '').trim();

  // Код 'invalid' в STATUS_BY_CODE не значится и потому даёт 400 — как и должно
  // быть у неверно заполненной формы. Ошибиться здесь легко: 'not_found' рядом
  // выглядит так же, но ответит 404, и человек увидит «не найдено» вместо
  // «название пустое».
  const bad = (message) => new openLine.OpenLineError('invalid', message);

  if (!title) throw bad('У заготовки должно быть название');
  if (!text) throw bad('Пустую заготовку сохранять нечего');
  if (title.length > QUICK_TITLE_MAX) throw bad(`Название длиннее ${QUICK_TITLE_MAX} символов`);
  if (text.length > QUICK_TEXT_MAX) throw bad(`Текст длиннее ${QUICK_TEXT_MAX} символов`);

  return { title, text };
}

router.get('/quick-replies', authenticate, requireOperator, async (req, res) => {
  try {
    res.json(await OmniQuickReply.findAll({ order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] }));
  } catch (err) {
    fail(res, err, 'GET /quick-replies');
  }
});

router.post('/quick-replies', authenticate, requireOperator, async (req, res) => {
  try {
    const { title, text } = quickReplyFields(req.body);
    // Новая заготовка встаёт в конец: место в списке — это про то, как часто ею
    // пользуются, а у только что заведённой такого сведения ещё нет.
    const last = await OmniQuickReply.max('sortOrder');
    res.json(await OmniQuickReply.create({
      title, text,
      sortOrder: Number.isFinite(last) ? last + 1 : 0,
      createdBy: req.user.id,
      updatedBy: req.user.id
    }));
  } catch (err) {
    fail(res, err, 'POST /quick-replies');
  }
});

router.put('/quick-replies/:id', authenticate, requireOperator, async (req, res) => {
  try {
    const row = await OmniQuickReply.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Заготовка не найдена' });

    const { title, text } = quickReplyFields(req.body);
    const patch = { title, text, updatedBy: req.user.id };
    if (req.body.sortOrder !== undefined) patch.sortOrder = Number(req.body.sortOrder) || 0;

    await row.update(patch);
    res.json(row);
  } catch (err) {
    fail(res, err, 'PUT /quick-replies/:id');
  }
});

router.delete('/quick-replies/:id', authenticate, requireOperator, async (req, res) => {
  try {
    const row = await OmniQuickReply.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Заготовка не найдена' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'DELETE /quick-replies/:id');
  }
});

// ── Настройка линий (администратор) ───────────────────────────────────────

// ── Темы обращений (ver. 8.29) ────────────────────────────────────────────
//
// Читают все, кто работает на линии: тему ставит оператор при закрытии, значит
// список нужен ему. Правит старший — тот же, кому открыт архив.
//
// Почему не как быстрые ответы, которые правит кто угодно из состава: там цена
// неудачной правки — одна неудачная формулировка, здесь — рассыпавшийся отчёт
// за квартал. Десять человек, заводящих «Запись», «запись на приём» и «ЗАПИСЬ»,
// получат три строки вместо одной, и сравнить месяцы будет уже нечем.

async function requireSenior(req, res, next) {
  try {
    if (req.user.isAdmin) return next();
    const lines = await openLine.linesOfUser(req.user.id);
    if (!lines.some(r => r.isSenior)) {
      return res.status(403).json({
        error: 'Справочник тем правит старший оператор линии',
        code: 'not_operator'
      });
    }
    next();
  } catch (err) {
    fail(res, err, 'проверка старшинства');
  }
}

router.get('/topics', authenticate, requireOperator, async (req, res) => {
  try {
    // Выключенные отдаём только тому, кто их правит: оператору при закрытии
    // обращения они не нужны, а выбрать их всё равно нельзя.
    const includeHidden = req.query.all === '1'
      && (req.user.isAdmin || (await openLine.linesOfUser(req.user.id)).some(r => r.isSenior));
    res.json(await openLine.listTopics({ includeHidden }));
  } catch (err) {
    fail(res, err, 'GET /topics');
  }
});

router.post('/topics', authenticate, requireSenior, async (req, res) => {
  try {
    res.json(await openLine.createTopic(req.user.id, req.body || {}));
  } catch (err) {
    fail(res, err, 'POST /topics');
  }
});

router.put('/topics/:id', authenticate, requireSenior, async (req, res) => {
  try {
    res.json(await openLine.updateTopic(req.user.id, req.params.id, req.body || {}));
  } catch (err) {
    fail(res, err, 'PUT /topics/:id');
  }
});

router.get('/lines', authenticate, requireAdmin, async (req, res) => {
  try {
    const lines = await OmniLine.findAll({
      include: [
        { model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] },
        {
          model: OmniLineOperator,
          as: 'operators',
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
        },
        {
          model: OmniLineAccessRule,
          as: 'accessRules',
          include: [
            { model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] },
            { model: Role, as: 'role', attributes: ['id', 'name'] }
          ]
        },
        // Исключённые из линии (ver. 9.23) — чтобы их можно было вернуть.
        {
          model: OmniLineExclusion,
          as: 'exclusions',
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
        }
      ],
      order: [['name', 'ASC']]
    });

    const bots = await MessengerBot.findAll({ attributes: ['id', 'platform', 'username', 'organization', 'lineId'] });
    // Справочник медцентров — для выбора при создании линии.
    const medCenters = await MedCenter.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] });
    // Роли — для правил состава (ver. 9.09).
    const roles = await Role.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] });
    const ruleCounts = await openLineAccess.matchedCounts();

    // Кто из состава вообще видит раздел (ver. 8.33). Состав линии даёт право
    // отвечать, но не открывает сам модуль: это отдельный флаг, и человек,
    // заведённый в линию без него, обращений не увидит и о своей роли не
    // узнает. Молча такое расхождение жить не должно — отдаём признак, чтобы
    // администратор видел его прямо в составе.
    const eligible = await User.findAll({
      attributes: ['id'],
      where: { [Op.or]: [{ isAdmin: true }, sequelize.literal(`"adminAccess"->>'openLine' = 'true'`)] }
    });
    const canOpen = new Set(eligible.map(u => u.id));

    res.json({
      lines: lines.map(line => {
        const plain = line.toJSON();
        plain.operators = (plain.operators || []).map(o => ({ ...o, hasAccess: canOpen.has(o.userId) }));
        plain.accessRules = (plain.accessRules || []).map(r => ({ ...r, matchedUsers: ruleCounts.get(r.id) || 0 }));
        return plain;
      }),
      bots,
      medCenters,
      roles
    });
  } catch (err) {
    fail(res, err, 'GET /lines');
  }
});

router.post('/lines', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, medCenterId, offlineReply } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Нужно название линии' });

    const line = await OmniLine.create({ name, medCenterId: medCenterId || null, offlineReply: offlineReply || null });
    res.status(201).json(line);
  } catch (err) {
    fail(res, err, 'POST /lines');
  }
});

router.put('/lines/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const line = await OmniLine.findByPk(req.params.id);
    if (!line) return res.status(404).json({ error: 'Линия не найдена' });

    const { name, medCenterId, offlineReply, isActive, autoCloseHours } = req.body || {};

    // Срок автозакрытия (ver. 9.23): целые часы, 0 — выключено. Потолок —
    // месяц: больше уже не «через сколько закрыть», а «никогда», и для этого
    // есть ноль.
    let hours = line.autoCloseHours;
    if (autoCloseHours !== undefined) {
      hours = Number(autoCloseHours);
      if (!Number.isInteger(hours) || hours < 0 || hours > 720) {
        return res.status(400).json({ error: 'Срок автозакрытия — целое число часов от 0 до 720' });
      }
    }

    await line.update({
      name: name !== undefined ? name : line.name,
      medCenterId: medCenterId !== undefined ? medCenterId : line.medCenterId,
      offlineReply: offlineReply !== undefined ? offlineReply : line.offlineReply,
      isActive: isActive !== undefined ? isActive : line.isActive,
      autoCloseHours: hours
    });
    res.json(line);
  } catch (err) {
    fail(res, err, 'PUT /lines/:id');
  }
});

/**
 * Удаление линии (ver. 8.33). До этого линию можно было только выключить, и
 * выключенные проверочные линии копились в списке навсегда.
 *
 * Линию с обращениями не удаляем. За обращением стоит переписка с пациентом,
 * файлы и закрытые сессии, по которым считается нагрузка и KPI, — всё это
 * привязано к линии обязательным полем, осиротить его нельзя, а удалять вместе с
 * линией значит стирать историю разговоров молча, по нажатию одной кнопки.
 * Выключение для таких линий и остаётся правильным ответом.
 *
 * Что уходит вместе с линией: состав и отработанные смены — они без линии
 * бессмысленны. Боты не удаляются, а отвязываются: бот живёт своей жизнью,
 * у него свой токен и свои подписчики, и он переставляется на другую линию.
 */
router.delete('/lines/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const line = await OmniLine.findByPk(req.params.id);
    if (!line) return res.status(404).json({ error: 'Линия не найдена' });

    const conversations = await OmniConversation.count({ where: { lineId: line.id } });
    if (conversations) {
      // Число отдельно от слова: склонять «обращение» ради одного сообщения —
      // заводить в проекте помощник, которого больше негде применить.
      return res.status(409).json({
        error: `Линия не пуста: обращений — ${conversations}. Вместе с ней удалилась бы ` +
          'переписка с пациентами. Такую линию можно выключить, но не удалить.'
      });
    }

    await sequelize.transaction(async (transaction) => {
      await MessengerBot.update({ lineId: null }, { where: { lineId: line.id }, transaction });
      await OmniLineOperator.destroy({ where: { lineId: line.id }, transaction });
      await OmniShift.destroy({ where: { lineId: line.id }, transaction });
      await line.destroy({ transaction });
    });

    console.log(`[open-line] линия «${line.name}» удалена пользователем ${req.user.username}`);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'DELETE /lines/:id');
  }
});

// Состав линии. Принимает одного (userId) или сразу несколько (userIds, ver.
// 9.09): колл-центр заводят десятком людей подряд, и перезагружать список после
// каждого незачем.
router.post('/lines/:id/operators', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId, userIds } = req.body || {};
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userId]).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: 'Не выбран ни один сотрудник' });

    const line = await OmniLine.findByPk(req.params.id, { attributes: ['id'] });
    if (!line) return res.status(404).json({ error: 'Линия не найдена' });

    await sequelize.transaction(async (transaction) => {
      await OmniLineOperator.bulkCreate(
        ids.map(id => ({ lineId: line.id, userId: id })),
        { ignoreDuplicates: true, transaction }
      );
      // Кто уже был в линии по правилу, теперь заведён и руками: правило его
      // больше не уберёт, даже если он перестанет под него подходить.
      await OmniLineOperator.update(
        { viaRule: false },
        { where: { lineId: line.id, userId: ids, viaRule: true }, transaction }
      );
      // Добавить руками исключённого — значит передумать (ver. 9.23):
      // исключение снимается тем же действием, а не отдельной кнопкой где-то
      // ещё.
      await OmniLineExclusion.destroy({ where: { lineId: line.id, userId: ids }, transaction });
    });
    res.status(201).json({ ok: true, added: ids.length });
  } catch (err) {
    fail(res, err, 'POST /operators');
  }
});

// Старший оператор линии: единственное, что он видит сверх обычного, — архив
// закрытых обращений (ver. 8.10).
router.put('/lines/:id/operators/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const row = await OmniLineOperator.findOne({
      where: { lineId: req.params.id, userId: req.params.userId }
    });
    if (!row) return res.status(404).json({ error: 'Сотрудник не в составе линии' });

    await row.update({ isSenior: !!(req.body && req.body.isSenior) });
    res.json(row);
  } catch (err) {
    fail(res, err, 'PUT /operators/:userId');
  }
});

// Снять сотрудника с линии.
//
// До 9.23 сотрудника, подходящего под правило, убрать было нельзя: правило
// вернуло бы его при первой же синхронизации, и строка просто переходила на
// правило. Широкие правила при этом заводили в линию людей, которым там делать
// нечего, — администраторов со всеми ролями, — и они получали сигналы о
// пациентах и стояли в списке «кому передать». Теперь снятие такого человека
// исключает его из линии: правило мимо него проходит, пока исключение не
// снимут.
//
// Обращения, которые он вёл на этой линии, возвращаются в очередь — иначе они
// остались бы у того, кто их больше не видит.
router.delete('/lines/:id/operators/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const lineId = req.params.id;
    const userId = req.params.userId;
    const excluded = await openLineAccess.matchesLine(lineId, userId);

    await sequelize.transaction(async (transaction) => {
      if (excluded) {
        await OmniLineExclusion.findOrCreate({
          where: { lineId, userId },
          defaults: { lineId, userId, createdBy: req.user.id },
          transaction
        });
      }
      await OmniLineOperator.destroy({ where: { lineId, userId }, transaction });
    });

    const result = await openLine.leaveLine(userId, lineId, req.app.get('io'));
    res.json({ ok: true, excluded, ...result });
  } catch (err) {
    fail(res, err, 'DELETE /operators');
  }
});

// Вернуть исключённого (ver. 9.23): исключение снимается, и правило, если он
// под него подходит, заводит его обратно сразу же — не дожидаясь следующей
// правки карточки.
router.delete('/lines/:id/exclusions/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const removed = await OmniLineExclusion.destroy({
      where: { lineId: req.params.id, userId: req.params.userId }
    });
    if (!removed) return res.status(404).json({ error: 'Сотрудник не исключён из этой линии' });

    const result = await openLineAccess.syncLine(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    fail(res, err, 'DELETE /exclusions');
  }
});

// ── Правила состава (ver. 9.09) ──────────────────────────────────────────────
//
// { roleId?, medCenterId? }; оба сразу — это «И». Сразу после записи правила
// состав линии пересчитывается, поэтому ответ несёт, сколько людей добавилось.
router.post('/lines/:id/access-rules', authenticate, requireAdmin, async (req, res) => {
  try {
    const line = await OmniLine.findByPk(req.params.id, { attributes: ['id', 'name'] });
    if (!line) return res.status(404).json({ error: 'Линия не найдена' });

    const roleId = (req.body && req.body.roleId) || null;
    const medCenterId = (req.body && req.body.medCenterId) || null;
    if (!roleId && !medCenterId) {
      return res.status(400).json({ error: 'Выберите роль, медцентр или оба условия' });
    }

    const [role, medCenter] = await Promise.all([
      roleId ? Role.findByPk(roleId, { attributes: ['id', 'name'] }) : null,
      medCenterId ? MedCenter.findByPk(medCenterId, { attributes: ['id', 'name'] }) : null
    ]);
    if (roleId && !role) return res.status(404).json({ error: 'Роль не найдена' });
    if (medCenterId && !medCenter) return res.status(404).json({ error: 'Медцентр не найден' });

    const [, created] = await OmniLineAccessRule.findOrCreate({
      where: { lineId: line.id, roleId, medCenterId },
      defaults: { lineId: line.id, roleId, medCenterId, createdBy: req.user.id }
    });
    if (!created) return res.status(409).json({ error: 'Такое правило у линии уже есть' });

    const result = await openLineAccess.syncLine(line.id);
    console.log(`[open-line] правило состава «${line.name}»: ${role ? role.name : '—'} × ` +
      `${medCenter ? medCenter.name : '—'}, добавлено ${result.added} (${req.user.username})`);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    fail(res, err, 'POST /access-rules');
  }
});

// Вместе с правилом уходят те, кого в линию завело только оно. Заведённые руками
// и подходящие под другое правило этой линии остаются.
router.delete('/lines/:id/access-rules/:ruleId', authenticate, requireAdmin, async (req, res) => {
  try {
    const removed = await OmniLineAccessRule.destroy({
      where: { id: req.params.ruleId, lineId: req.params.id }
    });
    if (!removed) return res.status(404).json({ error: 'Правило не найдено' });

    const result = await openLineAccess.syncLine(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    fail(res, err, 'DELETE /access-rules');
  }
});

// Какой бот кормит линию. Ботов у медцентра два (Telegram и MAX), и оба обычно
// смотрят в одну линию.
router.put('/lines/:id/bots/:botId', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await MessengerBot.findByPk(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'Бот не найден' });

    await bot.update({ lineId: req.params.id === 'none' ? null : req.params.id });
    res.json(bot);
  } catch (err) {
    fail(res, err, 'PUT /bots');
  }
});

// ── Боты как настройка, а не как скрипт (ver. 8.04) ───────────────────────
//
// До 8.04 бот заводился командой scripts/addMessengerBot.js: токен, организация,
// установка вебхука. Пока модуль вёл программист, это было честнее интерфейса —
// шагов немного, а ошибиться в них негде. Теперь модуль передают человеку,
// который в консоль не ходит, а токены протухают и клиники добавляются.
//
// Порядок тот же, что в скрипте, и по той же причине: сначала проверяем токен у
// платформы, и только потом заводим строку. Бот, которого нет, не должен
// оставлять следа в базе.

// Адрес, по которому платформа стучится к нам. Совпадает с routes/
// messenger-webhook.js — если менять, то в обоих местах.
function botWebhookUrl(bot) {
  const base = (process.env.BASE_URL || 'https://wiki.medcentralfa.ru').replace(/\/+$/, '');
  return `${base}/api/messenger/${bot.platform}/${bot.id}`;
}

// Токен наружу не отдаём: он даёт полный доступ к боту, а интерфейсу нужно лишь
// показать, что он заведён. Хвост оставляем, чтобы отличить один токен от
// другого, не раскрывая его.
const maskToken = (token) => (token ? `…${String(token).slice(-6)}` : '');

/**
 * Переключение режима доставки. Вебхук и getUpdates взаимно исключают друг
 * друга: пока адрес прописан, Telegram отвечает на getUpdates конфликтом —
 * поэтому при переходе на забор вебхук обязательно снимается.
 */
async function applyBotMode(bot, mode) {
  const channel = getChannel(bot.platform);

  if (mode === 'polling') {
    await channel.deleteWebhook(bot.token);
    await bot.update({ deliveryMode: 'polling', isActive: true });
    return { deliveryMode: 'polling', note: 'Вебхук снят. Забор обновлений ведёт отдельный процесс messengerPoller.' };
  }

  await channel.setWebhook(bot.token, botWebhookUrl(bot), bot.webhookSecret);
  await bot.update({ deliveryMode: 'webhook', isActive: true });
  return { deliveryMode: 'webhook', note: `Вебхук установлен на ${botWebhookUrl(bot)}` };
}

router.get('/bots', authenticate, requireAdmin, async (req, res) => {
  try {
    const bots = await MessengerBot.findAll({ order: [['organization', 'ASC'], ['platform', 'ASC']] });

    // Состояние вебхука спрашиваем у платформы: строка в базе говорит, каким
    // режим задумывался, а не каким он получился. Расхождение между ними — самая
    // частая причина «бот молчит», и видно её только отсюда.
    const rows = await Promise.all(bots.map(async (bot) => {
      let webhook;
      try {
        const info = await getChannel(bot.platform).getWebhookInfo(bot.token);
        webhook = {
          url: info.url || '',
          error: info.last_error_message || null,
          pending: info.pending_update_count || 0
        };
      } catch (err) {
        webhook = { url: '', error: err.message, pending: 0 };
      }

      return {
        id: bot.id,
        platform: bot.platform,
        organization: bot.organization,
        username: bot.username,
        title: bot.title,
        deliveryMode: bot.deliveryMode,
        isActive: bot.isActive,
        lineId: bot.lineId,
        misCategoryId: bot.misCategoryId,
        tokenTail: maskToken(bot.token),
        expectedWebhook: botWebhookUrl(bot),
        webhook
      };
    }));

    res.json({ bots: rows });
  } catch (err) {
    fail(res, err, 'GET /bots');
  }
});

router.post('/bots', authenticate, requireAdmin, async (req, res) => {
  try {
    const { token, platform = 'telegram', medCenterId, title, deliveryMode = 'webhook', misCategoryId } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Нужен токен' });

    // Категория подписчика в МИС (ver. 8.08). Спрашивается сразу при заведении:
    // бот без категории работает как обычно, но подписки к нему не доходят до
    // карточек пациентов, а заметить это можно только по счётчику на «Ботах».
    const category = String(misCategoryId ?? '').trim();
    if (category && !/^\d+$/.test(category)) {
      return res.status(400).json({ error: 'Категория МИС — это номер' });
    }

    // Филиал, а не «организация» (ver. 8.05): настраивают филиал, а ключ счёта у
    // провайдера — его свойство. Пустой филиал допустим для проверочного бота:
    // он не обслуживает пациентов, и приписывать его к клинике неверно.
    let organization = 'test';
    if (medCenterId) {
      const mc = await MedCenter.findByPk(medCenterId);
      if (!mc) return res.status(400).json({ error: 'Филиал не найден' });
      organization = mc.botOrganization || mc.code || 'test';
    }
    if (!['telegram', 'max'].includes(platform)) {
      return res.status(400).json({ error: 'Платформа может быть telegram или max' });
    }

    const channel = getChannel(platform);

    // Проверка токена до записи в базу: заводить строку под несуществующего
    // бота значит потом гадать, почему он молчит.
    let me;
    try {
      me = await channel.getMe(String(token).trim());
    } catch (err) {
      return res.status(400).json({ error: `Платформа не приняла токен: ${err.message}` });
    }

    const existing = await MessengerBot.findOne({ where: { token: String(token).trim() } });
    const bot = existing
      ? await existing.update({ platform, organization, medCenterId: medCenterId || null, username: me.username, title: title || me.first_name, misCategoryId: category ? Number(category) : existing.misCategoryId, isActive: true })
      : await MessengerBot.create({
          platform,
          organization,
          medCenterId: medCenterId || null,
          token: String(token).trim(),
          username: me.username,
          title: title || me.first_name,
          misCategoryId: category ? Number(category) : null,
          webhookSecret: crypto.randomBytes(24).toString('hex'),
          isActive: true
        });

    const applied = await applyBotMode(bot, deliveryMode);
    res.status(201).json({ id: bot.id, username: bot.username, ...applied });
  } catch (err) {
    fail(res, err, 'POST /bots');
  }
});

router.put('/bots/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await MessengerBot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Бот не найден' });

    const { deliveryMode, isActive, medCenterId, title, misCategoryId } = req.body || {};

    // Категория подписчика в МИС (ver. 8.08). Пустая строка — это «категории у
    // бота нет», а не ноль: обнулять поле должно быть так же просто, как
    // заполнять, иначе завести её проверочному боту по ошибке будет нечем.
    if (misCategoryId !== undefined) {
      const value = String(misCategoryId).trim();
      if (value && !/^\d+$/.test(value)) {
        return res.status(400).json({ error: 'Категория МИС — это номер' });
      }
      await bot.update({ misCategoryId: value ? Number(value) : null });
    }

    if (medCenterId !== undefined || title !== undefined) {
      const patch = { title: title !== undefined ? title : bot.title };

      if (medCenterId !== undefined) {
        patch.medCenterId = medCenterId || null;
        // Организация следует за филиалом: она его свойство, а не отдельная
        // настройка, и разъехаться они не должны.
        const mc = medCenterId ? await MedCenter.findByPk(medCenterId) : null;
        patch.organization = mc ? (mc.botOrganization || mc.code || 'test') : 'test';
      }

      await bot.update(patch);
    }

    let applied = {};
    if (deliveryMode && deliveryMode !== bot.deliveryMode) {
      applied = await applyBotMode(bot, deliveryMode);
    }

    // Выключение снимает вебхук: иначе платформа продолжит стучаться, а мы
    // будем молча отбрасывать её обновления — и они у неё копятся.
    if (isActive === false) {
      try { await getChannel(bot.platform).deleteWebhook(bot.token); } catch { /* платформа могла быть недоступна */ }
      await bot.update({ isActive: false });
    } else if (isActive === true) {
      await bot.update({ isActive: true });
    }

    res.json({ ok: true, ...applied });
  } catch (err) {
    fail(res, err, 'PUT /bots/:id');
  }
});

router.delete('/bots/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const bot = await MessengerBot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Бот не найден' });

    // Вебхук снимаем до удаления строки: после неё адрес станет ничьим, а
    // платформа продолжит по нему стучаться.
    try { await getChannel(bot.platform).deleteWebhook(bot.token); } catch { /* платформа могла быть недоступна */ }

    // Подписчики остаются: это живые люди, нажавшие «поделиться контактом», и
    // терять их вместе с ботом нельзя — бот заводят заново с тем же токеном, и
    // подписки должны найтись.
    await bot.destroy();
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'DELETE /bots/:id');
  }
});

module.exports = router;
