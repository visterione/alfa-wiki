'use strict';

/**
 * Почтовый клуб (ver. 8.79) — списки подписчиков рассылок по медцентрам.
 *
 * ── Откуда берутся подписчики ────────────────────────────────────────────────
 *
 * Сайты медцентров делает сторонний разработчик. На каждом сайте — блок
 * «Почтовый клуб» с одним полем, и сервер сайта шлёт адрес в наш публичный API
 * вместе с clinic_id своей клиники. Сюда же можно добавить адрес руками из
 * портала — на случай «запишите меня» по телефону.
 *
 * ── Почему clinic_id МИС, а не наш код медцентра ─────────────────────────────
 *
 * Разработчик сайтов уже знает clinic_id: тем же номером он спрашивает
 * длительность приёма в /api/public/v1/booking. Второй идентификатор той же
 * клиники он бы неизбежно перепутал с первым. clinic_id ищется в
 * MedCenter.misClinicIds, поэтому соответствие живёт в справочнике, который
 * правит заказчик, а не в коде.
 *
 * ── Почему адрес записывается сразу ──────────────────────────────────────────
 *
 * Подтверждения письмом нет по решению заказчика: каждый лишний шаг теряет
 * часть подписчиков. Взамен строка хранит consent — страницу, IP и браузер
 * посетителя, ключ сайта. Это единственный ответ на вопрос «откуда у вас мой
 * адрес», и поэтому он пишется при каждой подписке, включая повторную.
 */

const { UniqueConstraintError } = require('sequelize');
const optout = require('./emailOptout');

// Лениво, как в emailOptout.js: разбор и проверка входа должны оставаться
// проверяемыми без базы.
const models = () => require('../models');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const normalizeEmail = optout.normalize;

function isValidEmail(email) {
  const addr = normalizeEmail(email);
  return addr.length <= 254 && EMAIL_RE.test(addr);
}

/**
 * clinic_id приходит с сайта числом или строкой, иногда с пробелами. В
 * справочнике он строка — сравниваем строками.
 */
function normalizeClinicId(raw) {
  const str = String(raw ?? '').trim();
  return /^\d{1,9}$/.test(str) ? String(Number(str)) : null;
}

/**
 * Урезанный снимок того, откуда пришла подписка. Ограничения длины — не
 * формальность: поля приходят от чужого сервера, и хранить в них мегабайт
 * мусора незачем.
 */
function consentOf({ pageUrl, visitorIp, visitorUserAgent, requestIp } = {}) {
  const cut = (v, n) => (v ? String(v).trim().slice(0, n) : null);
  const out = {
    pageUrl: cut(pageUrl, 500),
    ip: cut(visitorIp, 64),
    userAgent: cut(visitorUserAgent, 400),
    requestIp: cut(requestIp, 64),
    at: new Date().toISOString(),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

/**
 * Клиники, у которых может быть клуб: действующие филиалы, куда ходят
 * пациенты. АУП и «Направители» — учётные единицы, писем от их имени не бывает.
 * Берутся из общего справочника (services/medCenters.js), как требует его
 * шапка, а не отдельным запросом.
 */
async function clubCenters() {
  const rows = await require('./medCenters').list();
  return rows.filter(r => r.servesPatients);
}

/**
 * Медцентр по clinic_id МИС.
 *
 * Ровно один — или ничего. Два медцентра с одним clinic_id — ошибка
 * справочника, и выбирать между ними наугад значит раскладывать подписчиков
 * по чужим клубам.
 *
 * @returns {Promise<{ medCenter?: object, error?: 'unknown_clinic'|'ambiguous_clinic' }>}
 */
async function findMedCenterByClinicId(clinicId) {
  const id = normalizeClinicId(clinicId);
  if (!id) return { error: 'unknown_clinic' };
  const rows = (await clubCenters())
    .filter(r => (r.misClinicIds || []).some(v => normalizeClinicId(v) === id));
  if (rows.length === 0) return { error: 'unknown_clinic' };
  if (rows.length > 1) return { error: 'ambiguous_clinic' };
  return { medCenter: rows[0] };
}

/**
 * Записать адрес в клуб.
 *
 * Повторная подписка — не ошибка: человек мог забыть, что уже подписан, или
 * нажать кнопку дважды. Отписавшийся, который снова оставил адрес на сайте,
 * возвращается в клуб — это новое явное согласие, и consent переписывается
 * на него. Общий чёрный список (email_optouts) подписка с сайта не трогает:
 * его снимают только руками в портале.
 *
 * @returns {Promise<{ subscriber, status: 'subscribed'|'already_subscribed'|'resubscribed' }>}
 */
async function subscribe({ email, medCenterId, source = 'site', consent = {}, apiClientId = null, createdBy = null }) {
  const { MailClubSubscriber } = models();
  const addr = normalizeEmail(email);

  const reactivate = async (row) => {
    if (row.status === 'active') return { subscriber: row, status: 'already_subscribed' };
    await row.update({
      status: 'active',
      source,
      consent,
      apiClientId,
      createdBy,
      subscribedAt: new Date(),
      unsubscribedAt: null,
      unsubscribeSource: null,
    });
    return { subscriber: row, status: 'resubscribed' };
  };

  const existing = await MailClubSubscriber.findOne({ where: { email: addr, medCenterId } });
  if (existing) return reactivate(existing);

  try {
    const row = await MailClubSubscriber.create({
      email: addr, medCenterId, source, consent, apiClientId, createdBy, status: 'active',
    });
    return { subscriber: row, status: 'subscribed' };
  } catch (error) {
    // Два запроса с одним адресом разминулись на миллисекунды: строку уже
    // создал соседний. Для человека это та же подписка, а не сбой.
    if (error instanceof UniqueConstraintError) {
      const row = await MailClubSubscriber.findOne({ where: { email: addr, medCenterId } });
      if (row) return reactivate(row);
    }
    throw error;
  }
}

/**
 * Отписать от одного клуба. Строка остаётся со статусом: иначе следующий же
 * импорт или ручное добавление вернул бы человека молча, а история согласия
 * пропала бы.
 */
async function unsubscribe(email, medCenterId, { source = 'link' } = {}) {
  const addr = normalizeEmail(email);
  if (!addr || !medCenterId) return false;
  const [count] = await models().MailClubSubscriber.update(
    { status: 'unsubscribed', unsubscribedAt: new Date(), unsubscribeSource: source },
    { where: { email: addr, medCenterId, status: 'active' } }
  );
  return count > 0;
}

/**
 * Получатели рассылки из клубов.
 *
 * У каждого получателя помечен клуб (club = medCenterId): по нему в письме
 * собирается ссылка отписки именно от этого медцентра, и по нему же в момент
 * отправки отсеиваются отписавшиеся. Адрес, состоящий в двух выбранных клубах,
 * попадает в список один раз — с первым клубом по порядку выбора.
 */
async function recipientsOf(medCenterIds) {
  const ids = [...new Set((medCenterIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await models().MailClubSubscriber.findAll({
    where: { medCenterId: ids, status: 'active' },
    attributes: ['email', 'medCenterId'],
    order: [['subscribedAt', 'ASC']],
  });
  const byClub = new Map(ids.map(id => [id, []]));
  for (const r of rows) byClub.get(r.medCenterId)?.push(r.email);

  const seen = new Set();
  const out = [];
  for (const id of ids) {
    for (const addr of byClub.get(id)) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      out.push({ email: addr, displayName: addr, userId: null, club: id });
    }
  }
  return out;
}

/**
 * Какие из получателей клуба от него отписаны. Вызывается из
 * emailOptout.filterRecipients в момент отправки, а не набора списка: между
 * ними у отложенной рассылки проходят дни.
 *
 * @returns {Promise<Set<string>>} ключи вида `адрес|medCenterId`
 */
async function unsubscribedKeys(recipients) {
  const withClub = (recipients || []).filter(r => r?.club && r?.email);
  if (!withClub.length) return new Set();
  const rows = await models().MailClubSubscriber.findAll({
    where: {
      email: [...new Set(withClub.map(r => normalizeEmail(r.email)))],
      medCenterId: [...new Set(withClub.map(r => r.club))],
      status: 'unsubscribed',
    },
    attributes: ['email', 'medCenterId'],
  });
  return new Set(rows.map(r => `${r.email}|${r.medCenterId}`));
}

module.exports = {
  isValidEmail,
  normalizeEmail,
  normalizeClinicId,
  consentOf,
  clubCenters,
  findMedCenterByClinicId,
  subscribe,
  unsubscribe,
  recipientsOf,
  unsubscribedKeys,
};
