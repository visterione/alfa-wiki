'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rowsToUnreadMap } = require('../services/unreadService');

test('normalizes aggregate unread rows into numeric counters', () => {
  const result = rowsToUnreadMap([
    { chatId: 'chat-a', unreadCount: '12' },
    { chatId: 'chat-b', unreadCount: 0 },
  ]);

  assert.equal(result.get('chat-a'), 12);
  assert.equal(result.get('chat-b'), 0);
});

test('treats a null aggregate as zero', () => {
  const result = rowsToUnreadMap([{ chatId: 'chat-a', unreadCount: null }]);
  assert.equal(result.get('chat-a'), 0);
});

