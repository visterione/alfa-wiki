'use strict';

/**
 * Кто написал: карточка пациента для открытой линии (ver. 7.99).
 *
 * Оператору бесполезен номер телефона в заголовке чата — по нему всё равно
 * приходится лезть в МИС. Поэтому в заголовке стоит человек: «№123456 Иванов
 * Иван Иванович (01.01.1999) +7 (900) 123-45-67».
 *
 * Два случая, ради которых написан весь файл:
 *
 *   • карты ещё нет — человек пишет впервые, и в МИС его нет вовсе. Тогда
 *     остаётся один телефон, и это нормальное состояние, а не ошибка;
 *   • карт несколько — один номер записан у мамы и у детей. Берём самого
 *     старшего: почти всегда пишет именно он, а если нет — оператор уточнит в
 *     разговоре. Угадывать точнее нечем, и заставлять выбирать из списка на
 *     каждое сообщение дороже, чем один вопрос раз в сто обращений.
 *
 * Результат хранится снимком на подписчике, а не запрашивается на лету: список
 * обращений иначе ходил бы в МИС на каждую строку.
 */

const { Op } = require('sequelize');
const { BotSubscriber, MisPatient } = require('../models');
const misClient = require('./misClient');

// Как часто перепроверять человека без карты. Карта заводится на первом визите,
// и человек, написавший до него, должен опознаться сам — но не ценой запроса в
// МИС на каждое сообщение.
const RECHECK_MS = 12 * 60 * 60 * 1000;

/** «01.01.1999» → метка времени. Неизвестная дата уезжает в конец сортировки. */
function birthTime(value) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value || '').trim());
  if (!m) return Number.POSITIVE_INFINITY;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

function fullName(row) {
  return [row.last_name, row.first_name, row.third_name].filter(Boolean).join(' ').trim();
}

/**
 * Из нескольких карточек по одному номеру выбирает самую старшую.
 *
 * Правило заказчика: один телефон нередко записан у мамы и у детей, и почти
 * всегда пишет взрослый. Если нет — оператор уточнит в разговоре; заставлять
 * его выбирать из списка на каждое сообщение дороже, чем один вопрос раз в сто
 * обращений. Карточка без даты рождения проигрывает любой с датой: угадывать по
 * ней нечего.
 */
function pickOldest(rows) {
  if (!rows || !rows.length) return null;
  return rows.slice().sort((a, b) => birthTime(a.birth_date) - birthTime(b.birth_date))[0];
}

/**
 * Карточки, которых нет в местном справочнике, — спрашиваем у МИС и заодно
 * кладём в справочник: он и так пополняется, а тут ответ уже на руках.
 */
async function fetchMissing(ids) {
  if (!ids.length) return [];

  const res = await misClient.misRequest('getPatient', { id: ids.join(',') });
  const raw = res && res.data;
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  const rows = list.filter(p => p && p.patient_id != null).map(p => ({
    patient_id: String(p.patient_id),
    number: p.number != null ? String(p.number) : null,
    last_name: p.last_name || '',
    first_name: p.first_name || '',
    third_name: p.third_name || '',
    birth_date: p.birth_date || null,
    mis_updated: p.date_updated || p.date_created || null,
    synced_at: new Date()
  }));

  if (rows.length) {
    await MisPatient.bulkCreate(rows, {
      updateOnDuplicate: ['number', 'last_name', 'first_name', 'third_name', 'birth_date', 'mis_updated', 'synced_at']
    });
  }
  return rows;
}

/**
 * Ищет карты по телефону. Отдельно от разговора с ботом: там это делается один
 * раз при знакомстве, а здесь — для тех, у кого карта появилась позже.
 */
async function findByPhone(phone) {
  const patients = await misClient.getPatientsByPhone(phone);
  return Array.isArray(patients) ? patients.map(p => String(p.patient_id)).filter(Boolean) : [];
}

/**
 * Обновляет снимок карточки у подписчика.
 *
 * Молчит при любой неудаче: МИС недоступна — обращение всё равно должно дойти
 * до оператора, пусть и подписанное одним телефоном. Следующее сообщение
 * попробует снова.
 *
 * @param {Object} subscriber запись BotSubscriber
 * @param {boolean} [force] спросить МИС, даже если проверяли недавно
 * @returns {Promise<Object>} тот же подписчик
 */
async function refresh(subscriber, force = false) {
  if (!subscriber) return subscriber;

  const checked = subscriber.patientCheckedAt ? new Date(subscriber.patientCheckedAt).getTime() : 0;
  const fresh = Date.now() - checked < RECHECK_MS;
  if (fresh && !force && subscriber.patientName) return subscriber;

  try {
    let ids = (subscriber.patientIds || []).map(String).filter(Boolean);

    // Карты нет, а телефон есть — вдруг человек с прошлого раза дошёл до
    // регистратуры. Проверяем не чаще, чем раз в RECHECK_MS.
    if (!ids.length && subscriber.phone && (!fresh || force)) {
      ids = await findByPhone(subscriber.phone);
      if (ids.length) await subscriber.update({ patientIds: ids });
    }

    if (!ids.length) {
      await subscriber.update({ patientCheckedAt: new Date() });
      return subscriber;
    }

    const known = await MisPatient.findAll({ where: { patient_id: { [Op.in]: ids } } });
    const missing = ids.filter(id => !known.some(r => String(r.patient_id) === id));
    const rows = known.map(r => r.get({ plain: true })).concat(missing.length ? await fetchMissing(missing) : []);
    if (!rows.length) {
      await subscriber.update({ patientCheckedAt: new Date() });
      return subscriber;
    }

    const chosen = pickOldest(rows);

    await subscriber.update({
      patientCard: chosen.number || null,
      patientName: fullName(chosen) || null,
      patientBirthDate: chosen.birth_date || null,
      patientCheckedAt: new Date()
    });
  } catch (err) {
    console.error('[open-line] карточка пациента не обновлена:', err.message);
  }

  return subscriber;
}

/**
 * Строка для заголовка чата. Одна на весь модуль, чтобы список и переписка не
 * разошлись в написании.
 */
function title(subscriber) {
  if (!subscriber) return 'Неизвестный';

  const phone = subscriber.phone ? misClient.formatMobile(subscriber.phone) : '';
  if (!subscriber.patientName) return phone || 'Без номера';

  const card = subscriber.patientCard ? `№${subscriber.patientCard} ` : '';
  const birth = subscriber.patientBirthDate ? ` (${subscriber.patientBirthDate})` : '';
  return `${card}${subscriber.patientName}${birth}${phone ? ` ${phone}` : ''}`;
}

module.exports = { refresh, title, findByPhone, pickOldest };
