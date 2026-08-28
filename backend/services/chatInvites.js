'use strict';

/**
 * Пригласительные ссылки в групповые чаты (ver. 7.58).
 *
 * ── Что это и чем не является ───────────────────────────────────────────────
 *
 * Ссылка избавляет от «добавьте меня в группу по логистике» в личку админу: он
 * один раз включает приём по ссылке и кидает адрес в общий чат отдела. Дальше
 * человек вступает сам.
 *
 * Это НЕ публичная ссылка. Открыть её может только сотрудник портала: маршруты
 * закрыты authenticate, и незалогиненного фронтенд уводит на вход, а после
 * входа возвращает обратно (ProtectedRoute в frontend/src/App.js). Утёкшая
 * наружу ссылка бесполезна — за ней нет учётной записи.
 *
 * ── Почему выключено по умолчанию ───────────────────────────────────────────
 *
 * В рабочих группах обсуждают пациентов. Ссылка, существующая с момента
 * создания группы, рано или поздно окажется переслана дальше, чем предполагал
 * автор, — и заметят это по новому участнику, а не заранее. Поэтому признак
 * поднимает человек и осознанно.
 *
 * ── Выключить и отозвать — разные вещи ──────────────────────────────────────
 *
 * Выключение гасит приём, оставляя токен: «выключить на время и включить
 * обратно» не должно требовать новой рассылки адреса. Перевыпуск (rotate)
 * меняет токен и ломает все разосланные ссылки — это и есть отзыв.
 */

const crypto = require('crypto');

const { Chat, ChatMember, Message } = require('../models');

// Тот же способ, что у публичных карточек оборудования и анкеты врача
// (services/warehouse/qr.js, services/onboarding/links.js): боевой домен по
// умолчанию, PUBLIC_BASE_URL — если портал живёт на другом. FRONTEND_URL сюда
// не годится: в dev-конфиге там localhost:9000, и такая ссылка никуда не ведёт.
const DEFAULT_BASE = 'https://wiki.medcentralfa.ru';

function publicBase() {
  return (process.env.PUBLIC_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

function inviteUrl(token) {
  return token ? `${publicBase()}/chat/join/${token}` : null;
}

/**
 * Новый токен.
 *
 * 24 байта в base64url — 32 символа, которые не подобрать перебором и которые
 * при этом не ломают строку в мессенджере переносом. Никакого смысла внутри:
 * по токену не должно читаться ни имя группы, ни её идентификатор, иначе
 * ссылка рассказывает о существовании группы ещё до входа в портал.
 */
function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Состояние ссылки для карточки группы. */
function describe(chat) {
  return {
    enabled: Boolean(chat.inviteEnabled),
    // Адрес отдаём и у выключенной ссылки: админ должен видеть, что именно
    // перестанет работать, прежде чем нажать «отозвать»
    url: inviteUrl(chat.inviteToken),
    createdAt: chat.inviteCreatedAt,
    createdBy: chat.inviteCreatedBy
  };
}

/**
 * Включить приём по ссылке. Токен создаётся, только если его ещё нет: повторное
 * включение обязано вернуть тот же адрес, иначе «выключил и включил» незаметно
 * ломало бы уже разосланные ссылки.
 */
async function enable(chat, userId) {
  const patch = { inviteEnabled: true };
  if (!chat.inviteToken) {
    patch.inviteToken = newToken();
    patch.inviteCreatedBy = userId;
    patch.inviteCreatedAt = new Date();
  }
  await chat.update(patch);
  return describe(chat);
}

/** Выключить приём. Токен остаётся — см. шапку файла. */
async function disable(chat) {
  await chat.update({ inviteEnabled: false });
  return describe(chat);
}

/**
 * Перевыпустить ссылку: старая перестаёт работать немедленно и навсегда.
 * Это единственный способ отобрать доступ у того, кому ссылку переслали.
 */
async function rotate(chat, userId) {
  await chat.update({
    inviteToken: newToken(),
    inviteEnabled: true,
    inviteCreatedBy: userId,
    inviteCreatedAt: new Date()
  });
  return describe(chat);
}

/**
 * Найти группу по токену.
 *
 * Выключенная ссылка отвечает так же, как несуществующая: разные ответы
 * позволили бы по одному лишь адресу узнать, что такая группа есть.
 */
async function findByToken(token) {
  const value = String(token || '').trim();
  if (!value) return null;

  const chat = await Chat.findOne({ where: { inviteToken: value } });
  if (!chat || chat.type !== 'group' || !chat.inviteEnabled) return null;
  return chat;
}

/**
 * Что показать до вступления: во что человека зовут.
 *
 * Состав группы не отдаём — только его размер. Список участников это уже
 * содержимое, а его получают, вступив.
 */
async function preview(chat, userId) {
  const [memberCount, membership] = await Promise.all([
    ChatMember.count({ where: { chatId: chat.id } }),
    ChatMember.findOne({ where: { chatId: chat.id, userId } })
  ]);

  return {
    chatId: chat.id,
    name: chat.name,
    avatar: chat.avatar,
    memberCount,
    isMember: Boolean(membership)
  };
}

/**
 * Вступить в группу по ссылке.
 *
 * Возвращает {chatId, joined}: joined === false значит «уже состоял». Это не
 * ошибка — по ссылке из общего чата ходят и те, кто в группе уже есть, и им
 * надо просто открыть переписку.
 */
async function join(chat, user) {
  const existing = await ChatMember.findOne({ where: { chatId: chat.id, userId: user.id } });
  if (existing) {
    // Скрытый у себя чат при повторном переходе возвращаем на место: человек
    // идёт по ссылке именно затем, чтобы его открыть
    if (existing.isHidden) await existing.update({ isHidden: false });
    return { chatId: chat.id, joined: false };
  }

  await ChatMember.create({ chatId: chat.id, userId: user.id, role: 'member' });

  // Системное сообщение — как при добавлении руками. Без него состав группы
  // меняется молча, и «откуда здесь этот человек» выясняется только вопросом.
  const who = user.displayName || user.username;
  const text = `${who} присоединился по ссылке-приглашению`;
  await Message.create({ chatId: chat.id, senderId: user.id, content: text, type: 'system' });
  await Chat.update(
    { lastMessage: text, lastMessageAt: new Date() },
    { where: { id: chat.id } }
  );

  return { chatId: chat.id, joined: true, systemMessage: text };
}

/** Участники группы — кому разослать обновление по сокету. */
async function memberIds(chatId) {
  const rows = await ChatMember.findAll({ where: { chatId }, attributes: ['userId'], raw: true });
  return rows.map(r => r.userId);
}

/** Админ ли этот человек в этой группе. */
async function isGroupAdmin(chatId, userId) {
  const membership = await ChatMember.findOne({
    where: { chatId, userId, role: 'admin' },
    attributes: ['id']
  });
  return Boolean(membership);
}

module.exports = {
  DEFAULT_BASE,
  publicBase,
  inviteUrl,
  newToken,
  describe,
  enable,
  disable,
  rotate,
  findByToken,
  preview,
  join,
  memberIds,
  isGroupAdmin
};
