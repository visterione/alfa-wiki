'use strict';

/**
 * Открытая линия: API оператора и настройка линий (ver. 7.85).
 *
 * Доступ к работе даёт состав линии, а не отдельное право: кто заведён в линию,
 * тот и отвечает. Настройка самих линий — за администратором.
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { OmniLine, OmniLineOperator, MessengerBot, MedCenter, User } = require('../models');
const openLine = require('../services/openLine');
const fileAccess = require('../services/fileAccess');
const { getChannel } = require('../services/messengers');
const crypto = require('crypto');

const router = express.Router();

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
    const result = on ? await openLine.startDay(req.user.id) : await openLine.endDay(req.user.id);
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
    res.json(await openLine.listConversations(req.user.id, { scope, limit, offset, q }));
  } catch (err) {
    fail(res, err, 'GET /conversations');
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

router.post('/conversations/:id/assign', authenticate, async (req, res) => {
  try {
    res.json(await openLine.assign(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'POST /assign');
  }
});

router.post('/conversations/:id/close', authenticate, async (req, res) => {
  try {
    res.json(await openLine.close(req.user.id, req.params.id));
  } catch (err) {
    fail(res, err, 'POST /close');
  }
});

router.post('/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });

    const result = await openLine.reply(req.user.id, req.params.id, text);
    // Недоставленное сообщение — не ошибка запроса: оно сохранено в переписке с
    // пометкой, и оператор должен это увидеть, а не получить пустой отказ.
    res.json(result);
  } catch (err) {
    fail(res, err, 'POST /messages');
  }
});

// ── Настройка линий (администратор) ───────────────────────────────────────

router.get('/lines', authenticate, requireAdmin, async (req, res) => {
  try {
    const lines = await OmniLine.findAll({
      include: [
        { model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] },
        {
          model: OmniLineOperator,
          as: 'operators',
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
        }
      ],
      order: [['name', 'ASC']]
    });

    const bots = await MessengerBot.findAll({ attributes: ['id', 'platform', 'username', 'organization', 'lineId'] });
    // Справочник медцентров — для выбора при создании линии.
    const medCenters = await MedCenter.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] });
    res.json({ lines, bots, medCenters });
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

    const { name, medCenterId, offlineReply, isActive } = req.body || {};
    await line.update({
      name: name !== undefined ? name : line.name,
      medCenterId: medCenterId !== undefined ? medCenterId : line.medCenterId,
      offlineReply: offlineReply !== undefined ? offlineReply : line.offlineReply,
      isActive: isActive !== undefined ? isActive : line.isActive
    });
    res.json(line);
  } catch (err) {
    fail(res, err, 'PUT /lines/:id');
  }
});

// Состав линии
router.post('/lines/:id/operators', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Нужен userId' });

    const [row] = await OmniLineOperator.findOrCreate({
      where: { lineId: req.params.id, userId },
      defaults: { lineId: req.params.id, userId }
    });
    res.status(201).json(row);
  } catch (err) {
    fail(res, err, 'POST /operators');
  }
});

router.delete('/lines/:id/operators/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    await OmniLineOperator.destroy({ where: { lineId: req.params.id, userId: req.params.userId } });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'DELETE /operators');
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
    const { token, platform = 'telegram', medCenterId, title, deliveryMode = 'webhook' } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Нужен токен' });

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
      ? await existing.update({ platform, organization, medCenterId: medCenterId || null, username: me.username, title: title || me.first_name, isActive: true })
      : await MessengerBot.create({
          platform,
          organization,
          medCenterId: medCenterId || null,
          token: String(token).trim(),
          username: me.username,
          title: title || me.first_name,
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

    const { deliveryMode, isActive, medCenterId, title } = req.body || {};

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
