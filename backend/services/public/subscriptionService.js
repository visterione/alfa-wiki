'use strict';

/**
 * Подписки чатов на формы публичного API.
 *
 * Заменяет переменные PUBLIC_FORM_<ТИП>_CHAT_ID в .env. Маршрут заявки — это членство
 * бота в чате, ровно как в Telegram: добавили бота в чат — он туда пишет, убрали —
 * перестал. Человеку не нужно нигде переписывать id чата.
 *
 * Подписка заводится сама при входе бота в чат (onBotJoined) по списку форм, которые
 * бот обслуживает — bot_tokens.servesForms, настраивается в интерфейсе ботов.
 * Поправить набор можно командами прямо в чате, см. handleCommand.
 */

const { Op } = require('sequelize');
const { FormSubscription, BotToken, Chat, ChatMember, User } = require('../../models');
const formRegistry = require('./formRegistry');

/** Команды, которые бот понимает в чате. Показываются по /help и /start. */
const COMMANDS = [
  { command: 'forms',         description: 'Какие формы существуют' },
  { command: 'subscriptions', description: 'Что получает этот чат' },
  { command: 'subscribe',     description: 'Подписать чат на форму', usage: '<тип формы>' },
  { command: 'unsubscribe',   description: 'Отписать чат от формы', usage: '[тип формы]' }
];

// ── Подписки ──────────────────────────────────────────────────────────────

/**
 * Адресаты заявки: все активные подписки на эту форму, с учётом фильтра по клиенту.
 *
 * @param {string} formType
 * @param {string} [clientId] ID api_clients, от кого пришла заявка
 * @returns {Promise<Array<{ botId: string, chatId: string }>>}
 */
async function resolveTargets(formType, clientId) {
  const subscriptions = await FormSubscription.findAll({
    where: { formType, isActive: true }
  });

  const targets = subscriptions
    // Пустой фильтр — принимать от всех; заданный — только от указанного клиента
    .filter(s => !s.filters?.clientId || s.filters.clientId === clientId)
    .map(s => ({ botId: s.botId, chatId: s.chatId }));

  if (targets.length > 0) return targets;

  // Подписок нет — берём адрес из .env, как до ver. 6.15. Слой совместимости на
  // время переезда: снимается после `node scripts/migrateFormRouting.js --apply`
  // и удаления переменных PUBLIC_FORM_*. Смотри инструкцию в PUBLIC_API_SETUP.md.
  return legacyEnvTarget(formType);
}

/**
 * Адрес доставки из переменных окружения — старая схема.
 * @returns {Promise<Array<{ botId: string, chatId: string }>>} Пустой массив, если не настроено
 */
async function legacyEnvTarget(formType) {
  const envKey = formType.toUpperCase().replace(/-/g, '_');
  const token  = process.env[`PUBLIC_FORM_${envKey}_BOT_TOKEN`] || process.env.PUBLIC_FORMS_BOT_TOKEN;
  const chatId = process.env[`PUBLIC_FORM_${envKey}_CHAT_ID`];
  if (!token || !chatId) return [];

  const { resolveChat } = require('../botMessenger');
  const [bot, chat] = await Promise.all([
    BotToken.findOne({ where: { token, isActive: true } }),
    resolveChat(chatId)
  ]);
  if (!bot || !chat) return [];

  return [{ botId: bot.id, chatId: chat.id }];
}

/**
 * Бота добавили в чат — подписываем чат на все формы, которые бот обслуживает,
 * и пишем об этом в сам чат. Молча подписывать нельзя: люди должны видеть, что
 * в чат теперь падают заявки, и знать, как это выключить.
 *
 * @param {Object} bot   Запись BotToken
 * @param {Object} chat  Запись Chat
 * @param {string} [actorId] Кто добавил бота
 * @returns {Promise<string[]>} Типы форм, на которые подписали
 */
async function onBotJoined(bot, chat, actorId) {
  const forms = (bot.servesForms || []).filter(t => formRegistry.getForm(t));
  if (forms.length === 0) return [];

  const created = [];
  for (const formType of forms) {
    const [, isNew] = await FormSubscription.findOrCreate({
      where:    { botId: bot.id, chatId: chat.id, formType },
      defaults: { createdBy: actorId || null }
    });
    if (isNew) created.push(formType);
  }

  if (created.length > 0) {
    const titles = created.map(t => `• ${formRegistry.getForm(t).title}`).join('\n');
    await say(bot, chat, [
      '*Заявки с сайта будут приходить сюда:*',
      titles,
      '',
      'Отключить — /unsubscribe, посмотреть текущие подписки — /subscriptions'
    ].join('\n'));
  }

  return created;
}

/**
 * Боту поменяли список обслуживаемых форм в админке — приводим подписки в чатах,
 * где он уже сидит, в соответствие. Иначе галочка не давала бы никакого эффекта,
 * пока бота не выкинут из чата и не добавят заново.
 *
 * @param {Object} bot Запись BotToken с уже сохранённым servesForms
 * @param {string} [actorId]
 * @returns {Promise<{ added: number, removed: number }>}
 */
async function onServedFormsChanged(bot, actorId) {
  const forms = bot.servesForms || [];

  // Формы, которые бот больше не обслуживает, из подписок убираем
  const removed = await FormSubscription.destroy({
    where: forms.length
      ? { botId: bot.id, formType: { [Op.notIn]: forms } }
      : { botId: bot.id }
  });

  if (forms.length === 0) return { added: 0, removed };

  const members = await ChatMember.findAll({ where: { userId: bot.userId } });
  let added = 0;

  for (const member of members) {
    const chat = await Chat.findByPk(member.chatId);
    if (!chat) continue;
    added += (await onBotJoined(bot, chat, actorId)).length;
  }

  return { added, removed };
}

/**
 * Бота убрали из чата — снимаем все его подписки в этом чате.
 * Заявки, уже принятые, но ещё не доставленные, при этом не теряются: их адресаты
 * зафиксированы в submission_deliveries в момент приёма.
 */
async function onBotLeft(botUserId, chatId) {
  const bot = await BotToken.findOne({ where: { userId: botUserId } });
  if (!bot) return 0;

  return FormSubscription.destroy({ where: { botId: bot.id, chatId } });
}

// ── Команды в чате ────────────────────────────────────────────────────────

/**
 * Разбирает сообщение чата как команду боту.
 *
 * Обрабатываем внутри бэкенда, а не внешним ботом через getUpdates: системному боту
 * форм не нужен ни отдельный процесс, ни поллинг, ни токен в чужом окружении.
 *
 * @param {Object} message Запись Message
 * @returns {Promise<boolean>} true, если сообщение было командой и её обработали
 */
async function handleCommand(message) {
  const text = String(message.content || '').trim();
  if (!text.startsWith('/')) return false;

  // /subscribe@bot_username — форма из Telegram, когда в чате несколько ботов
  const [rawCommand, ...args] = text.split(/\s+/);
  const [command, mentioned] = rawCommand.slice(1).toLowerCase().split('@');

  // Отвечает только бот, обслуживающий формы; если адресовались конкретному — он же
  const bots = await botsInChat(message.chatId);
  const bot = mentioned
    ? bots.find(b => b.username.toLowerCase() === mentioned)
    : bots[0];
  if (!bot) return false;

  const known = COMMANDS.some(c => c.command === command);
  if (!known) return false;

  // Менять маршруты доставки может только администратор чата: иначе любой участник
  // подписал бы себя на чужие заявки с персональными данными
  if (['subscribe', 'unsubscribe'].includes(command)) {
    const membership = await ChatMember.findOne({
      where: { chatId: message.chatId, userId: message.senderId }
    });
    if (!membership || membership.role !== 'admin') {
      await say(bot, { id: message.chatId }, 'Менять подписки чата может только его администратор');
      return true;
    }
  }

  const chat = await Chat.findByPk(message.chatId);
  const handlers = { forms: cmdForms, subscriptions: cmdSubscriptions, subscribe: cmdSubscribe, unsubscribe: cmdUnsubscribe };
  await handlers[command](bot, chat, args, message.senderId);
  return true;
}

/** /forms — что вообще можно получать */
async function cmdForms(bot, chat) {
  const lines = formRegistry.listFormTypes().map(t => {
    const form = formRegistry.getForm(t);
    const served = (bot.servesForms || []).includes(t) ? '' : '   (этот бот её не обслуживает)';
    return `• \`${t}\` — ${form.title}${served}`;
  });

  await say(bot, chat, ['*Формы публичного API:*', ...lines].join('\n'));
}

/** /subscriptions — что получает этот чат */
async function cmdSubscriptions(bot, chat) {
  const subs = await FormSubscription.findAll({
    where: { chatId: chat.id, isActive: true }
  });

  if (subs.length === 0) {
    return say(bot, chat, 'Этот чат не подписан ни на одну форму. Подписать — /subscribe <тип формы>');
  }

  const lines = await Promise.all(subs.map(async s => {
    const form = formRegistry.getForm(s.formType);
    const filter = s.filters?.clientId ? '   (только от одного источника)' : '';
    return `• ${form ? form.title : s.formType}${filter}`;
  }));

  await say(bot, chat, ['*Этот чат получает:*', ...lines].join('\n'));
}

/** /subscribe <тип формы> [from=<id клиента>] */
async function cmdSubscribe(bot, chat, args, actorId) {
  const formType = args[0];
  if (!formType) {
    return say(bot, chat, 'Укажите форму: /subscribe <тип формы>. Список — /forms');
  }

  const form = formRegistry.getForm(formType);
  if (!form) {
    return say(bot, chat, `Форма «${formType}» не найдена. Список — /forms`);
  }

  if (!(bot.servesForms || []).includes(formType)) {
    return say(bot, chat,
      `Бот не обслуживает «${form.title}». Отметьте эту форму боту в разделе «Боты» админки.`);
  }

  // from=<clientId> — принимать заявки только от одного источника, для филиалов
  const from = args.find(a => a.startsWith('from='))?.slice(5);
  const filters = from ? { clientId: from } : {};

  const [subscription, isNew] = await FormSubscription.findOrCreate({
    where:    { botId: bot.id, chatId: chat.id, formType },
    defaults: { filters, createdBy: actorId }
  });

  if (!isNew) {
    await subscription.update({ filters, isActive: true });
  }

  await say(bot, chat, `Готово. «${form.title}» будет приходить в этот чат.`);
}

/** /unsubscribe <тип формы> — без аргумента отписывает от всего */
async function cmdUnsubscribe(bot, chat, args) {
  const formType = args[0];

  const where = { botId: bot.id, chatId: chat.id };
  if (formType) where.formType = formType;

  const removed = await FormSubscription.destroy({ where });

  if (removed === 0) {
    return say(bot, chat, formType ? `Чат и так не подписан на «${formType}»` : 'Чат ни на что не подписан');
  }

  await say(bot, chat, formType
    ? `Отписал. «${formType}» больше сюда не придёт.`
    : `Отписал от всех форм (${removed}). Вернуть — /subscribe <тип формы>`);
}

// ── Вспомогательное ───────────────────────────────────────────────────────

/**
 * Боты в чате, которые обслуживают хотя бы одну форму.
 * @param {string} chatId
 * @returns {Promise<Object[]>}
 */
async function botsInChat(chatId) {
  const members = await ChatMember.findAll({
    where: { chatId },
    include: [{ model: User, as: 'user', where: { isBot: true }, required: true }]
  });
  if (members.length === 0) return [];

  const bots = await BotToken.findAll({
    where: { userId: members.map(m => m.userId), isActive: true }
  });

  return bots.filter(b => (b.servesForms || []).length > 0);
}

/** Ответ бота в чат. Сбой ответа не должен ронять вызывающего. */
async function say(bot, chat, text) {
  const { sendBotMessage } = require('../botMessenger');
  try {
    await sendBotMessage({ botId: bot.id, chatId: chat.id, text });
  } catch (err) {
    console.error(`[subscriptions] не удалось ответить в чат ${chat.id}:`, err.message);
  }
}

module.exports = {
  COMMANDS,
  resolveTargets,
  legacyEnvTarget,
  onBotJoined,
  onBotLeft,
  onServedFormsChanged,
  handleCommand
};
