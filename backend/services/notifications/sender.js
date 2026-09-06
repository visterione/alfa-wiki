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
const misClient = require('../misClient');

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
async function deliver(item, clinicId = null) {
  if (!allowedByPilot(item.phone)) {
    return item.update({ status: 'skipped', error: 'пилот: телефон вне списка NOTIFIER_PILOT_PHONES' });
  }

  const found = await subscriberFor(item.phone);

  // Ступень 1: свой бот.
  if (found) {
    try {
      const channel = getChannel(found.bot.platform);
      const options = item.withConfirm && item.apptId
        ? { buttons: [[{ text: '✅ Подтверждаю', data: `confirm:${item.apptId}` }]] }
        : {};

      await channel.sendText(found.bot, found.subscriber.externalUserId, item.text, options);
      return item.update({ status: 'sent', channel: found.bot.platform, sentAt: new Date(), error: null });
    } catch (err) {
      if (err.code === 'blocked') {
        // Канал закрыт навсегда — помечаем подписку, чтобы следующий раз даже не
        // пробовать, и уходим на следующую ступень.
        await found.subscriber.update({ isBlocked: true, blockedAt: new Date() });
      } else {
        console.warn(`[sender] бот не принял (${err.code || 'ошибка'}): ${err.message} — ухожу во Fromni`);
      }
    }
  }

  // Ступень 2: Fromni. Кнопки сюда не передаём: подтверждение визита живёт
  // только в боте, у SMS его в принципе быть не может.
  if (!ALLOW_FROMNI) {
    return item.update({ status: 'skipped', error: 'вторая ступень выключена (NOTIFIER_ALLOW_FROMNI)' });
  }
  if (!item.phone) {
    return item.update({ status: 'failed', error: 'нет телефона пациента' });
  }

  try {
    const organization = await organizationFor(clinicId);
    const sent = await fromni.sendText(organization, item.phone, item.text);
    return item.update({ status: 'sent', channel: sent.channel, sentAt: new Date(), error: null });
  } catch (err) {
    return item.update({ status: 'failed', error: err.message });
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
  runOnce, deliver, subscriberFor, organizationFor, allowedByPilot,
  CLINIC_ORG_KEY, ALLOW_FROMNI, PILOT_PHONES
};
