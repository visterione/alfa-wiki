'use strict';

/**
 * Открытая линия: обращения пациентов из ботов (ver. 7.85, переработана в 7.99).
 *
 * Правила взяты из того, к чему колл-центр привык по Битриксу, и намеренно
 * простые:
 *
 *   • на каждый медцентр своя линия со своим составом сотрудников;
 *   • новые обращения видит только тот, кто начал смену. Кнопка одна: сотрудник,
 *     заведённый в нескольких линиях, открывает их все сразу и разбирает общую
 *     очередь;
 *   • закончил смену — незакрытые обращения возвращаются в очередь. Иначе взявший
 *     чат и ушедший домой унесёт его с собой;
 *   • если на линии нет никого, бот отвечает сам — один раз за обращение.
 *
 * Доступ определяется составом линии, отдельного права нет: список сотрудников
 * линии и есть право. Два места настройки одного и того же разошлись бы.
 *
 * ── Что изменилось в 7.99 ────────────────────────────────────────────────
 *
 * Переписка с человеком стала вечной, а обращение — сессией внутри неё. Раньше
 * это было одно и то же: закрыли вопрос, человек написал через неделю снова —
 * и оператор получал пустой чат без единой строки предыстории, а в архиве
 * лежало по десятку отдельных кусков одного и того же разговора. Теперь чат у
 * собеседника один и содержит всё; сессии остались для учёта — по ним считаются
 * оценка работы оператора и доля разобранных обращений.
 *
 * Переписки разных мессенджеров намеренно не сводятся: подписчик заведён на пару
 * «платформа + организация», и один человек в Telegram и в MAX — это два
 * подписчика. Общего идентификатора у платформ нет, а телефон есть не у всех.
 */

const { Op } = require('sequelize');
const {
  OmniLine, OmniLineOperator, OmniConversation, OmniSession, OmniShift, OmniMessage,
  OmniTopic, BotSubscriber, MessengerBot, MedCenter, User, sequelize
} = require('../models');
const { getChannel } = require('./messengers');
const events = require('./openLineEvents');
const patients = require('./openLinePatient');
const files = require('./openLineFiles');

const DEFAULT_OFFLINE_REPLY =
  'Сейчас все операторы заняты или смена завершена. ' +
  'Мы видим ваше сообщение и ответим, как только линия откроется.';

const RATING_REQUEST =
  'Спасибо за обращение! Оцените, пожалуйста, работу сотрудника — от 1 до 5.';

class OpenLineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OpenLineError';
    this.code = code; // not_operator | not_found | not_yours | already_taken
  }
}

/**
 * Сообщить операторам, что с обращением что-то произошло (ver. 8.27).
 *
 * Два события на весь модуль: «пришло от пациента» и «изменилось». Больше не
 * нужно — интерфейс на любое из них делает одно и то же, перечитывает список, а
 * звук отличает по тому, чьё это обращение. Дробить события по действиям
 * означало бы заводить на клиенте разбор, который ничего не меняет.
 *
 * @param {Object|null} io  сокет-сервер; пусто, когда мы в процессе забора
 *   обновлений — тогда сигнал уйдёт через базу (см. openLineEvents)
 * @param {string[]} [also]  кого оповестить сверх состава смены
 */
async function announce(io, conversation, event, extra = {}, also = []) {
  const userIds = await events.recipients(conversation, also);
  await events.publish(io, userIds, event, {
    conversationId: conversation.id,
    lineId: conversation.lineId,
    status: conversation.status,
    assigneeUserId: conversation.assigneeUserId || null,
    ...extra
  });
}

// ── Смена ─────────────────────────────────────────────────────────────────

async function linesOfUser(userId) {
  return OmniLineOperator.findAll({
    where: { userId },
    include: [{ model: OmniLine, as: 'line', where: { isActive: true } }]
  });
}

/**
 * Начать смену: открывает сразу все линии сотрудника — очередь у него общая.
 *
 * Отдельная запись смены нужна для KPI: доля разобранных обращений считается от
 * того, что пришло, пока человек был на линии. Поля на связи «сотрудник —
 * линия» для этого не хватает, оно стирается следующим «закончить смену».
 */
async function startDay(userId) {
  const now = new Date();

  return sequelize.transaction(async (tx) => {
    const rows = await OmniLineOperator.findAll({ where: { userId, onShift: false }, transaction: tx });
    if (rows.length) {
      await OmniLineOperator.update(
        { onShift: true, shiftStartedAt: now },
        { where: { userId, onShift: false }, transaction: tx }
      );
      await OmniShift.bulkCreate(
        rows.map(r => ({ lineId: r.lineId, userId, startedAt: now })),
        { transaction: tx }
      );
    }
    return { onShift: true, since: now };
  });
}

/**
 * Закончить смену. Всё, что человек взял, но не закрыл, возвращается в очередь:
 * иначе обращение уедет домой вместе с ним и пациент останется без ответа.
 * Само обращение при этом не закрывается — оно продолжается, просто уже ничьё.
 */
async function endDay(userId, io = null) {
  const now = new Date();

  const returned = await sequelize.transaction(async (tx) => {
    await OmniLineOperator.update(
      { onShift: false, shiftStartedAt: null },
      { where: { userId }, transaction: tx }
    );
    await OmniShift.update(
      { endedAt: now },
      { where: { userId, endedAt: null }, transaction: tx }
    );

    const open = await OmniConversation.findAll({
      where: { assigneeUserId: userId, status: 'assigned' },
      attributes: ['id', 'lineId'],
      transaction: tx
    });

    if (open.length) {
      const ids = open.map(c => c.id);
      await OmniConversation.update(
        { status: 'queued', assigneeUserId: null, assignedAt: null },
        { where: { id: { [Op.in]: ids } }, transaction: tx }
      );
      // Сессия остаётся открытой и тоже становится ничьей: обращение доведёт
      // другой человек, и засчитано оно должно быть ему.
      await OmniSession.update(
        { assigneeUserId: null, assignedAt: null },
        { where: { conversationId: { [Op.in]: ids }, closedAt: null }, transaction: tx }
      );
    }

    return open.map(c => c.get({ plain: true }));
  });

  // Сигнал — после фиксации, а не внутри неё: оператор, увидевший обращение в
  // очереди раньше, чем оно там оказалось, откроет пустоту.
  //
  // Оповещается и сам уходящий: эти чаты сейчас у него на экране, и он должен
  // увидеть, что они больше не его.
  for (const row of returned) {
    await announce(io, { id: row.id, lineId: row.lineId, status: 'queued', assigneeUserId: null },
      'openline:changed', {}, [userId]);
  }

  return { onShift: false, returnedToQueue: returned.length };
}

async function shiftState(userId) {
  const rows = await linesOfUser(userId);
  const onShift = rows.some(r => r.onShift);
  const lineIds = rows.map(r => r.lineId);
  const openLineIds = rows.filter(r => r.onShift).map(r => r.lineId);

  // Счётчики нужны виджету в шапке: смысл начинать смену виден по числу в
  // очереди, а не по одному лишь переключателю.
  const [queue, mine] = await Promise.all([
    openLineIds.length
      ? OmniConversation.count({ where: { lineId: { [Op.in]: openLineIds }, status: 'queued' } })
      : 0,
    OmniConversation.count({ where: { assigneeUserId: userId, status: 'assigned' } })
  ]);

  return {
    isOperator: rows.length > 0,
    onShift,
    since: onShift ? rows.find(r => r.onShift).shiftStartedAt : null,
    queue,
    mine,
    // Старший хотя бы на одной линии — значит вкладку «Архив» ему показывать
    // (ver. 8.10). Интерфейс узнаёт это отсюда, а не гадает по составу.
    canSeeArchive: rows.some(r => r.isSenior),
    lines: rows.map(r => ({ id: r.lineId, name: r.line.name, onShift: r.onShift, isSenior: r.isSenior })),
    lineIds
  };
}

// ── Входящее сообщение ────────────────────────────────────────────────────

/**
 * Кладёт сообщение пациента в переписку: продолжает открытое обращение или
 * заводит новое в том же чате. Вызывается из разговора с ботом и живёт в
 * процессе забора обновлений, поэтому ничего не знает ни про HTTP, ни про
 * сокеты.
 *
 * @returns {Promise<{conversation, session, message, isNew}|null>} null — если
 *   бот не привязан к линии (например проверочный): тогда обращению просто
 *   некуда лечь.
 */
async function acceptIncoming({ bot, subscriber, text, attachments = [], externalMessageId }) {
  if (!bot.lineId) return null;

  const line = await OmniLine.findByPk(bot.lineId);
  if (!line || !line.isActive) return null;

  const now = new Date();

  const result = await sequelize.transaction(async (tx) => {
    let conversation = await OmniConversation.findOne({
      where: { subscriberId: subscriber.id },
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });

    if (!conversation) {
      conversation = await OmniConversation.create({
        lineId: line.id,
        subscriberId: subscriber.id,
        botId: bot.id,
        status: 'queued',
        lastMessageAt: now,
        lastIncomingAt: now
      }, { transaction: tx });
    } else {
      // Линию и бота переписываем: бота могли перепривязать к другой линии, и
      // старый вопрос не должен утащить новый в чужую очередь.
      const patch = { lineId: line.id, botId: bot.id, lastMessageAt: now, lastIncomingAt: now };
      if (conversation.status === 'closed') {
        patch.status = 'queued';
        patch.assigneeUserId = null;
        patch.assignedAt = null;
        patch.closedAt = null;
        patch.closedBy = null;
      }
      await conversation.update(patch, { transaction: tx });
    }

    let session = await OmniSession.findOne({
      where: { conversationId: conversation.id, closedAt: null },
      order: [['openedAt', 'DESC']],
      transaction: tx
    });

    const isNew = !session;
    if (isNew) {
      session = await OmniSession.create({
        conversationId: conversation.id,
        lineId: line.id,
        botId: bot.id,
        openedAt: now
      }, { transaction: tx });
    }

    const message = await OmniMessage.create({
      conversationId: conversation.id,
      sessionId: session.id,
      direction: 'in',
      text: text || '',
      attachments,
      externalMessageId
    }, { transaction: tx });

    return { conversation, session, message, isNew };
  });

  // Карточка МИС — уже после того, как сообщение легло: поход в МИС не должен
  // задерживать доставку вопроса оператору и тем более терять его при отказе.
  await patients.refresh(subscriber);

  // Сигнал операторам (ver. 8.27). io здесь нет и быть не может: мы в процессе
  // забора обновлений, он уйдёт через базу.
  await announce(null, result.conversation, 'openline:incoming', { isNew: result.isNew });

  return { ...result, line };
}

/**
 * Есть ли кому отвечать прямо сейчас. Нужно, чтобы решить, извиняться ли за
 * отсутствие людей.
 */
async function hasOperatorsOnShift(lineId) {
  const count = await OmniLineOperator.count({ where: { lineId, onShift: true } });
  return count > 0;
}

/**
 * Извинение за пустую линию — не чаще одного раза за обращение. Человек,
 * написавший ночью три строки, не должен получить три одинаковых ответа. Отметка
 * живёт на сессии, а не на переписке: вернувшийся через месяц открывает новое
 * обращение и извинение должно прийти снова.
 * @returns {Promise<string|null>} текст, который нужно отправить, или null
 */
async function offlineNoticeFor(session, line) {
  if (!session || session.offlineNoticeAt) return null;
  if (await hasOperatorsOnShift(line.id)) return null;

  await session.update({ offlineNoticeAt: new Date() });
  return line.offlineReply || DEFAULT_OFFLINE_REPLY;
}

// ── Работа оператора ──────────────────────────────────────────────────────

async function operatorLineIds(userId) {
  const rows = await OmniLineOperator.findAll({
    where: { userId },
    attributes: ['lineId', 'onShift', 'isSenior']
  });
  return {
    all: rows.map(r => r.lineId),
    onShift: rows.filter(r => r.onShift).map(r => r.lineId),
    // Линии, где человек старший. Архив показывается только по ним, а не по
    // всем его линиям: старший в одном филиале не получает права разбирать
    // переписку соседнего.
    senior: rows.filter(r => r.isSenior).map(r => r.lineId)
  };
}

const SUBSCRIBER_FIELDS = [
  'id', 'platform', 'phone', 'firstName', 'lastName', 'username', 'patientIds',
  'patientCard', 'patientName', 'patientBirthDate', 'patientMisId', 'isBlocked'
];

function conversationInclude(search) {
  const q = (search || '').trim();
  const like = { [Op.iLike]: `%${q}%` };

  return [
    { model: OmniLine, as: 'line', include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }] },
    {
      model: BotSubscriber,
      as: 'subscriber',
      attributes: SUBSCRIBER_FIELDS,
      required: Boolean(q),
      // Ищем по тому, что оператор видит в строке списка: ФИО из карточки,
      // телефон, имя в мессенджере. Цифры телефона сравниваем без разделителей —
      // человек набирает их как привык, а хранится нормализованный вид.
      where: q ? {
        [Op.or]: [
          { patientName: like },
          { patientCard: like },
          { phone: { [Op.iLike]: `%${q.replace(/\D/g, '')}%` } },
          { firstName: like },
          { lastName: like },
          { username: like }
        ]
      } : undefined
    },
    { model: User, as: 'assignee', attributes: ['id', 'username', 'displayName', 'avatar'] }
  ];
}

/**
 * Условие выборки для каждого из трёх списков. Вынесено отдельно, потому что по
 * нему же считаются счётчики на вкладках: разойтись им нельзя, иначе на вкладке
 * будет число, не совпадающее с тем, что в ней лежит.
 */
function scopeWhere(userId, scope, lines) {
  if (scope === 'mine') return { assigneeUserId: userId, status: 'assigned' };
  if (scope === 'closed') return { lineId: { [Op.in]: lines.senior }, status: 'closed' };
  return { lineId: { [Op.in]: lines.onShift }, status: 'queued' };
}

/**
 * Списки для экрана оператора:
 *   queue  — ничьи обращения линий, где человек сейчас на смене
 *   mine   — взятые им
 *   closed — архив линий, где он старший оператор (ver. 8.10)
 *
 * Счётчики возвращаются вместе со списком, а не отдельным запросом. Так они
 * нужны интерфейсу: числа стоят на всех трёх вкладках сразу, а не только на
 * открытой, — иначе вкладка «Очередь» молчит ровно тогда, когда в очереди
 * что-то появилось. Отдельный запрос за счётчиками означал бы второй поход в
 * базу каждые пять секунд ради тех же самых строк.
 *
 * Считаем без учёта поиска: счётчик отвечает на вопрос «сколько там всего», а
 * не «сколько нашлось по фамилии Иванов». Иначе набранная в поиске буква
 * обнуляла бы соседние вкладки.
 */
async function listConversations(userId, { scope = 'queue', limit = 50, offset = 0, q = '' } = {}) {
  const lines = await operatorLineIds(userId);
  if (!lines.all.length) throw new OpenLineError('not_operator', 'Вы не заведены ни в одну линию');

  // Архив закрыт для тех, кто не старший ни на одной линии. Проверка на
  // сервере, а не только скрытая вкладка: вкладку прячет интерфейс, а адрес
  // запроса подобрать несложно.
  if (scope === 'closed' && !lines.senior.length) {
    throw new OpenLineError('not_operator', 'Архив обращений доступен старшему оператору линии');
  }

  const rows = await OmniConversation.findAll({
    where: scopeWhere(userId, scope, lines),
    include: conversationInclude(q),
    order: [['lastMessageAt', 'DESC']],
    limit,
    offset,
    subQuery: false
  });

  const counts = {
    queue: lines.onShift.length
      ? await OmniConversation.count({ where: scopeWhere(userId, 'queue', lines) })
      : 0,
    mine: await OmniConversation.count({ where: scopeWhere(userId, 'mine', lines) }),
    // Архив не считаем вовсе, когда его не видно: и запрос лишний, и число,
    // которое некому показать.
    closed: lines.senior.length
      ? await OmniConversation.count({ where: scopeWhere(userId, 'closed', lines) })
      : 0,
    // Сколько взятых обращений ждут ответа (ver. 8.27). Число отдельное от
    // counts.mine, а не вместо него: на вкладке «Мои» стоит, сколько у человека
    // всего, и подменять это непрочитанным значило бы менять смысл числа на
    // ходу. Интерфейсу оно нужно для точки на вкладке — чтобы реплика пациента
    // не прошла мимо того, кто стоит в «Очереди».
    mineUnread: await countUnreadMine(userId)
  };

  // Строка списка показывает последнюю реплику — как в мессенджере. Одним
  // запросом на всю страницу, а не по запросу на строку.
  return { items: await withPreviews(rows, userId), counts, canSeeArchive: lines.senior.length > 0 };
}

/**
 * Сколько взятых обращений ждут ответа: в них есть входящее позже отметки
 * прочтения.
 *
 * Считаются обращения, а не сообщения: на вкладке нужен ответ на «есть ли
 * что-то новое», а десять реплик одного пациента — это один разговор, к
 * которому надо вернуться, а не десять дел.
 */
async function countUnreadMine(userId) {
  const [row] = await sequelize.query(`
    SELECT COUNT(*)::int AS n
    FROM omni_conversations c
    WHERE c."assigneeUserId" = :userId
      AND c.status = 'assigned'
      AND c."lastIncomingAt" IS NOT NULL
      AND (c."operatorReadAt" IS NULL OR c."lastIncomingAt" > c."operatorReadAt")
  `, { replacements: { userId }, type: sequelize.QueryTypes.SELECT });

  return row ? row.n : 0;
}

/**
 * Последнее сообщение каждой переписки. DISTINCT ON — то, ради чего здесь сырой
 * SQL: коррелированный подзапрос на полсотни строк Sequelize собирает в полсотни
 * запросов.
 */
async function withPreviews(rows, userId) {
  if (!rows.length) return [];

  const ids = rows.map(r => r.id);
  const last = await sequelize.query(`
    SELECT DISTINCT ON ("conversationId")
           "conversationId", direction, text, attachments, "createdAt"
    FROM omni_messages
    WHERE "conversationId" IN (:ids)
      -- Служебные отметки (передача чата) в превью не годятся: строка списка
      -- отвечает на вопрос «о чём там разговор», а не «что мы с этим делали».
      AND direction <> 'sys'
    ORDER BY "conversationId", "createdAt" DESC
  `, { replacements: { ids }, type: sequelize.QueryTypes.SELECT });

  const byId = new Map(last.map(m => [m.conversationId, m]));

  // Непрочитанное считается только по своим обращениям (ver. 8.27). В очереди
  // непрочитано всё по определению — она и так помечена как новое; в архиве
  // читать нечего. А чужой взятый чат подсвечивать чужим непрочитанным просто
  // неверно: это не вам не ответили.
  const mine = rows.filter(r => r.assigneeUserId && String(r.assigneeUserId) === String(userId)).map(r => r.id);
  const unread = mine.length
    ? await sequelize.query(`
      SELECT m."conversationId", COUNT(*)::int AS unread
      FROM omni_messages m
      JOIN omni_conversations c ON c.id = m."conversationId"
      WHERE m."conversationId" IN (:mine)
        AND m.direction = 'in'
        AND (c."operatorReadAt" IS NULL OR m."createdAt" > c."operatorReadAt")
      GROUP BY m."conversationId"
    `, { replacements: { mine }, type: sequelize.QueryTypes.SELECT })
    : [];
  const unreadById = new Map(unread.map(r => [r.conversationId, r.unread]));

  return rows.map(row => {
    const plain = row.get({ plain: true });
    const m = byId.get(row.id);
    plain.preview = m
      ? {
        direction: m.direction,
        text: m.text || ((m.attachments || []).length ? 'Вложение' : ''),
        createdAt: m.createdAt
      }
      : null;
    plain.unread = unreadById.get(row.id) || 0;
    return plain;
  });
}

async function loadForOperator(userId, conversationId) {
  const conversation = await OmniConversation.findByPk(conversationId, { include: conversationInclude() });
  if (!conversation) throw new OpenLineError('not_found', 'Обращение не найдено');

  const lines = await operatorLineIds(userId);
  if (!lines.all.includes(conversation.lineId)) {
    throw new OpenLineError('not_operator', 'Вы не работаете на этой линии');
  }
  return conversation;
}

/**
 * Переписка целиком: все сообщения за всё время и перечень обращений, по
 * которому в ленте рисуются разделители. Ради этого весь передел и делался —
 * оператор должен видеть, о чём с человеком говорили раньше.
 */
async function getConversation(userId, conversationId) {
  const conversation = await loadForOperator(userId, conversationId);

  const [messages, sessions] = await Promise.all([
    OmniMessage.findAll({
      where: { conversationId },
      include: [{ model: User, as: 'author', attributes: ['id', 'username', 'displayName', 'avatar'] }],
      order: [['createdAt', 'ASC']]
    }),
    OmniSession.findAll({
      where: { conversationId },
      include: [{ model: User, as: 'assignee', attributes: ['id', 'username', 'displayName', 'avatar'] }],
      order: [['openedAt', 'ASC']]
    })
  ]);

  return { conversation, messages, sessions };
}

async function currentSession(conversationId, transaction) {
  return OmniSession.findOne({
    where: { conversationId, closedAt: null },
    order: [['openedAt', 'DESC']],
    transaction
  });
}

/**
 * Взять в работу. Пока обращение ничьё, оно видно всем на смене; после — отвечает
 * один человек, иначе на один вопрос прилетит три ответа.
 */
async function assign(userId, conversationId, io = null) {
  const conversation = await loadForOperator(userId, conversationId);

  const [changed] = await OmniConversation.update(
    // Взял — значит прочитал: обращение открывают, читают и только потом
    // забирают. Без этой отметки взятый чат тут же загорелся бы непрочитанным
    // (ver. 8.27).
    { status: 'assigned', assigneeUserId: userId, assignedAt: new Date(), operatorReadAt: new Date() },
    { where: { id: conversationId, status: 'queued' } }
  );

  if (!changed) {
    // Кто-то успел раньше — сообщаем честно, а не молча перехватываем.
    if (conversation.assigneeUserId && conversation.assigneeUserId !== userId) {
      throw new OpenLineError('already_taken', 'Обращение уже взято другим сотрудником');
    }
  } else {
    const session = await currentSession(conversationId);
    if (session) await session.update({ assigneeUserId: userId, assignedAt: new Date() });
  }

  const fresh = await loadForOperator(userId, conversationId);
  // Соседям по смене обращение должно пропасть из очереди сразу, а не через
  // такт опроса: пока оно там висит, его пробуют взять второй раз.
  if (changed) await announce(io, fresh, 'openline:changed');
  return fresh;
}

// ── Темы обращений (ver. 8.29) ────────────────────────────────────────────

/**
 * Тема по идентификатору — только из действующих.
 *
 * Выключенную поставить нельзя, хотя ссылки на неё в прошлых обращениях
 * остаются: справочник правят ради того, чтобы новое перестало попадать в
 * отмершую строку отчёта, а не ради переписывания истории.
 */
/**
 * Нужно ли требовать тему у этого закрытия.
 *
 * Отдельной функцией, потому что правило здесь неочевидное и ошибиться в нём
 * дорого: тема обязательна — но ровно до тех пор, пока есть из чего выбирать.
 * Справочник, выключенный до последней строки, иначе запер бы линию: закрыть
 * нельзя, а обращения идут.
 *
 * @param {boolean} hasSession  есть ли открытое обращение. У переписки без него
 *   закрывать нечего: тема относится к обращению, а не к чату.
 * @param {boolean} hasTopic  тема выбрана и действует
 * @param {number} activeTopics  сколько тем сейчас в справочнике
 */
function topicRequired({ hasSession, hasTopic, activeTopics }) {
  return Boolean(hasSession) && !hasTopic && activeTopics > 0;
}

async function resolveTopic(topicId) {
  if (!topicId) return null;
  return OmniTopic.findOne({ where: { id: topicId, isActive: true } });
}

async function listTopics({ includeHidden = false } = {}) {
  return OmniTopic.findAll({
    where: includeHidden ? {} : { isActive: true },
    order: [['sortOrder', 'ASC'], ['name', 'ASC']]
  });
}

async function createTopic(userId, { name, sortOrder }) {
  const title = String(name || '').trim();
  if (!title) throw new OpenLineError('not_found', 'Название темы пустое');

  // Порядок по умолчанию — в конец с запасом, кратно десяти: так между двумя
  // соседними темами можно вставить третью, не переписывая весь справочник.
  const last = await OmniTopic.max('sortOrder');
  return OmniTopic.create({
    name: title.slice(0, 80),
    sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : (Number(last) || 0) + 10,
    createdBy: userId,
    updatedBy: userId
  });
}

async function updateTopic(userId, id, { name, sortOrder, isActive }) {
  const topic = await OmniTopic.findByPk(id);
  if (!topic) throw new OpenLineError('not_found', 'Тема не найдена');

  const patch = { updatedBy: userId };
  if (name !== undefined) {
    const title = String(name).trim();
    if (!title) throw new OpenLineError('not_found', 'Название темы пустое');
    patch.name = title.slice(0, 80);
  }
  if (sortOrder !== undefined && Number.isFinite(Number(sortOrder))) patch.sortOrder = Number(sortOrder);
  if (isActive !== undefined) patch.isActive = Boolean(isActive);

  await topic.update(patch);
  return topic;
}

/**
 * Просьба оценить работу. Отправляется только если человеку успели ответить:
 * обращение, закрытое без единой реплики оператора, оценивать нечем, а вопрос
 * «как вам наша работа» после молчания выглядит издевательством.
 */
async function askRating(conversation, session) {
  if (!session || session.ratingAskedAt || !session.firstReplyAt) return;

  const bot = await MessengerBot.findByPk(conversation.botId);
  const subscriber = await BotSubscriber.findByPk(conversation.subscriberId);
  if (!bot || !subscriber || subscriber.isBlocked) return;

  try {
    const channel = getChannel(bot.platform);
    await channel.sendText(bot, subscriber.externalUserId, RATING_REQUEST, {
      buttons: [[1, 2, 3, 4, 5].map(n => ({ text: String(n), data: `rate:${session.id}:${n}` }))]
    });
    await session.update({ ratingAskedAt: new Date() });
  } catch (err) {
    // Не доставили — не беда: оценка добровольная, а обращение уже закрыто.
    console.error(`[open-line] просьба об оценке (сессия ${session.id}):`, err.message);
  }
}

async function close(userId, conversationId, io = null, topicId = null) {
  const conversation = await loadForOperator(userId, conversationId);
  if (conversation.status === 'closed') return conversation;

  const now = new Date();
  const session = await currentSession(conversationId);

  // Тема обязательна, но ровно до тех пор, пока есть из чего выбирать
  // (ver. 8.29). Проверка «а заведена ли хоть одна» здесь не перестраховка: без
  // неё выключенный до последней темы справочник запер бы линию — закрыть
  // нельзя, а обращения идут.
  const topic = await resolveTopic(topicId);
  const required = topicRequired({
    hasSession: Boolean(session),
    hasTopic: Boolean(topic),
    activeTopics: await OmniTopic.count({ where: { isActive: true } })
  });
  if (required) throw new OpenLineError('topic_required', 'Выберите тему обращения');

  await conversation.update({
    status: 'closed',
    closedAt: now,
    closedBy: userId,
    assigneeUserId: conversation.assigneeUserId || userId
  });

  if (session) {
    await session.update({
      closedAt: now,
      closedBy: userId,
      assigneeUserId: session.assigneeUserId || userId,
      topicId: topic ? topic.id : null
    });
    await askRating(conversation, session);
  }

  await announce(io, conversation, 'openline:changed');
  return conversation;
}

/**
 * Оценка пациента кнопкой в боте. Переписывать разрешаем: человек мог промахнуться
 * по соседней цифре, а отозвать нажатие в мессенджере нечем.
 */
async function rate(sessionId, score) {
  const value = Number(score);
  if (!Number.isInteger(value) || value < 1 || value > 5) return null;

  const session = await OmniSession.findByPk(sessionId);
  if (!session) return null;

  await session.update({ rating: value, ratedAt: new Date() });
  return session;
}

/**
 * Ответ оператора. Сначала отправляем в мессенджер и только потом сохраняем:
 * сообщение, которое не ушло, не должно висеть в переписке как отправленное.
 */
/**
 * Общее начало любого ответа — текстом или файлом.
 *
 * Проверки и взятие в работу вынесены сюда, потому что расходиться им нельзя:
 * ветка, где файл уходит пациенту в закрытом обращении или в чужом чате, — это
 * та же ошибка, что и для текста, только найденная позже.
 */
async function prepareReply(userId, conversationId) {
  const conversation = await loadForOperator(userId, conversationId);

  if (conversation.status === 'closed') {
    throw new OpenLineError('not_yours', 'Обращение закрыто — дождитесь нового сообщения от пациента');
  }
  if (conversation.assigneeUserId && conversation.assigneeUserId !== userId) {
    throw new OpenLineError('not_yours', 'Обращение ведёт другой сотрудник');
  }

  const session = await currentSession(conversationId);

  // Ответ без взятия в работу — это и есть взятие: иначе чат остаётся ничьим.
  if (!conversation.assigneeUserId) {
    await conversation.update({
      status: 'assigned', assigneeUserId: userId, assignedAt: new Date(), operatorReadAt: new Date()
    });
    if (session && !session.assigneeUserId) await session.update({ assigneeUserId: userId, assignedAt: new Date() });
  }

  const subscriber = await BotSubscriber.findByPk(conversation.subscriberId);
  const bot = await MessengerBot.findByPk(conversation.botId);
  if (!bot) throw new OpenLineError('not_found', 'Бот этого обращения больше не подключён');

  return { conversation, session, subscriber, bot, channel: getChannel(bot.platform) };
}

/**
 * Записывает исход отправки в переписку. Недоставленное сохраняется наравне с
 * ушедшим и с пометкой: оператор должен узнать об этом от нас, а не по молчанию
 * пациента.
 */
async function recordOutgoing({ conversation, session, userId, text, attachments, sent, deliveryError, io }) {
  const message = await OmniMessage.create({
    conversationId: conversation.id,
    sessionId: session ? session.id : null,
    direction: 'out',
    authorUserId: userId,
    text: text || '',
    attachments: attachments || [],
    externalMessageId: sent ? sent.externalMessageId : null,
    deliveryError
  });

  // Время первого живого ответа — то, ради чего пациент ждёт. Считаем только
  // доставленное: неушедшее сообщение он не увидел.
  if (session && !session.firstReplyAt && !deliveryError) {
    await session.update({ firstReplyAt: new Date() });
  }

  await conversation.update({ lastMessageAt: new Date() });

  // Ответ оператора тоже событие для соседей: обращение, взятое ответом без
  // кнопки «Взять», должно пропасть из чужой очереди.
  await announce(io, conversation, 'openline:changed');
  return { message, deliveryError };
}

/** Ошибку доставки переводим в человеческую только там, где знаем причину. */
async function deliveryFailure(err, subscriber) {
  if (err.code === 'blocked') {
    await subscriber.update({ isBlocked: true, blockedAt: new Date() });
    return 'Пациент заблокировал бота — сообщение не доставлено';
  }
  return err.message;
}

async function reply(userId, conversationId, text, io = null) {
  const { conversation, session, subscriber, bot, channel } = await prepareReply(userId, conversationId);

  let sent = null;
  let deliveryError = null;
  try {
    sent = await channel.sendText(bot, subscriber.externalUserId, text);
  } catch (err) {
    deliveryError = await deliveryFailure(err, subscriber);
  }

  return recordOutgoing({ conversation, session, userId, text, sent, deliveryError, io });
}

/**
 * Ответ файлом (ver. 8.09).
 *
 * До этого переписка была односторонней по вложениям: пациент мог прислать
 * фотографию направления, а оператор в ответ — только текст. Памятку перед
 * гастроскопией, бланк, схему проезда приходилось диктовать словами или просить
 * человека звонить.
 *
 * Файл сначала кладётся к себе и только потом уходит в мессенджер. Порядок
 * важен: не ушло — вложение всё равно остаётся в переписке с пометкой «не
 * доставлено», и оператор видит, что именно он посылал. Обратный порядок при
 * сбое оставлял бы историю без того, о чём шла речь.
 *
 * @param {Object} file  { buffer, originalName, mimetype, size }
 * @param {string} [caption]  подпись; у мессенджеров она часть того же сообщения
 */
async function replyWithFile(userId, conversationId, file, caption = '', io = null) {
  const { conversation, session, subscriber, bot, channel } = await prepareReply(userId, conversationId);

  const attachment = await files.saveOutgoing(file, conversation.id);

  let sent = null;
  let deliveryError = null;
  try {
    sent = attachment.kind === 'photo'
      ? await channel.sendPhoto(bot, subscriber.externalUserId,
        { buffer: file.buffer, fileName: attachment.title }, caption)
      : await channel.sendDocument(bot, subscriber.externalUserId,
        { buffer: file.buffer, fileName: attachment.title }, caption);
  } catch (err) {
    deliveryError = await deliveryFailure(err, subscriber);
  }

  return recordOutgoing({
    conversation, session, userId, text: caption, attachments: [attachment], sent, deliveryError, io
  });
}

/**
 * Кому можно передать обращение: состав линии, на которой оно живёт (ver. 8.09).
 *
 * Спрашивается у самого обращения, а не берётся общим списком сотрудников:
 * передавать можно только тому, кто на этой линии работает, — иначе чат уедет
 * человеку, который его даже не откроет.
 */
async function transferTargets(userId, conversationId) {
  const conversation = await loadForOperator(userId, conversationId);

  const rows = await OmniLineOperator.findAll({
    where: { lineId: conversation.lineId },
    include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName', 'avatar'] }]
  });

  // На смене ли человек — показываем, но не запрещаем: передать вечернему
  // сотруднику вопрос, ответ на который нужен утром, вполне разумно.
  const onShift = await OmniShift.findAll({
    where: { lineId: conversation.lineId, endedAt: null },
    attributes: ['userId']
  });
  const shiftIds = new Set(onShift.map(r => r.userId));

  return rows
    .filter(r => r.user && r.userId !== userId)
    .map(r => ({ ...r.user.get({ plain: true }), onShift: shiftIds.has(r.userId) }))
    .sort((a, b) => (Number(b.onShift) - Number(a.onShift))
      || String(a.displayName || a.username).localeCompare(String(b.displayName || b.username), 'ru'));
}

/**
 * Передать обращение другому сотруднику (ver. 8.09).
 *
 * До этого передать чат было нечем: взявший его либо доводил разговор сам, либо
 * закрывал обращение — и тогда пациенту уходила просьба оценить работу, которой
 * ещё не было. Оператор, у которого кончилась смена или который не знает
 * ответа, оставался с чужим вопросом на руках.
 *
 * Передача меняет исполнителя и у обращения, и у текущей сессии. Второе важнее
 * первого: показатели считаются по сессиям, и без этого разобранное обращение
 * зачлось бы тому, кто его только принял, а разговор довёл другой.
 *
 * В ленте остаётся отметка. Принявший должен видеть, откуда у него этот чат, а
 * при разборе жалобы через месяц — кто и когда его передал; в списке обращений
 * такое не восстанавливается.
 */
async function transfer(userId, conversationId, targetUserId, io = null) {
  const conversation = await loadForOperator(userId, conversationId);

  if (conversation.status === 'closed') {
    throw new OpenLineError('not_yours', 'Обращение закрыто — передавать нечего');
  }
  // Чужое обращение перехватывать нельзя: это была бы передача себе от чужого
  // имени. Ничьё из очереди передать можно — это просто назначение исполнителя.
  if (conversation.assigneeUserId && conversation.assigneeUserId !== userId) {
    throw new OpenLineError('not_yours', 'Обращение ведёт другой сотрудник');
  }
  if (String(targetUserId) === String(userId)) {
    throw new OpenLineError('not_found', 'Обращение и так у вас');
  }

  const isTargetOperator = await OmniLineOperator.count({
    where: { lineId: conversation.lineId, userId: targetUserId }
  });
  if (!isTargetOperator) {
    throw new OpenLineError('not_found', 'Этот сотрудник не работает на линии обращения');
  }

  const [from, to] = await Promise.all([
    User.findByPk(userId, { attributes: ['id', 'username', 'displayName'] }),
    User.findByPk(targetUserId, { attributes: ['id', 'username', 'displayName'] })
  ]);
  if (!to) throw new OpenLineError('not_found', 'Сотрудник не найден');

  const session = await currentSession(conversationId);

  await conversation.update({
    status: 'assigned',
    assigneeUserId: targetUserId,
    assignedAt: new Date(),
    // Отметку прочтения сбрасываем: принявший чат ещё ничего в нём не читал, и
    // приехать «уже прочитанным» переданное обращение не должно (ver. 8.27).
    operatorReadAt: null
  });
  if (session) await session.update({ assigneeUserId: targetUserId, assignedAt: new Date() });

  const name = (u) => (u ? (u.displayName || u.username) : 'сотрудник');
  await OmniMessage.create({
    conversationId,
    sessionId: session ? session.id : null,
    // 'sys' — служебная отметка переписки, а не сообщение пациенту: наружу она
    // не уходит и в превью списка не попадает. Три буквы потому, что колонка
    // direction — VARCHAR(3), и расширять её ради одной пометки дороже, чем
    // назвать пометку короче.
    direction: 'sys',
    authorUserId: userId,
    text: `${name(from)} передал обращение: ${name(to)}`
  });

  // Передавший в состав смены может и не попасть — например отдаёт чат в конце
  // дня, — поэтому он в получателях отдельно: у него этот чат открыт.
  await announce(io, conversation, 'openline:changed', {}, [userId]);

  return loadForOperator(userId, conversationId);
}

/**
 * Отметить переписку прочитанной (ver. 8.27).
 *
 * Отдельным вызовом, а не побочным действием загрузки переписки: чат остаётся
 * открытым всю смену, и при работе на сигналах он перечитывается сам, в том
 * числе в свёрнутой вкладке. Читать за человека то, на что он не смотрел, —
 * значит гасить единственный признак, ради которого всё и заводилось.
 *
 * Чужое обращение отметить нельзя: условие выборки ограничено исполнителем, и
 * попытка молча ничего не делает. Ошибки тут не нужно — это не действие
 * оператора, а служебный вызов интерфейса.
 */
async function markRead(userId, conversationId) {
  const [changed] = await OmniConversation.update(
    { operatorReadAt: new Date() },
    { where: { id: conversationId, assigneeUserId: userId } }
  );
  return { ok: changed > 0 };
}

// ── Продуктивность ────────────────────────────────────────────────────────

// Часовой пояс, в котором считается нагрузка по часам. Тот же, что у остальных
// расписаний портала: сравнивать тепловую карту с графиком смен иначе нельзя.
const STATS_TZ = 'Europe/Moscow';

// Через сколько обращение считается взятым быстро (ver. 8.30). Пять минут — это
// не норматив, а граница, за которой пациент в мессенджере начинает считать,
// что его не увидели. Величина одна на отчёт и вынесена сюда, чтобы менять её в
// одном месте, а не в запросе и в подписи к колонке порознь.
const QUICK_TAKE_SEC = 5 * 60;

/**
 * Показатели работы колл-центра за период.
 *
 * Ключевая величина — доля разобранного: сколько обращений пришло на линию,
 * пока сотрудник был на смене, и сколько из них он взял. Сравнивать разобранное
 * с общим потоком за месяц нечестно к тому, кто выходит через день, — поэтому
 * знаменатель считается по отработанным сменам, а не по календарю.
 */
async function stats(lineIds, { from, to }) {
  if (!lineIds.length) return { operators: [], totals: null, from, to };

  const replacements = { lineIds, from, to };

  const personal = await sequelize.query(`
    SELECT s."assigneeUserId" AS "userId",
           COUNT(*)::int AS taken,
           (COUNT(*) FILTER (WHERE s."closedAt" IS NOT NULL))::int AS handled,
           COUNT(s.rating)::int AS ratings,
           AVG(s.rating)::float AS "avgRating",
           (AVG(EXTRACT(EPOCH FROM (s."firstReplyAt" - s."openedAt")))
             FILTER (WHERE s."firstReplyAt" IS NOT NULL))::float AS "firstReplySec",
           (AVG(EXTRACT(EPOCH FROM (s."closedAt" - s."assignedAt")))
             FILTER (WHERE s."closedAt" IS NOT NULL AND s."assignedAt" IS NOT NULL))::float AS "handleSec"
    FROM omni_sessions s
    WHERE s."assigneeUserId" IS NOT NULL
      AND s."lineId" IN (:lineIds)
      AND s."openedAt" >= :from AND s."openedAt" < :to
    GROUP BY s."assigneeUserId"
  `, { replacements, type: sequelize.QueryTypes.SELECT });

  // Сколько всего пришло на линию, пока человек был на смене. DISTINCT — одна и
  // та же смена может пересечься с обращением по нескольким линиям.
  const offered = await sequelize.query(`
    SELECT sh."userId", COUNT(DISTINCT s.id)::int AS offered
    FROM omni_shifts sh
    JOIN omni_sessions s
      ON s."lineId" = sh."lineId"
     AND s."openedAt" >= GREATEST(sh."startedAt", CAST(:from AS timestamptz))
     AND s."openedAt" <  LEAST(COALESCE(sh."endedAt", NOW()), CAST(:to AS timestamptz))
    WHERE sh."lineId" IN (:lineIds)
      AND sh."startedAt" < :to
      AND COALESCE(sh."endedAt", NOW()) >= :from
    GROUP BY sh."userId"
  `, { replacements, type: sequelize.QueryTypes.SELECT });

  // Отработанное время. Смена открывается сразу на все линии сотрудника, поэтому
  // строки одного начала сначала схлопываются в одну — иначе человек на трёх
  // линиях «отработал» бы три смены за день.
  const worked = await sequelize.query(`
    SELECT "userId", SUM(sec)::float AS "shiftSec", COUNT(*)::int AS shifts
    FROM (
      SELECT sh."userId", sh."startedAt",
             MAX(EXTRACT(EPOCH FROM (
               LEAST(COALESCE(sh."endedAt", NOW()), CAST(:to AS timestamptz))
               - GREATEST(sh."startedAt", CAST(:from AS timestamptz))
             ))) AS sec
      FROM omni_shifts sh
      WHERE sh."lineId" IN (:lineIds)
        AND sh."startedAt" < :to
        AND COALESCE(sh."endedAt", NOW()) >= :from
      GROUP BY sh."userId", sh."startedAt"
    ) t
    GROUP BY "userId"
  `, { replacements, type: sequelize.QueryTypes.SELECT });

  const [totals] = await sequelize.query(`
    SELECT COUNT(*)::int AS sessions,
           (COUNT(*) FILTER (WHERE s."closedAt" IS NOT NULL))::int AS closed,
           (COUNT(*) FILTER (WHERE s."assigneeUserId" IS NULL AND s."closedAt" IS NULL))::int AS "inQueue",
           COUNT(s.rating)::int AS ratings,
           AVG(s.rating)::float AS "avgRating"
    FROM omni_sessions s
    WHERE s."lineId" IN (:lineIds)
      AND s."openedAt" >= :from AND s."openedAt" < :to
  `, { replacements, type: sequelize.QueryTypes.SELECT });

  // Когда приходит поток (ver. 8.30). Вопрос, на который показатели до сих пор
  // не отвечали: сколько людей ставить и на какие часы. Смены ставили по
  // ощущению, а ощущение у того, кто работает днём, и у того, кто работает
  // вечером, разное.
  //
  // Часовой пояс задан явно. В базе время хранится со смещением, и без
  // приведения тепловая карта показала бы московский вечер как день, а ночной
  // провал — сдвинутым на три часа: цифры верные, выводы из них — нет.
  const load = await sequelize.query(`
    SELECT EXTRACT(ISODOW FROM s."openedAt" AT TIME ZONE :tz)::int AS dow,
           EXTRACT(HOUR  FROM s."openedAt" AT TIME ZONE :tz)::int AS hour,
           COUNT(*)::int AS sessions,
           (COUNT(*) FILTER (
             WHERE s."assignedAt" IS NOT NULL
               AND s."assignedAt" - s."openedAt" <= (:quickSec * INTERVAL '1 second')
           ))::int AS quick
    FROM omni_sessions s
    WHERE s."lineId" IN (:lineIds)
      AND s."openedAt" >= :from AND s."openedAt" < :to
    GROUP BY 1, 2
  `, {
    replacements: { ...replacements, tz: STATS_TZ, quickSec: QUICK_TAKE_SEC },
    type: sequelize.QueryTypes.SELECT
  });

  // О чём были обращения (ver. 8.29). Отдельным разрезом, а не колонкой в
  // таблице сотрудников: тема — свойство разговора, а не человека, и вопрос к
  // ней другой — что чаще всего спрашивают, а не кто быстрее отвечает.
  //
  // LEFT JOIN и COALESCE ради строки «без темы»: обращения, закрытые до
  // появления справочника, из отчёта пропадать не должны — иначе сумма по темам
  // не сойдётся с числом обращений, и доверие к отчёту кончится на этом.
  const topics = await sequelize.query(`
    SELECT COALESCE(t.name, 'Без темы') AS name,
           t.id AS "topicId",
           COUNT(*)::int AS sessions,
           AVG(s.rating)::float AS "avgRating",
           (AVG(EXTRACT(EPOCH FROM (s."closedAt" - s."assignedAt")))
             FILTER (WHERE s."closedAt" IS NOT NULL AND s."assignedAt" IS NOT NULL))::float AS "handleSec"
    FROM omni_sessions s
    LEFT JOIN omni_topics t ON t.id = s."topicId"
    WHERE s."lineId" IN (:lineIds)
      AND s."closedAt" IS NOT NULL
      AND s."openedAt" >= :from AND s."openedAt" < :to
    GROUP BY t.id, t.name
    ORDER BY COUNT(*) DESC
  `, { replacements, type: sequelize.QueryTypes.SELECT });

  const ids = [...new Set([...personal, ...offered, ...worked].map(r => r.userId))];
  const users = ids.length
    ? await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'username', 'displayName', 'avatar'] })
    : [];

  const byId = (rows) => new Map(rows.map(r => [r.userId, r]));
  const p = byId(personal); const o = byId(offered); const w = byId(worked);

  const operators = users.map(u => {
    const mine = p.get(u.id) || {};
    const off = (o.get(u.id) || {}).offered || 0;
    const work = w.get(u.id) || {};
    const taken = mine.taken || 0;

    return {
      user: { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar },
      taken,
      handled: mine.handled || 0,
      offered: off,
      // Доля потока: сколько из пришедшего при нём он взял на себя.
      share: off > 0 ? taken / off : null,
      ratings: mine.ratings || 0,
      avgRating: mine.avgRating != null ? Number(mine.avgRating) : null,
      firstReplySec: mine.firstReplySec != null ? Number(mine.firstReplySec) : null,
      handleSec: mine.handleSec != null ? Number(mine.handleSec) : null,
      shifts: work.shifts || 0,
      shiftSec: work.shiftSec != null ? Number(work.shiftSec) : 0
    };
  });

  // Сортировка по средней оценке — это и есть «рейтинг сотрудников». Без оценок
  // человек уходит вниз, но не исчезает: по числу разобранных его тоже смотрят.
  operators.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0) || b.handled - a.handled);

  return {
    operators,
    totals,
    load: {
      quickSec: QUICK_TAKE_SEC,
      // Отдаём как есть, разреженно: часов в неделе 168, а обращений за месяц
      // бывает меньше. Достраивать пустые клетки — дело интерфейса, он всё
      // равно рисует сетку целиком.
      cells: load.map(r => ({ dow: r.dow, hour: r.hour, sessions: r.sessions, quick: r.quick }))
    },
    topics: topics.map(t => ({
      topicId: t.topicId,
      name: t.name,
      sessions: t.sessions,
      avgRating: t.avgRating != null ? Number(t.avgRating) : null,
      handleSec: t.handleSec != null ? Number(t.handleSec) : null
    })),
    from,
    to
  };
}

module.exports = {
  OpenLineError,
  DEFAULT_OFFLINE_REPLY,
  startDay,
  endDay,
  shiftState,
  linesOfUser,
  acceptIncoming,
  offlineNoticeFor,
  hasOperatorsOnShift,
  listConversations,
  getConversation,
  assign,
  close,
  markRead,
  listTopics,
  createTopic,
  updateTopic,
  topicRequired,
  rate,
  reply,
  replyWithFile,
  transfer,
  transferTargets,
  stats
};
