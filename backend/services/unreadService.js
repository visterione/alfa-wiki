'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

function rowsToUnreadMap(rows) {
  return new Map(rows.map(row => [String(row.chatId), Number(row.unreadCount) || 0]));
}

/**
 * Непрочитанные сразу для всех нужных чатов пользователя.
 *
 * С ver. 7.30 это просто чтение колонки chat_members."unreadCount": прежний
 * вариант считал COUNT по messages на каждый чат при каждом показе списка, и
 * стоимость росла вместе с перепиской. Значение поддерживается инкрементом
 * (хук afterCreate у Message) и обнуляется отметкой «прочитано».
 *
 * Если chatIds не передан, возвращает счётчики для всех членств, включая
 * скрытые — это сохраняет прежнее поведение /chat/unread/count.
 */
async function getUnreadCounts(userId, chatIds = null) {
  if (Array.isArray(chatIds) && chatIds.length === 0) return new Map();

  const chatFilter = Array.isArray(chatIds) ? 'AND cm."chatId" = ANY($chatIds::uuid[])' : '';

  const rows = await sequelize.query(`
    SELECT cm."chatId" AS "chatId", cm."unreadCount" AS "unreadCount"
    FROM chat_members cm
    WHERE cm."userId" = $userId
      ${chatFilter}
  `, {
    bind: {
      userId,
      ...(Array.isArray(chatIds) ? { chatIds } : {})
    },
    type: QueryTypes.SELECT
  });

  return rowsToUnreadMap(rows);
}

/**
 * Честный пересчёт по содержимому чата — ремонт для случаев, когда инкремент
 * не годится: массовое удаление сообщений или расхождение после сбоя.
 * Считает по тому же правилу, что действовало до ver. 7.30.
 */
async function recountChat(chatId) {
  await sequelize.query(`
    UPDATE chat_members cm
    SET "unreadCount" = (
      SELECT count(m.id)::int
      FROM messages m
      WHERE m."chatId" = cm."chatId"
        AND m."createdAt" > COALESCE(cm."lastReadAt", '-infinity'::timestamptz)
        AND m."senderId" <> cm."userId"
        AND NOT EXISTS (
          SELECT 1 FROM message_deletions md
          WHERE md."messageId" = m.id AND md."userId" = cm."userId"
        )
    )
    WHERE cm."chatId" = $chatId
  `, { bind: { chatId }, type: QueryTypes.UPDATE });
}

/** Чат прочитан: счётчик в ноль. */
async function markChatRead(chatId, userId) {
  await sequelize.query(`
    UPDATE chat_members SET "unreadCount" = 0
    WHERE "chatId" = $chatId AND "userId" = $userId
  `, { bind: { chatId, userId }, type: QueryTypes.UPDATE });
}

module.exports = { getUnreadCounts, rowsToUnreadMap, recountChat, markChatRead };
