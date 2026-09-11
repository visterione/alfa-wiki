'use strict';

/**
 * Каскад доставки уведомлений (ver. 7.86).
 *
 * Ступени ровно две, и это намеренно:
 *
 *   1. наш бот — если человек на него подписан и не заблокировал;
 *   2. Fromni — Notify, ВК, SMS, в том же порядке и по тому же договору, что и
 *      раньше. Внутренний порядок остаётся у них, переизобретать его незачем.
 *
 * Решение «в бот или дальше» принимаем мы, потому что подписка теперь наша.
 * Раньше это делал агрегатор, и именно поэтому один и тот же бот не мог
 * одновременно обслуживать уведомления и открытую линию.
 */

const { Op } = require('sequelize');
const { NotifOutbox, NotifAppointment, BotSubscriber, MessengerBot, Setting,
        NotifTemplate } = require('../../models');
const { getChannel } = require('../messengers');
const fromni = require('../messengers/fromni');
const imobis = require('../messengers/imobis');
const misClient = require('../misClient');
const settings = require('./settings');
const safety = require('./safety');
const consent = require('./consent');
const doctorBlocklist = require('./doctorBlocklist');
const branches = require('./branches');

// Какой организации принадлежит клиника МИС. Нужно, чтобы уйти во Fromni под
// правильным аккаунтом: у каждой организации он свой. Заполняется в настройках,
// ключ clinic_id → ключ организации.
const CLINIC_ORG_KEY = 'notif_clinic_org';
const DEFAULT_ORG = process.env.FROMNI_DEFAULT_ORG || 'alfa';

// ── Предохранители ────────────────────────────────────────────────────────
//
// Переехали в services/notifications/safety.js и в базу (ver. 8.06): состояние
// видно на экране и снимается осознанно, с записью, кто и когда его снял.
// Подробности — в шапке того файла; коротко: предохранитель, состояние которого
// нельзя увидеть, не защищает, а создаёт ложное чувство защиты, и ровно это с
// ним и случилось.

let clinicOrgCache = { at: 0, map: {} };

async function organizationFor(clinicId) {
  if (Date.now() - clinicOrgCache.at > 60000) {
    const row = await Setting.findByPk(CLINIC_ORG_KEY);
    clinicOrgCache = { at: Date.now(), map: (row && row.value) || {} };
  }
  return clinicOrgCache.map[String(clinicId)] || DEFAULT_ORG;
}

/**
 * Ищет живую подписку на наши боты по телефону. Телефон нормализуем: в МИС он
 * записан как придётся, а у подписчика лежит в приведённом виде.
 */
async function subscriberFor(phone, platform = null) {
  if (!phone) return null;
  const normalized = misClient.normalizePhone(phone);

  const rows = await BotSubscriber.findAll({
    where: {
      phone: normalized, isBlocked: false,
      // По source здесь не отбираем (ver. 8.17). Раньше стояло source: 'bot', и
      // это был неверный вопрос: source — откуда мы узнали о человеке, а не
      // можем ли мы ему написать. Написать можно тогда, когда у подписки есть
      // наш живой бот, и ровно это проверяет цикл ниже.
      //
      // ЧТО БЫЛО НЕ ТАК. Строка, приехавшая выгрузкой из Fromni, остаётся
      // source: 'import' навсегда: dialog.upsertSubscriber проставляет source
      // только при создании, а человек, уже лежащий в выгрузке, новую строку не
      // заводит — у неё тот же ключ (платформа, организация, id пользователя).
      // Он нажимал /start, делился номером, блокировал и разблокировал бота;
      // подписка обрастала botId и статусом «опознан», а отправщик её всё равно
      // не находил — и каскад молча уходил на SMS. Снаружи это выглядело как
      // «телеграм не работает», а в журнале не было даже причины: ступень бота
      // пропускалась без записи.
      //
      // С 8.04 Telegram и MAX — отдельные ступени каскада, и спрашивают всегда
      // про одну из них. Раньше ступень называлась «bot» и брала первую
      // подходящую подписку, из-за чего поднять MAX выше Telegram было нельзя:
      // они шли одним шагом, и порядок решала выдача из базы.
      ...(platform ? { platform } : {})
    },
    // NULLS LAST: у выгрузки телефон опознан не был, и без этого Postgres
    // ставит такие строки первыми — впереди той, где человек назвался сам.
    order: [['identifiedAt', 'DESC NULLS LAST']]
  });

  for (const row of rows) {
    if (!row.botId) continue;
    const bot = await MessengerBot.findByPk(row.botId);
    if (bot && bot.isActive) return { subscriber: row, bot };
  }
  return null;
}

/**
 * Отправляет одну строку очереди. Возвращает её же — уже с исходом.
 */
/**
 * Куда слать статусы доставки. Имобис зовёт этот адрес сам — тем и отличается
 * от агрегатора, у которого судьба сообщения оставалась невидимой.
 */
function reportUrl() {
  const secret = process.env.NOTIF_REPORT_SECRET || process.env.MIS_EVENTS_SECRET;
  if (!secret) return undefined;
  const base = (process.env.BASE_URL || 'https://wiki.medcentralfa.ru').replace(/\/+$/, '');
  return `${base}/api/notifications/report/${secret}`;
}

/**
 * Свой каскад события, если он задан (ver. 8.03).
 *
 * Берём настройку только фактического шаблона филиала. Общего шаблона текста с
 * 8.11 нет: он мог содержать ссылку на карту другой клиники. Пустой каскад
 * по-прежнему означает, что способ доставки берётся из настройки филиала.
 *
 * Каскад читается в момент отправки, а не кладётся в очередь вместе с текстом.
 * Разница намеренная: текст — это обещание, данное пациенту при записи, и
 * менять его задним числом нельзя; каскад — способ доставки, и правка «больше
 * не шлём это по SMS» должна подействовать на то, что уже стоит в очереди.
 */
const eventCascadeCache = new Map();

async function cascadeOfEvent(event, medCenterId) {
  const key = `${event}|${medCenterId || ''}`;
  const hit = eventCascadeCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.value;

  const rows = await NotifTemplate.findAll({
    where: { event, isActive: true },
    attributes: ['cascade', 'medCenterId']
  });

  const own = rows.find(r => (
    r.medCenterId && medCenterId && String(r.medCenterId) === String(medCenterId)
  ));
  const picked = (own && Array.isArray(own.cascade) && own.cascade.length)
    ? own.cascade
    : null;

  eventCascadeCache.set(key, { at: Date.now(), value: picked });
  return picked;
}

// Филиал портала по клинике визита — общим сопоставлением модуля (ver. 8.17),
// по id клиники МИС с запасным вариантом по имени. Своё сопоставление по имени
// жило здесь до 8.17 и расходилось со справочником ровно там же, где остальные
// два; см. шапку branches.js.
const medCenterFor = (snap) => branches.idFor(snap);

/**
 * Текст, который уходит по конкретному каналу (ver. 8.03).
 *
 * До 8.03 текстов было два: полный «для мессенджеров» и короткий для SMS.
 * Деление шло по длине, а не по каналу, и на два своих мессенджера одного
 * текста перестало хватать — у Telegram разметка и кнопки, у MAX своя длина
 * строки.
 *
 * Порядок поиска намеренно с запасными вариантами на каждом шаге: пустой канал
 * не должен превращаться в пустое сообщение. Для SMS запасной — smsText, чтобы
 * шаблоны, не переехавшие на channelTexts, продолжали слать короткий вариант.
 *
 * @param {Object} item строка очереди
 * @param {string} channel 'telegram' | 'max' | 'sms' | 'long'
 */
function textFor(item, channel) {
  const byChannel = (item.channelTexts && typeof item.channelTexts === 'object') ? item.channelTexts : {};
  const own = byChannel[channel];
  if (own && String(own).trim()) return own;

  // Запасного текста «на все каналы» с 8.04 нет намеренно. Он приводил к тому,
  // что абзац, написанный для мессенджера, уходил в SMS тремя сегментами —
  // молча и на всей рассылке. Пустой канал теперь пропускается со своей
  // причиной в журнале, и это видно, а не выясняется по счёту.
  //
  // smsText остаётся запасным для SMS: это тот самый короткий вариант, ради
  // которого поле и заводили, и шаблоны, не переехавшие на channelTexts, должны
  // продолжать работать.
  if (channel === 'sms' && item.smsText) return item.smsText;
  return null;
}

/**
 * Собирает маршрут Имобиса из имён ступеней. Порядок сохраняется, ступень без
 * необходимых реквизитов пропускается: канал ВК без группы и SMS без имени
 * отправителя всё равно не уйдут, а молчаливая ступень в маршруте хуже, чем её
 * отсутствие.
 */
function imobisRoute(names, config, organization, texts) {
  // config уже слит с настройкой филиала (settings.imobisFor), поэтому своё имя
  // отправителя у филиала перекрывает общее просто тем, что лежит выше. Словари
  // senders/vkGroups по организациям остались от 7.95 и служат запасным
  // источником: в 8.05 их содержимое переехало в филиалы, но у сети, которая
  // ещё не переехала, они должны продолжать работать.
  const sender = config.sender || (config.senders && config.senders[organization]);
  const group = config.vkGroup || (config.vkGroups && config.vkGroups[organization]);

  const route = [];
  for (const name of names) {
    if (name === 'sms') {
      if (!sender) continue;
      route.push({ channel: 'sms', sender, text: texts.sms });
    } else if (name === 'vk') {
      if (!group) continue;
      route.push({ channel: 'vk', group: Number(group), text: texts.long });
    } else if (name === 'viber') {
      if (!sender) continue;
      route.push({ channel: 'viber', sender, text: texts.long });
    }
  }
  return route;
}

/**
 * Отправляет одну строку очереди, идя по каскаду до первой доставки.
 *
 * Ступени сгруппированы по провайдерам: у Имобиса и у Fromni каскад свой, и две
 * их ступени подряд — это один запрос, который сам остановится на доставленной.
 * Разбивать их на отдельные вызовы значило бы платить дважды.
 */
// На сколько откладывается строка, согласие по которой не удалось проверить.
// Столько же, сколько живёт пауза после отказа МИС, — раньше спрашивать нечего.
const CONSENT_RETRY_MS = 60 * 1000;

async function deliver(item, clinicId = null, medCenterId = null) {
  if (!await safety.allowedByPilot(item.phone)) {
    return item.update({ status: 'skipped', error: 'пилот: телефон вне списка проверочных номеров' });
  }

  // Отказ от оповещений — здесь, до выбора каскада и раньше всех остальных
  // условий: он закрывает все каналы разом, и ветка, в которой его забыли бы
  // спросить, означала бы сообщение вопреки подписи (ver. 8.08).
  const allowed = await consent.check({ patientId: item.patientId, phone: item.phone });
  if (!allowed.allowed) {
    // «Не знаем» и «нельзя» — разные вещи, и поступаем с ними по-разному.
    // Недоступность МИС не повод ни отправить, ни выбросить: строку
    // откладываем, и она уйдёт, как только согласие удастся проверить.
    if (allowed.unknown) {
      return item.update({
        plannedAt: new Date(Date.now() + CONSENT_RETRY_MS),
        postponedFrom: item.postponedFrom || new Date(),
        error: allowed.reason
      });
    }
    return item.update({ status: 'skipped', error: allowed.reason });
  }

  // Филиал, не подключённый к нашей рассылке, обслуживает МИС — слать поверх
  // неё значит задваивать уведомление пациенту (ver. 8.03).
  if (!await settings.branchEnabled(medCenterId)) {
    return item.update({ status: 'skipped', error: 'филиал ещё не подключён к рассылке портала' });
  }

  // Каскад ищется от частного к общему: свой у события, потом у филиала, потом
  // общий. Свой у события завели ради просьбы об отзыве — по SMS её выполнить
  // нельзя, кнопок там нет, а деньги списываются.
  const order = await settings.cascadeFor({
    eventCascade: await cascadeOfEvent(item.event, medCenterId),
    medCenterId
  });
  const quiet = await settings.quietHoursFor(medCenterId);
  const now = new Date();
  const groups = settings.groupSteps(order);

  // У Notify и SMS разные тексты: в SMS администратор может поставить короткую
  // ссылку и уложиться в один сегмент, а Notify длину не считает.
  const sms = textFor(item, 'sms');
  const notify = textFor(item, 'notify');
  const texts = { long: notify, sms };

  const organization = await organizationFor(clinicId);
  let lastError = null;
  let silencedAll = groups.length > 0;

  for (const group of groups) {
    // Ступень молчит в тихие часы — пропускаем её, но помним: если промолчали
    // все, сообщение надо отложить, а не потерять.
    const audible = group.steps.filter(step => !settings.quietFor(quiet, step));
    if (settings.isQuiet(quiet, now) && !audible.length) continue;
    silencedAll = false;

    if (group.provider === 'bot') {
      // Группа бота всегда из одной ступени — см. groupSteps: Telegram и MAX не
      // сливаются, это два независимых отправления.
      const platform = group.steps[0];

      const body = textFor(item, platform);
      if (!body) {
        lastError = `для ${platform} не задан текст`;
        continue;
      }

      const found = await subscriberFor(item.phone, platform);
      if (!found) {
        // Причину записываем обязательно. Молчаливый continue был здесь самой
        // дорогой строкой модуля: ступень бота пропускалась без следа, и
        // «почему не пришло в телеграм» приходилось выяснять по базе.
        lastError = `${platform}: по этому номеру нет подписки на наш бот`;
        continue;
      }

      try {
        const channel = getChannel(platform);
        const options = item.withConfirm && item.apptId
          ? { buttons: [[{ text: '✅ Подтверждаю', data: `confirm:${item.apptId}` }]] }
          : {};
        await channel.sendText(found.bot, found.subscriber.externalUserId, body, options);
        return item.update({ status: 'sent', channel: platform, sentAt: new Date(), error: null });
      } catch (err) {
        lastError = err.message;
        if (err.code === 'blocked') {
          // Канал закрыт навсегда — помечаем подписку, чтобы следующий раз
          // даже не пробовать.
          await found.subscriber.update({ isBlocked: true, blockedAt: new Date() });
        }
        continue;
      }
    }

    if (!item.phone) {
      lastError = 'нет телефона пациента';
      continue;
    }

    // Предохранитель — здесь, до любого внешнего провайдера. Внутри ветки он
    // защищал только её, а провайдеров стало два.
    if (!await safety.allowsProvider(group.provider)) {
      lastError = `${group.provider}: отправка наружу выключена предохранителем`;
      continue;
    }

    if (group.provider === 'imobis') {
      if (!texts.sms) {
        lastError = 'для SMS не задан текст';
        continue;
      }
      try {
        const config = await settings.imobisFor(medCenterId);
        const route = imobisRoute(group.names.filter(n => audible.includes(`imobis:${n}`)), config, organization, texts);
        if (!route.length) {
          lastError = 'у ступеней Имобиса нет имени отправителя или группы ВК';
          continue;
        }

        const sent = await imobis.send(organization, route, {
          phone: item.phone,
          customId: String(item.id),
          reportUrl: reportUrl(),
          sandbox: !!config.sandbox,
          // Токен из настроек; пусто — возьмётся IMOBIS_TOKEN из окружения.
          token: config.token
        });
        // Статус пока «принято»: доставку подтвердит отчёт, который Имобис
        // пришлёт на наш адрес.
        return item.update({
          status: 'sent',
          channel: route.map(r => `imobis:${r.channel}`).join('→'),
          externalMessageId: sent.externalMessageId,
          sentAt: new Date(),
          error: null
        });
      } catch (err) {
        lastError = `Имобис: ${err.message}`;
        continue;
      }
    }

    // Fromni — прежняя ступень, остаётся запасной. Предохранитель проверен выше,
    // одним условием на всех провайдеров.
    try {
      const names = group.steps.filter(step => {
        if (!audible.includes(step)) return false;
        return step.startsWith('sms') ? !!texts.sms : !!texts.long;
      });
      if (!names.length) continue;

      const sent = await fromni.sendText(organization, item.phone,
        { default: texts.long, 'sms+webchat': texts.sms, sms: texts.sms }, names);
      return item.update({ status: 'sent', channel: sent.channel, sentAt: new Date(), error: null });
    } catch (err) {
      lastError = `Fromni: ${err.message}`;
    }
  }

  // Промолчали все ступени — значит сейчас ночь. Откладываем до утра: человек,
  // которому перенесли завтрашний приём, должен узнать об этом, но не в час ночи.
  if (silencedAll && settings.isQuiet(quiet, now)) {
    const at = settings.nextAllowed(quiet, now);
    return item.update({
      plannedAt: at,
      postponedFrom: item.postponedFrom || now,
      error: `тихие часы, отложено до ${at.toLocaleString('ru-RU')}`
    });
  }

  return item.update({ status: 'failed', error: lastError || 'ни одна ступень каскада не сработала' });
}

/**
 * Отправка одного сообщения вручную, для проверки (переписана в 8.03).
 *
 * Отличается от боевой тремя вещами, и все три намеренны:
 *   • предохранитель второй ступени не действует — администратор набрал один
 *     номер и нажал кнопку, это не веерная рассылка;
 *   • тихие часы игнорируются: проверять канал в девять утра неудобно;
 *   • ступень называется явно, чтобы убедиться именно в SMS, а не получить
 *     сообщение в бот и остаться без ответа на исходный вопрос.
 *
 * ЧТО БЫЛО НЕ ТАК. До 8.03 эта функция знала только два провайдера — наши боты
 * и Fromni. Прямая отправка через Имобис появилась в 7.95, а сюда её не
 * добавили, и выбор «только SMS» сводился к
 *
 *     fromniSteps.filter(name => name.startsWith('sms'))
 *
 * Ступень Имобиса называется «imobis:sms» и под это условие не подходит,
 * поэтому проверка SMS напрямую отвечала «в каскаде нет подходящей ступени»
 * даже при заведённом имени отправителя. Хуже того, при каскаде с Fromni
 * фильтр находил «sms+webchat», сообщение уходило через агрегатора и проверка
 * выглядела успешной — то есть отвечала не на тот вопрос, который задавали.
 *
 * Теперь ступень выбирается по имени из каскада, а отправка идёт тем же кодом,
 * что и боевая: ветки провайдеров ниже повторяют deliver(). Расхождение между
 * «как проверили» и «как уйдёт на самом деле» — ровно то, ради чего проверка и
 * существует, и допускать его здесь нельзя.
 *
 * @param {string} step  'auto' | 'bot' | имя ступени каскада ('imobis:sms', 'sms+webchat', …)
 */
async function sendTest(item, { step = 'auto' } = {}) {
  // Предохранитель пилота проверку намеренно не касается, а отказ от оповещений
  // — касается: проверяют канал обычно на живом номере, и подпись пациента не
  // перестаёт действовать оттого, что сообщение отправили из админки.
  const allowed = await consent.check({ patientId: item.patientId, phone: item.phone });
  if (!allowed.allowed) {
    await item.update({ status: 'skipped', error: allowed.reason });
    return { error: allowed.reason };
  }

  const order = await settings.cascade();

  // Боты пробуются, когда просят их явно или когда просят «как в бою».
  if (step === 'auto' || step === 'bot') {
    const found = await subscriberFor(item.phone);
    if (found) {
      try {
        const channel = getChannel(found.bot.platform);
        await channel.sendText(found.bot, found.subscriber.externalUserId, textFor(item, found.bot.platform));
        await item.update({ status: 'sent', channel: found.bot.platform, sentAt: new Date() });
        return { channel: found.bot.platform, text: textFor(item, found.bot.platform) };
      } catch (err) {
        if (step === 'bot') {
          await item.update({ status: 'failed', error: err.message });
          return { channel: 'bot', error: err.message };
        }
      }
    } else if (step === 'bot') {
      const why = 'по этому номеру нет подписки на наши боты';
      await item.update({ status: 'failed', error: why });
      return { channel: 'bot', error: why };
    }
  }

  // Какие ступени пробовать дальше. Явно названная — только она, и это главное
  // свойство проверки: спросили про SMS напрямую — получите ответ про неё.
  //
  // Названную ступень берём как есть, не сверяясь с каскадом. Проверяют обычно
  // до того, как ступень туда поставят: «работает ли у нас вообще прямая SMS»
  // — вопрос, на который надо ответить прежде, чем менять боевую доставку.
  const wanted = step === 'auto' || step === 'bot'
    ? order.filter(name => name !== 'bot')
    : [step];

  if (!wanted.length) {
    const why = 'в каскаде нет ступеней, кроме наших ботов';
    await item.update({ status: 'failed', error: why });
    return { error: why };
  }

  if (!item.phone) {
    await item.update({ status: 'failed', error: 'нет номера телефона' });
    return { error: 'нет номера телефона' };
  }

  const short = textFor(item, 'sms');
  const long = textFor(item, 'notify');
  let lastError = null;

  for (const group of settings.groupSteps(wanted)) {
    if (group.provider === 'imobis') {
      try {
        const config = await settings.imobis();
        const organization = await organizationFor(null);
        const route = imobisRoute(group.names, config, organization, { long: item.text, sms: short });

        if (!route.length) {
          lastError = 'у ступеней Имобиса нет имени отправителя или группы ВК — заполните их в настройках';
          continue;
        }

        const sent = await imobis.send(organization, route, {
          phone: item.phone,
          customId: String(item.id),
          reportUrl: reportUrl(),
          sandbox: !!config.sandbox,
          // Токен из настроек; пусто — возьмётся IMOBIS_TOKEN из окружения.
          token: config.token
        });

        // Как и в бою, это ещё не доставка: Имобис подтвердит её отчётом на наш
        // адрес. В журнале строка так и останется — «принято», пока отчёт не
        // придёт, и именно там видно «routing is not configured» и подобное.
        await item.update({
          status: 'sent',
          channel: group.names.map(n => `imobis:${n}`).join('→'),
          externalMessageId: sent.externalMessageId,
          sentAt: new Date(),
          error: null
        });
        return {
          channel: group.names.map(n => `imobis:${n}`).join('→'),
          organization,
          accepted: true,
          text: route[0].text
        };
      } catch (err) {
        lastError = `Имобис: ${err.message}`;
        continue;
      }
    }

    try {
      const organization = await organizationFor(null);
      const names = group.steps.filter(name => (
        name.startsWith('sms') ? !!short : !!long
      ));
      if (!names.length) {
        lastError = 'для выбранной ступени не задан текст';
        continue;
      }
      const texts = { default: long, 'sms+webchat': short, sms: short };
      const sent = await fromni.sendText(organization, item.phone, texts, names);
      await item.update({ status: 'sent', channel: sent.channel, sentAt: new Date(), error: null });
      return {
        channel: sent.channel,
        organization,
        text: names.some(n => n.startsWith('sms')) ? short : long
      };
    } catch (err) {
      lastError = `Fromni: ${err.message}`;
    }
  }

  await item.update({ status: 'failed', error: lastError || 'ни одна ступень не сработала' });
  return { error: lastError || 'ни одна ступень не сработала' };
}
/**
 * Один проход отправщика: берёт всё, чему подошёл срок.
 *
 * @returns {Promise<{sent:number, failed:number}>}
 */
async function runOnce(limit = 100) {
  const due = await NotifOutbox.findAll({
    where: { status: 'pending', plannedAt: { [Op.lte]: new Date() } },
    order: [['plannedAt', 'ASC']],
    limit
  });
  // Отправщик обычно живёт отдельным процессом. Читаем запрет свежим один раз
  // на проход, чтобы сохранение в админке не ждало истечения локального кэша.
  const blockedDoctors = due.length ? await doctorBlocklist.readAll({ fresh: true }) : null;

  let sent = 0;
  let failed = 0;

  for (const item of due) {
    // Клиника нужна для выбора аккаунта Fromni, а в самой очереди её нет —
    // достаём из снимка визита. Дублировать поле в очередь незачем: оно
    // требуется только на второй ступени и только в момент отправки.
    let clinicId = null;
    let medCenterId = null;
    let snap = null;
    if (item.apptId) {
      snap = await NotifAppointment.findByPk(item.apptId, {
        attributes: ['clinicId', 'clinicName', 'doctorId', 'doctorName']
      });
      clinicId = snap ? snap.clinicId : null;
      // Филиал портала — для его собственных настроек и текстов (ver. 8.03).
      medCenterId = snap ? await medCenterFor(snap) : null;
    }

    try {
      // Повторная проверка непосредственно перед отправкой закрывает очередь,
      // созданную до того, как врача добавили в стоп-лист.
      if (snap && doctorBlocklist.matchesFor(snap, blockedDoctors, medCenterId)) {
        await item.update({ status: 'skipped', error: 'служебный врач: отправка заблокирована' });
        continue;
      }
      const done = await deliver(item, clinicId, medCenterId);
      if (done.status === 'sent') sent++; else failed++;
    } catch (err) {
      // Непойманное здесь означало бы остановку всей очереди из-за одной строки.
      console.error(`[sender] строка ${item.id}:`, err.message);
      await item.update({ status: 'failed', error: err.message });
      failed++;
    }
  }

  return { sent, failed };
}

module.exports = {
  runOnce, deliver, sendTest, subscriberFor, organizationFor,
  CLINIC_ORG_KEY, safety, consent
};
