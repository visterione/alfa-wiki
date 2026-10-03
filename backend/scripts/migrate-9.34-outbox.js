'use strict';

/**
 * Журнал рассылки: правка уже записанных строк (ver. 9.34).
 *
 * Две ошибки 9.23–9.33 исправлены в коде, но строки, записанные до исправления,
 * остались какими были. Чинит их этот скрипт, один раз:
 *
 *   1. Путь по каскаду лежал не в порядке каскада: ступень, выпавшая из
 *      маршрута Имобиса или промолчавшая в тихие часы, записывалась раньше
 *      переданных провайдеру, и «SMS → Notify» в журнале выглядело как
 *      «Notify → SMS». Переставляем по каскаду события и медцентра строки.
 *      Каскад берётся нынешний — поэтому скрипт и запускается один раз, сразу
 *      после выката: позже каскад могут поменять, и старые строки выстроились бы
 *      по новому порядку, которого при их отправке не было. Строку, ступени
 *      которой с каскадом не совпадают (каскад уже меняли), не трогаем.
 *
 *   2. Отказ провайдера статус строки не менял, и сообщение, не дошедшее ни
 *      одним каналом, числилось в «Доставлено». Если последний отчёт по строке —
 *      отказ, значит, каскад кончился ничем: оставшиеся «передано» ступени
 *      помечаем недоставленными, строку — failed. Последним отчётом был бы
 *      «доставлено», если бы хоть одна ступень сработала.
 *
 * Запуск из папки backend:
 *   npm run migrate:9.34:check     сколько строк будет исправлено, ничего не меняя
 *   npm run migrate:9.34           исправить
 */

require('dotenv').config();

const { Op } = require('sequelize');
const { sequelize, NotifOutbox, NotifAppointment } = require('../models');
const sender = require('../services/notifications/sender');
const branches = require('../services/notifications/branches');
const { FAILED } = require('../services/notifications/deliveryReport');

const ALIVE = ['sent', 'handed', 'delivered'];
const BATCH = 500;
const isCheck = process.argv.includes('--check');

const medCenterCache = new Map();
async function medCenterOf(apptId) {
  if (!apptId) return null;
  if (medCenterCache.has(apptId)) return medCenterCache.get(apptId);
  const snap = await NotifAppointment.findByPk(apptId, { attributes: ['clinicId', 'clinicName'] });
  const id = snap ? await branches.idFor(snap) : null;
  medCenterCache.set(apptId, id);
  return id;
}

const cascadeCache = new Map();
async function cascadeOf(event, medCenterId) {
  const key = `${event}|${medCenterId || ''}`;
  if (!cascadeCache.has(key)) cascadeCache.set(key, await sender.cascadeOf(event, medCenterId).catch(() => null));
  return cascadeCache.get(key);
}

function reorder(attempts, cascade) {
  if (!Array.isArray(cascade) || !cascade.length) return null;
  if (!attempts.every(a => cascade.includes(a.step))) return null;
  const sorted = [...attempts].sort((a, b) => cascade.indexOf(a.step) - cascade.indexOf(b.step));
  return sorted.some((a, i) => a !== attempts[i]) ? sorted : null;
}

async function main() {
  let lastId = null;
  let seen = 0;
  let reordered = 0;
  let failed = 0;

  for (;;) {
    const where = {
      status: { [Op.in]: ['sent', 'failed'] },
      [Op.and]: [sequelize.literal('jsonb_array_length(attempts) > 0')]
    };
    if (lastId) where.id = { [Op.gt]: lastId };
    const rows = await NotifOutbox.findAll({
      attributes: ['id', 'apptId', 'event', 'status', 'error', 'deliveryStatus', 'attempts'],
      where,
      order: [['id', 'ASC']],
      limit: BATCH
    });
    if (!rows.length) break;

    for (const row of rows) {
      seen++;
      lastId = row.id;
      const patch = {};
      let attempts = row.attempts.map(a => ({ ...a }));

      if (row.event !== 'test') {
        const sorted = reorder(attempts, await cascadeOf(row.event, await medCenterOf(row.apptId)));
        if (sorted) {
          attempts = sorted;
          patch.attempts = attempts;
          reordered++;
        }
      }

      if (row.status === 'sent' && FAILED.includes(String(row.deliveryStatus || '').toLowerCase())) {
        for (const a of attempts) {
          if (a.result !== 'handed') continue;
          a.result = 'undelivered';
          a.error = a.error || row.error || `провайдер: ${row.deliveryStatus}`;
        }
        if (!attempts.some(a => ALIVE.includes(a.result))) {
          patch.attempts = attempts;
          patch.status = 'failed';
          failed++;
        }
      }

      if (Object.keys(patch).length && !isCheck) {
        // Без updatedAt: строка не менялась по существу, и время её последнего
        // события в журнале сдвигаться не должно.
        await row.update(patch, { silent: true });
      }
    }
  }

  console.log(`${isCheck ? 'Проверка' : 'Готово'}: строк с путём ${seen}, путь переставлен у ${reordered}, `
    + `в «не доставлено» переведено ${failed}${isCheck ? ' (ничего не изменено)' : ''}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
