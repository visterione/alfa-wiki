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
const { NotifOutbox, NotifAppointment, BotSubscriber, MessengerBot, Setting } = require('../../models');
const { getChannel } = require('../messengers');
const fromni = require('../messengers/fromni');
const imobis = require('../messengers/imobis');
const misClient = require('../misClient');
const settings = require('./settings');

// Какой организации принадлежит клиника МИС. Нужно, чтобы уйти во Fromni под
// правильным аккаунтом: у каждой организации он свой. Заполняется в настройках,
// ключ clinic_id → ключ организации.
const CLINIC_ORG_KEY = 'notif_clinic_org';
const DEFAULT_ORG = process.env.FROMNI_DEFAULT_ORG || 'alfa';

// ── Предохранители пилота ─────────────────────────────────────────────────
//
// Детектор видит изменения по всей сети, а не только по пилотной клинике.
// Значит без ограничителей первый же запуск отправит SMS тысячам живых
// пациентов — поверх тех, что им уже шлёт МИС. Поэтому по умолчанию:
//
//   • вторая ступень (Fromni, то есть Notify и SMS) выключена: пока идёт
//     обкатка, уведомления уходят только подписчикам наших ботов;
//   • можно сузить круг до списка телефонов — всё остальное помечается
//     пропущенным с причиной, а не исчезает молча.
//
// Оба ограничителя снимаются в .env осознанно, в момент боевого переключения.
const ALLOW_FROMNI = process.env.NOTIFIER_ALLOW_FROMNI === 'true';
const PILOT_PHONES = (process.env.NOTIFIER_PILOT_PHONES || '')
  .split(',').map(s => misClient.normalizePhone(s.trim())).filter(Boolean);

function allowedByPilot(phone) {
  if (!PILOT_PHONES.length) return true;
  return PILOT_PHONES.includes(misClient.normalizePhone(phone || ''));
}

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
async function subscriberFor(phone) {
  if (!phone) return null;
  const normalized = misClient.normalizePhone(phone);

  const rows = await BotSubscriber.findAll({
    where: { phone: normalized, isBlocked: false, source: 'bot' },
    order: [['identifiedAt', 'DESC']]
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
 * Собирает маршрут Имобиса из имён ступеней. Порядок сохраняется, ступень без
 * необходимых реквизитов пропускается: канал ВК без группы и SMS без имени
 * отправителя всё равно не уйдут, а молчаливая ступень в маршруте хуже, чем её
 * отсутствие.
 */
function imobisRoute(names, config, organization, texts) {
  const sender = (config.senders && config.senders[organization]) || config.sender;
  const group = (config.vkGroups && config.vkGroups[organization]) || config.vkGroup;

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
async function deliver(item, clinicId = null) {
  if (!allowedByPilot(item.phone)) {
    return item.update({ status: 'skipped', error: 'пилот: телефон вне списка NOTIFIER_PILOT_PHONES' });
  }

  const order = await settings.cascade();
  const quiet = await settings.quietHours();
  const now = new Date();
  const groups = settings.groupSteps(order);

  const short = item.smsText || item.text;
  const texts = { long: item.text, sms: short };

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
      const found = await subscriberFor(item.phone);
      if (!found) continue;
      try {
        const channel = getChannel(found.bot.platform);
        const options = item.withConfirm && item.apptId
          ? { buttons: [[{ text: '✅ Подтверждаю', data: `confirm:${item.apptId}` }]] }
          : {};
        await channel.sendText(found.bot, found.subscriber.externalUserId, item.text, options);
        return item.update({ status: 'sent', channel: found.bot.platform, sentAt: new Date(), error: null });
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

    if (group.provider === 'imobis') {
      try {
        const config = await settings.imobis();
        const route = imobisRoute(group.names.filter(n => audible.includes(`imobis:${n}`)), config, organization, texts);
        if (!route.length) {
          lastError = 'у ступеней Имобиса нет имени отправителя или группы ВК';
          continue;
        }

        const sent = await imobis.send(organization, route, {
          phone: item.phone,
          customId: String(item.id),
          reportUrl: reportUrl(),
          sandbox: !!config.sandbox
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

    // Fromni — прежняя ступень, остаётся запасной.
    if (!ALLOW_FROMNI) {
      lastError = 'вторая ступень выключена (NOTIFIER_ALLOW_FROMNI)';
      continue;
    }
    try {
      const names = group.steps.filter(step => audible.includes(step));
      if (!names.length) continue;

      const sent = await fromni.sendText(organization, item.phone,
        { default: item.text, 'sms+webchat': short, sms: short }, names);
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
 * Отправка одного сообщения вручную, для проверки.
 *
 * Отличается от боевой тремя вещами, и все три намеренны:
 *   • предохранитель второй ступени не действует — администратор набрал один
 *     номер и нажал кнопку, это не веерная рассылка;
 *   • тихие часы игнорируются: проверять канал в девять утра неудобно;
 *   • ступень можно назвать явно, чтобы убедиться именно в SMS, а не получить
 *     сообщение в бот и остаться без ответа на исходный вопрос.
 *
 * @param {'auto'|'bot'|'fromni'|'sms'} step
 */
async function sendTest(item, { step = 'auto' } = {}) {
  const order = await settings.cascade();
  const fromniSteps = order.filter(name => name !== 'bot');

  if (step === 'auto' || step === 'bot') {
    const found = await subscriberFor(item.phone);
    if (found) {
      try {
        const channel = getChannel(found.bot.platform);
        await channel.sendText(found.bot, found.subscriber.externalUserId, item.text);
        await item.update({ status: 'sent', channel: found.bot.platform, sentAt: new Date() });
        return { channel: found.bot.platform, text: item.text };
      } catch (err) {
        if (step === 'bot') {
          await item.update({ status: 'failed', error: err.message });
          return { channel: 'bot', error: err.message };
        }
      }
    } else if (step === 'bot') {
      await item.update({ status: 'failed', error: 'по этому номеру нет подписки на наши боты' });
      return { channel: 'bot', error: 'по этому номеру нет подписки на наши боты' };
    }
  }

  // Явно попросили SMS — сужаем каскад до последней ступени, иначе Fromni
  // доставит через Notify и вопрос «дошёл ли наш текст по SMS» останется открытым.
  const steps = step === 'sms'
    ? fromniSteps.filter(name => name.startsWith('sms'))
    : fromniSteps;

  if (!steps.length) {
    await item.update({ status: 'failed', error: 'в каскаде нет подходящей ступени' });
    return { error: 'в каскаде нет подходящей ступени' };
  }

  const short = item.smsText || item.text;
  const texts = { default: item.text, 'sms+webchat': short, sms: short };

  try {
    const organization = await organizationFor(null);
    const sent = await fromni.sendText(organization, item.phone, texts, steps);
    await item.update({ status: 'sent', channel: sent.channel, sentAt: new Date() });
    return { channel: sent.channel, organization, text: steps.some(n => n.startsWith('sms')) ? short : item.text };
  } catch (err) {
    await item.update({ status: 'failed', error: err.message });
    return { error: err.message };
  }
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

  let sent = 0;
  let failed = 0;

  for (const item of due) {
    // Клиника нужна для выбора аккаунта Fromni, а в самой очереди её нет —
    // достаём из снимка визита. Дублировать поле в очередь незачем: оно
    // требуется только на второй ступени и только в момент отправки.
    let clinicId = null;
    if (item.apptId) {
      const snap = await NotifAppointment.findByPk(item.apptId, { attributes: ['clinicId'] });
      clinicId = snap ? snap.clinicId : null;
    }

    try {
      const done = await deliver(item, clinicId);
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
  runOnce, deliver, sendTest, subscriberFor, organizationFor, allowedByPilot,
  CLINIC_ORG_KEY, ALLOW_FROMNI, PILOT_PHONES
};
