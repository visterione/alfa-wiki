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
const openLineFiles = require('../openLineFiles');
const openLinePatient = require('../openLinePatient');
const broadcasts = require('../broadcasts');

const GREETING =
  'Здравствуйте! Это бот медцентра «Альфа».\n\n' +
  'Здесь можно получать напоминания о визитах и задавать вопросы колл-центру.\n\n' +
  'Чтобы мы вас узнали, нажмите кнопку ниже и поделитесь номером телефона — ' +
  'тем самым, на который оформлена карта.\n\n' +
  // Про второй способ говорим сразу: кнопку видно не везде (в вебе и на части
  // клиентов клавиатура свёрнута), и человек, который её не нашёл, иначе просто
  // напишет номер в надежде, что поймут.
  'Если кнопки не видно — пришлите номер сообщением: +79991234567.';

const MENU =
  'Что дальше:\n' +
  '• напоминания о визитах будут приходить сюда автоматически;\n' +
  '• чтобы задать вопрос, просто напишите его сообщением.';

const PHONE_HINT =
  'Похоже, это номер телефона, но разобрать его не получилось.\n\n' +
  'Пришлите его в формате +79991234567 — или нажмите кнопку ниже, ' +
  'тогда вводить ничего не придётся.';

/**
 * Пытается прочитать в сообщении номер телефона (ver. 8.08).
 *
 * Кнопка «поделиться контактом» — не единственный путь: часть людей просто
 * набирает номер в ответ, и до 8.08 такое сообщение пропадало. В линию оно не
 * уходило (без телефона обращение не создаётся), а бот повторял просьбу нажать
 * кнопку — человек оказывался в замкнутом круге. Причём кнопки он мог и не
 * видеть: в вебе и на части клиентов клавиатура сворачивается.
 *
 * Номер набирают как придётся: 8 или +7, со скобками, через дефисы и пробелы.
 * Приводить всё это к 7XXXXXXXXXX умеет misClient.normalizePhone — тот же, что
 * разбирает номер из карточки контакта, так что оба пути дают одинаковый ключ.
 *
 * Три исхода, и различать их важно: 'ok' — номер разобран; 'malformed' — на
 * номер похоже, но не сходится (тогда показываем маску); null — это обычный
 * текст, вопрос оператору, и трогать его нельзя.
 */
function readPhone(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // Буквы означают, что человек пишет, а не диктует номер. «Мой телефон
  // 89991234567» намеренно не разбираем: такое сообщение уместнее показать
  // целиком, чем молча вынуть из него цифры.
  if (!/^[\d\s()+\-.]+$/.test(raw)) return null;

  const digits = raw.replace(/\D/g, '');
  // Слишком коротко, чтобы быть даже испорченным номером: скорее номер кабинета
  // или год. Такое отдаём оператору как обычный текст.
  if (digits.length < 6) return null;

  // Длину проверяем до нормализации, а не после. misClient.normalizePhone
  // достраивает десятизначный номер семёркой, и «+7 999 123 45 6» — номер, в
  // котором потеряна цифра, — превратился бы в правдоподобный 77999123456 и
  // прошёл бы дальше. Ошибку заметили бы через месяц, когда напоминание ушло бы
  // в пустоту.
  const ok = (digits.length === 11 && /^[78]/.test(digits))
    // Без кода страны набирают мобильный, а он всегда начинается с девятки.
    || (digits.length === 10 && digits.startsWith('9'));
  if (!ok) return { status: 'malformed' };

  return { status: 'ok', phone: misClient.normalizePhone(digits) };
}

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

/**
 * Помечает найденные карточки категорией бота (ver. 8.08).
 *
 * Категория заведена в МИС на каждого бота отдельно, а не на платформу: сети
 * важно видеть в карточке, из какого медцентра пришёл человек, — «Telegram» на
 * всю сеть такого не отвечает. Раньше категорий было две и лежали они в .env;
 * обе так и остались пустыми, то есть за всё время не проставилось ни одной.
 *
 * Пустая категория — не ошибка: так живут проверочные боты и боевые, для
 * которых категорию в МИС ещё не завели. Подписка при этом проходит как обычно,
 * просто остаётся в статусе identified.
 */
async function tagInMis(patientIds, bot) {
  const categoryId = bot.misCategoryId;
  if (!categoryId || !patientIds || !patientIds.length) return false;

  let ok = true;
  for (const patientId of patientIds) {
    try {
      // МИС отвечает true и на повторное добавление уже стоящей категории, так
      // что бояться второго прохода незачем.
      await misClient.addPatientCategory(patientId, categoryId);
    } catch (err) {
      console.error(`[dialog] категория ${categoryId} пациенту ${patientId}:`, err.message);
      ok = false;
    }
  }
  return ok;
}

/**
 * Догоняет категорию тем, кто подписался раньше, чем её завели.
 *
 * Пометка ставится в момент «поделиться контактом», но не сработать она может по
 * двум причинам: МИС не ответила на поиск по телефону или категории у бота ещё
 * не было — а до 8.08 её не было ни у кого. Оставлять таких людей без категории
 * навсегда неправильно, поэтому пробуем ещё раз на первом же их сообщении.
 *
 * Лишнего похода в МИС здесь нет: карточки к этому моменту уже перечитаны в
 * openLine.acceptIncoming, и если их так и не нашлось, мы просто выходим.
 */
async function tagLate(bot, subscriber) {
  if (!subscriber || subscriber.status === 'tagged' || bot.organization === 'test') return;

  const patientIds = (subscriber.patientIds || []).map(String).filter(Boolean);
  if (!patientIds.length) return;

  if (await tagInMis(patientIds, bot)) {
    await subscriber.update({ status: 'tagged', taggedAt: new Date() });
  }
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

/**
 * Знакомство: телефон получен, ищем карту и помечаем её категорией бота.
 *
 * Путей сюда два — кнопка «поделиться контактом» и номер, набранный руками, — и
 * дальше первой строки они не различаются: номер в обоих случаях уже приведён к
 * 7XXXXXXXXXX. Различие только в ответе: набранный руками номер повторяем
 * вслух, чтобы опечатка была видна сразу, а не всплыла, когда напоминание уйдёт
 * чужому человеку.
 */
async function identify(channel, bot, update, phone, { echo = false } = {}) {
  const patientIds = await findPatients(phone);

  const patch = { phone, identifiedAt: new Date(), status: 'identified' };
  if (patientIds && patientIds.length) {
    patch.patientIds = patientIds;
    // Тестового бота в МИС не отмечаем — он ходит по живой базе пациентов.
    if (bot.organization !== 'test' && await tagInMis(patientIds, bot)) {
      patch.status = 'tagged';
      patch.taggedAt = new Date();
    }
  }
  const subscriber = await upsertSubscriber(bot, update, patch);
  // Снимок карточки для заголовка чата у оператора: ФИО, номер карты и дата
  // рождения. Знакомство — единственный момент, когда мы точно знаем, что
  // карточку стоит перечитать.
  await openLinePatient.refresh(subscriber, true);

  const found = patientIds && patientIds.length
    ? 'Мы нашли вашу карту — напоминания о визитах будут приходить сюда.'
    : 'Карту по этому номеру мы пока не нашли. Ничего страшного: сообщите номер администратору при следующем визите, и напоминания заработают.';

  const got = echo
    ? `Спасибо, записали номер ${misClient.formatMobile(phone)}.`
    : 'Спасибо, номер получен.';

  await channel.sendText(bot, update.chatId, `${got}\n\n${found}`, { removeKeyboard: true });
  await channel.sendText(bot, update.chatId, MENU);
  return subscriber;
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

  await identify(channel, bot, update, misClient.normalizePhone(update.phone));
}

async function handleText(channel, bot, update) {
  const subscriber = await upsertSubscriber(bot, update);

  // Пока человек не назвался, разговаривать не о чем: оператору нужна карточка,
  // а не безымянный чат. Но прежде чем повторять просьбу — смотрим, не номер ли
  // это: набранный руками он приходит обычным текстом, и не принять его значило
  // бы гонять человека по кругу.
  if (!subscriber.phone) {
    const parsed = readPhone(update.text);

    if (parsed && parsed.status === 'ok') {
      await identify(channel, bot, update, parsed.phone, { echo: true });
      return;
    }

    await channel.sendText(bot, update.chatId,
      parsed ? PHONE_HINT
        : 'Чтобы мы могли ответить, сначала поделитесь номером телефона: ' +
          'нажмите кнопку ниже или пришлите его сообщением в формате +79991234567.',
      { requestContact: '📱 Поделиться номером телефона' });
    return;
  }

  const accepted = await openLine.acceptIncoming({
    bot,
    subscriber,
    text: update.text || '',
    externalMessageId: update.externalMessageId
  });

  // Бот не привязан к линии — обращению некуда лечь. Так живёт проверочный бот,
  // и молчать в ответ нельзя: человек решит, что его не услышали.
  //
  // В лог пишем громко: снаружи этот случай неотличим от нормальной работы —
  // человек получает вежливый ответ, а обращение при этом не появляется ни в
  // одной очереди. Один раз уже потратили на это полчаса.
  if (!accepted) {
    console.warn(`[dialog] @${bot.username}: сообщение принято, но линия не назначена ` +
      `(lineId=${bot.lineId || 'нет'}) — обращение никуда не попало`);
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

  // Файл забираем уже после того, как обращение создано: путь к нему строится от
  // обращения, и по этому пути потом проверяется доступ. Неудача при скачивании
  // не должна терять сам вопрос — сообщение уже сохранено.
  if (update.media) {
    try {
      const attachment = await openLineFiles.saveIncoming(channel, bot, update.media, accepted.conversation.id);
      await accepted.message.update({ attachments: [attachment] });
    } catch (err) {
      console.error(`[dialog] вложение обращения ${accepted.conversation.id}:`, err.message);
    }
  }

  const notice = await openLine.offlineNoticeFor(accepted.session, accepted.line);
  if (notice) await channel.sendText(bot, update.chatId, notice);

  // В самом конце: категория в МИС человеку ничего не меняет, а вопрос его
  // оператору доставить важнее.
  await tagLate(bot, subscriber);
}


/**
 * Нажатие кнопки под сообщением бота. Их три: «Подтверждаю» под записью и
 * напоминанием, оценка работы после закрытия обращения и отказ от рассылок под
 * рекламным анонсом.
 */
async function handleButton(channel, bot, update) {
  const [action, value, extra] = String(update.data || '').split(':');
  console.log(`[dialog] кнопка «${update.data}» от ${update.externalUserId}`);

  // Оценка работы сотрудника после закрытия обращения (ver. 7.99). Ответ здесь
  // короткий и без второго вопроса: просить оценку — уже вмешательство, а
  // разговор о том, «почему три», человек заведёт сам, если захочет.
  if (action === 'rate' && value) {
    const session = await openLine.rate(value, extra);
    await channel.answerCallback(bot, update.callbackId, session ? 'Спасибо за оценку' : '');
    if (session) {
      await channel.sendText(bot, update.chatId,
        'Спасибо, оценка учтена. Если понадобится что-то ещё — просто напишите сюда.');
    }
    return null;
  }

  // Отказ от рекламных рассылок (ver. 8.07). Отписка узкая и это сказано вслух:
  // человек нажимает её под анонсом акции, а ждёт обычно, что «бот перестанет
  // писать». Напоминания о визитах не прекращаются, и узнать об этом он должен
  // здесь, а не когда пропустит приём.
  if (action === 'unsub') {
    const changed = await broadcasts.optOut(bot, update.externalUserId);
    await channel.answerCallback(bot, update.callbackId, changed ? 'Больше не пришлём' : 'Вы уже отписаны');
    if (changed) {
      await channel.sendText(bot, update.chatId,
        'Готово — рекламные рассылки вам больше не придут.\n\n' +
        'Напоминания о визитах это не отменяет: они будут приходить как раньше. ' +
        'И вопрос сюда написать по-прежнему можно.');
    }
    return null;
  }

  if (action !== 'confirm' || !value) {
    return channel.answerCallback(bot, update.callbackId);
  }

  try {
    const ok = await misClient.confirmAppointment(value);
    console.log(`[dialog] подтверждение визита ${value}: ${ok ? 'принято МИС' : 'МИС отказала'}`);
    // Ответ на кнопку живёт секунды — сначала гасим часики, потом пишем в чат.
    await channel.answerCallback(bot, update.callbackId, ok ? 'Спасибо, визит подтверждён' : 'Не получилось, попробуйте позже');
    await channel.sendText(bot, update.chatId, ok
      ? 'Спасибо! Визит подтверждён, ждём вас.'
      : 'Не удалось отметить подтверждение. Мы всё равно вас ждём — при необходимости позвоните нам.');
  } catch (err) {
    console.error(`[dialog] подтверждение визита ${value}:`, err.message);
    await channel.answerCallback(bot, update.callbackId, 'Не получилось, попробуйте позже');
  }
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
      return handleButton(channel, bot, update);
    default:
      return null;
  }
}

module.exports = { handleUpdate, upsertSubscriber, readPhone };
