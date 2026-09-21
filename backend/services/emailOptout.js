'use strict';

/**
 * Отписка от почтовых рассылок (ver. 8.43).
 *
 * ── Почему это появилось вместе с конструктором ──────────────────────────────
 *
 * Пока анонсы уходили сотрудникам, отписка была вопросом вежливости: человек,
 * которому надоело, заводил правило в почтовом клиенте. С выходом рассылок на
 * пациентов она стала условием доставки. Gmail с февраля 2024 требует от
 * отправителей, шлющих больше 5000 писем в сутки, отписку в один клик —
 * заголовок List-Unsubscribe и работающий адрес за ним. Без этого в спам уходит
 * не конкретное письмо, а репутация домена, то есть вся рассылка разом.
 *
 * ── Почему токен, а не ссылка с адресом в открытую ───────────────────────────
 *
 * Ссылка вида /unsubscribe?email=ivan@mail.ru — это форма для отписки кого
 * угодно от чего угодно, доступная всякому, кто догадается подставить чужой
 * адрес. Поэтому адрес едет внутри подписанного токена: подделать его нельзя,
 * а прочитать — можно, и это нормально, человек и так знает свой адрес.
 *
 * Срока годности у токена нет намеренно. Письмо живёт в почтовом ящике годами,
 * и отписка, переставшая работать через месяц, — это жалоба на спам вместо
 * отписки. Отозвать такую ссылку можно только сменой EMAIL_OPTOUT_SECRET, и это
 * осознанный размен.
 */

const crypto = require('crypto');

// Модель подтягивается лениво, а не в шапке файла: require('../models') поднимает
// соединение с базой, а половина этого модуля (сборка и разбор токена) базы не
// касается вовсе и должна оставаться проверяемой без неё.
const model = () => require('../models').EmailOptOut;

const secret = () => process.env.EMAIL_OPTOUT_SECRET || process.env.JWT_SECRET || '';

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (str) => Buffer.from(
  String(str).replace(/-/g, '+').replace(/_/g, '/'),
  'base64'
).toString('utf8');

const normalize = (email) => String(email || '').trim().toLowerCase();

const sign = (payload) => b64url(
  crypto.createHmac('sha256', secret()).update(payload).digest()
).slice(0, 27);

/** Токен отписки для адреса. Одинаковый для одного и того же адреса всегда. */
function makeToken(email) {
  const addr = normalize(email);
  if (!addr) return '';
  const payload = b64url(addr);
  return `${payload}.${sign(payload)}`;
}

/**
 * Разбор токена. Сравнение подписи — timingSafeEqual, а не ===: адрес отписки
 * доступен из интернета без всякой авторизации, и подбор подписи по времени
 * ответа здесь не теория.
 */
function readToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const email = normalize(fromB64url(payload));
    return email && email.includes('@') ? email : null;
  } catch {
    return null;
  }
}

/** Полный адрес страницы отписки — то, что подставляется в письмо. */
function unsubscribeUrl(email) {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const token = makeToken(email);
  if (!token) return `${base}/api/email-optout`;
  return `${base}/api/email-optout/${token}`;
}

/** Записать отказ. Повторная отписка — не ошибка, а то же самое состояние. */
async function optOut(email, { source = 'link', reason = null } = {}) {
  const addr = normalize(email);
  if (!addr) return false;
  await model().findOrCreate({
    where: { email: addr },
    defaults: { email: addr, source, reason },
  });
  return true;
}

/** Вернуть в рассылку. Нужна на случай «отписался по ошибке». */
async function optIn(email) {
  const addr = normalize(email);
  if (!addr) return false;
  await model().destroy({ where: { email: addr } });
  return true;
}

/**
 * Отсев отказавшихся из списка получателей.
 *
 * Вызывается в момент отправки, а не в момент набора списка. Между набором и
 * отложенной отправкой проходят дни, и человек, отписавшийся в этот промежуток,
 * иначе получил бы ровно то письмо, от которого отписался.
 */
async function filterRecipients(recipients) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (!list.length) return { allowed: [], skipped: [] };

  const addresses = [...new Set(list.map(r => normalize(r?.email)).filter(Boolean))];
  if (!addresses.length) return { allowed: list, skipped: [] };

  const rows = await model().findAll({ where: { email: addresses }, attributes: ['email'] });
  const denied = new Set(rows.map(r => r.email));
  if (!denied.size) return { allowed: list, skipped: [] };

  const allowed = [];
  const skipped = [];
  for (const r of list) {
    (denied.has(normalize(r?.email)) ? skipped : allowed).push(r);
  }
  return { allowed, skipped };
}

module.exports = { makeToken, readToken, unsubscribeUrl, optOut, optIn, filterRecipients, normalize };
