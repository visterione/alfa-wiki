'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

function rowsToUnreadMap(rows) {
  return new Map(rows.map(row => [String(row.chatId), Number(row.unreadCount) || 0]));
}

/**
 * Считает непрочитанные сообщения сразу для всех нужных чатов пользователя.
 * Если chatIds не передан, возвращает счётчики для всех его членств, включая
 * скрытые — это сохраняет прежнее поведение /chat/unread/count.
 */
async function getUnreadCounts(userId, chatIds = null) {
  if (Array.isArray(chatIds) && chatIds.length === 0) return new Map();

  const chatFilter = Array.isArray(chatIds)
    ? 'AND cm."chatId" = ANY($chatIds::uuid[])'
    : '';

  const rows = await sequelize.query(`
    SELECT
      cm."chatId" AS "chatId",
      COUNT(m.id)::int AS "unreadCount"
    FROM chat_members cm
    LEFT JOIN messages m
      ON m."chatId" = cm."chatId"
     AND m."createdAt" > COALESCE(cm."lastReadAt", '-infinity'::timestamptz)
     AND m."senderId" <> $userId
    WHERE cm."userId" = $userId
      ${chatFilter}
    GROUP BY cm."chatId"
  `, {
    bind: {
      userId,
      ...(Array.isArray(chatIds) ? { chatIds } : {})
    },
    type: QueryTypes.SELECT
  });

  return rowsToUnreadMap(rows);
}

module.exports = { getUnreadCounts, rowsToUnreadMap };

