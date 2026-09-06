'use strict';

/**
 * Разговор пациента с ботом (ver. 7.84).
 *
 * Первое, ради чего бот вообще нужен, — узнать, кто перед нами. Пока у нас нет
 * телефона, человек для нас безымянный chat_id, и отправить ему напоминание о
 * визите невозможно. Поэтому подписка сводится к одному действию: кнопка
 * «Поделиться контактом», по которой мессенджер сам отдаёт номер, а мы находим
 * по нему карточку в МИС.
 *
 * Логика намеренно написана без конструктора сценариев. У Fromni он был потому,
 * что это универсальная платформа; у нас меню в три пункта, и хардкод честнее —
 * читается целиком и чинится за минуту.
 */

const { BotSubscriber } = require('../../models');
const misClient = require('../misClient');
const openLine = require('../openLine');

// Категории подписчиков в МИС. Ставятся только боевым ботам: тестовый не должен
// оставлять следов в карточках живых пациентов.
const CATEGORY_BY_PLATFORM = {
  telegram: process.env.MIS_CATEGORY_TELEGRAM,
  max: process.env.MIS_CATEGORY_MAX
};

const GREETING =
  'Здравствуйте! Это бот медцентра «Альфа».\n\n' +
  'Здесь можно получать напоминания о визитах и задавать вопросы колл-центру.\n\n' +
  'Чтобы мы вас узнали, нажмите кнопку ниже и поделитесь номером телефона — ' +
  'тем самым, на который оформлена карта.';

const MENU =
  'Что дальше:\n' +
  '• напоминания о визитах будут приходить сюда автоматически;\n' +
  '• чтобы задать вопрос, просто напишите его сообщением.';

/**
 * Ищет карточки пациента по телефону. Один номер может принадлежать семье —
 * тогда карточек несколько, и уведомления по ним всем уместно слать в один чат.
 */
async function findPatients(phone) {
  try {
    const patients = await misClient.getPatientsByPhone(phone);
    return Array.isArray(patients) ? patients.map(p => String(p.patient_id)) : [];
  } catch (err) {
    // Недоступность МИС не должна ломать подписку: телефон уже у нас, карточку
    // подтянем следующим проходом. Человеку про это знать незачем.
    console.error('[dialog] МИС не ответила на поиск по телефону:', err.message);
    return null;
  }
}

async function tagInMis(patientIds, platform) {
  const categoryId = CATEGORY_BY_PLATFORM[platform];
  if (!categoryId || !patientIds || !patientIds.length) return false;

  let ok = true;
  for (const patientId of patientIds) {
    try {
      await misClient.addPatientCategory(patientId, categoryId);
    } catch (err) {
      console.error(`[dialog] категория ${categoryId} пациенту ${patientId}:`, err.message);
      ok = false;
    }
  }
  return ok;
}

/**
 * Заводит или обновляет подписчика. Ключ — платформа, организация и id
 * пользователя в мессенджере: человек, подписанный на боты нескольких
 * медцентров, считается в каждом отдельно (важно для статистики по центрам).
 */
async function upsertSubscriber(bot, update, patch = {}) {
  const where = {
    platform: bot.platform,
    organization: bot.organization,
    externalUserId: update.externalUserId
  };

  const existing = await BotSubscriber.findOne({ where });
  const base = {
    botId: bot.id,
    username: update.from.username,
    firstName: update.from.firstName,
    lastName: update.from.lastName,
    // Человек вернулся и пишет — значит бот точно не заблокирован.
    isBlocked: false,
    blockedAt: null
  };

  if (existing) {
    await existing.update({ ...base, ...patch });
    return existing;
  }

  return BotSubscriber.create({
    ...where,
    ...base,
    source: 'bot',
    status: 'started',
    startedAt: new Date(),
    ...patch
  });
}

// ── Обработчики ───────────────────────────────────────────────────────────

async function handleStart(channel, bot, update) {
  await upsertSubscriber(bot, update);
  await channel.sendText(bot, update.chatId, GREETING, {
    requestContact: '📱 Поделиться номером телефона'
  });
}

async function handleContact(channel, bot, update) {
  // Телефон принимаем только собственный. Кнопкой «поделиться контактом» можно
  // прислать чужую визитку из адресной книги, и без этой проверки человек
  // подписал бы на уведомления постороннего.
  if (update.contactUserId && update.contactUserId !== update.externalUserId) {
    await channel.sendText(bot, update.chatId,
      'Пожалуйста, отправьте свой номер — кнопкой ниже, а не карточкой из контактов.',
      { requestContact: '📱 Поделиться номером телефона' });
    return;
  }

  const phone = misClient.normalizePhone(update.phone);
  const patientIds = await findPatients(phone);

  const patch = { phone, identifiedAt: new Date(), status: 'identified' };
  if (patientIds && patientIds.length) {
    patch.patientIds = patientIds;
    // Тестового бота в МИС не отмечаем — он ходит по живой базе пациентов.
    if (bot.organization !== 'test' && await tagInMis(patientIds, bot.platform)) {
      patch.status = 'tagged';
      patch.taggedAt = new Date();
    }
  }
  await upsertSubscriber(bot, update, patch);

  const found = patientIds && patientIds.length
    ? 'Мы нашли вашу карту — напоминания о визитах будут приходить сюда.'
    : 'Карту по этому номеру мы пока не нашли. Ничего страшного: сообщите номер администратору при следующем визите, и напоминания заработают.';

  await channel.sendText(bot, update.chatId, `Спасибо, номер получен.\n\n${found}`, { removeKeyboard: true });
  await channel.sendText(bot, update.chatId, MENU);
}

async function handleText(channel, bot, update) {
  const subscriber = await upsertSubscriber(bot, update);

  // Пока человек не назвался, разговаривать не о чем: оператору нужна карточка,
  // а не безымянный чат.
  if (!subscriber.phone) {
    await channel.sendText(bot, update.chatId,
      'Чтобы мы могли ответить, сначала поделитесь номером телефона.',
      { requestContact: '📱 Поделиться номером телефона' });
    return;
  }

  const accepted = await openLine.acceptIncoming({
    bot,
    subscriber,
    text: update.text || '',
    attachments: update.media ? [update.media] : [],
    externalMessageId: update.externalMessageId
  });

  // Бот не привязан к линии — обращению некуда лечь. Так живёт проверочный бот,
  // и молчать в ответ нельзя: человек решит, что его не услышали.
  if (!accepted) {
    await channel.sendText(bot, update.chatId,
      'Сообщение получено. Ответим в рабочее время колл-центра.');
    return;
  }

  // Новое обращение подтверждаем, продолжение — нет: «принято» под каждой
  // репликой превращает переписку в эхо.
  if (accepted.isNew) {
    await channel.sendText(bot, update.chatId,
      'Спасибо, вопрос принят. Сейчас передадим его сотруднику колл-центра.');
  }

  const notice = await openLine.offlineNoticeFor(accepted.conversation, accepted.line);
  if (notice) await channel.sendText(bot, update.chatId, notice);
}

/**
 * Точка входа: разобранное обновление любого канала.
 */
async function handleUpdate(channel, bot, update) {
  switch (update.type) {
    case 'command':
      if (update.command === '/start') return handleStart(channel, bot, update);
      return handleText(channel, bot, update);
    case 'contact':
      return handleContact(channel, bot, update);
    case 'text':
    case 'media':
      return handleText(channel, bot, update);
    case 'button':
      // Кнопки появятся вместе с уведомлениями («Подтверждаю»). Пока просто
      // гасим часики, чтобы у человека не висела нажатая кнопка.
      return channel.answerCallback(bot, update.callbackId);
    default:
      return null;
  }
}

module.exports = { handleUpdate, upsertSubscriber };
