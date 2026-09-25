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

// Клуб в токене — идентификатор медцентра. Строго UUID: всё остальное в
// подписанной части означало бы, что мы подписали что-то, чего не ждали.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Токен отписки для адреса. Одинаковый для одного и того же адреса всегда.
 *
 * С ver. 8.79 в токене может ехать и клуб — медцентр, из списка которого
 * ушло письмо. Тогда отписка убирает человека только из этого клуба:
 * подписчик Альфы, отписавшийся от письма Альфы, остаётся подписчиком 3К.
 * Клуб отделён переводом строки — в адресе его быть не может, а старые
 * токены (только адрес) читаются как прежде, общей отпиской.
 */
function makeToken(email, club = null) {
  const addr = normalize(email);
  if (!addr) return '';
  const clubId = club && UUID_RE.test(String(club)) ? String(club).toLowerCase() : null;
  const payload = b64url(clubId ? `${addr}\n${clubId}` : addr);
  return `${payload}.${sign(payload)}`;
}

/**
 * Разбор токена. Сравнение подписи — timingSafeEqual, а не ===: адрес отписки
 * доступен из интернета без всякой авторизации, и подбор подписи по времени
 * ответа здесь не теория.
 */
function readTokenFull(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const [rawEmail, rawClub, ...rest] = fromB64url(payload).split('\n');
    if (rest.length) return null;
    const email = normalize(rawEmail);
    if (!email || !email.includes('@')) return null;
    if (rawClub === undefined) return { email, club: null };
    return UUID_RE.test(rawClub) ? { email, club: rawClub.toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** Только адрес — для тех, кому клуб не важен. */
function readToken(token) {
  return readTokenFull(token)?.email || null;
}

/** Полный адрес страницы отписки — то, что подставляется в письмо. */
function unsubscribeUrl(email, club = null) {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const token = makeToken(email, club);
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
  // Получатель из почтового клуба (ver. 8.79) выбывает ещё и тогда, когда
  // отписался от своего клуба, оставаясь в остальных.
  const clubDenied = await require('./mailClub').unsubscribedKeys(list);
  if (!denied.size && !clubDenied.size) return { allowed: list, skipped: [] };

  const allowed = [];
  const skipped = [];
  for (const r of list) {
    const addr = normalize(r?.email);
    const out = denied.has(addr) || (r?.club && clubDenied.has(`${addr}|${r.club}`));
    (out ? skipped : allowed).push(r);
  }
  return { allowed, skipped };
}

module.exports = { makeToken, readToken, readTokenFull, unsubscribeUrl, optOut, optIn, filterRecipients, normalize };
